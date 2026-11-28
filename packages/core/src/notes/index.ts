// Workspace notes: persistent agent memory attached to one entity
// (workspace, object, workflow, function or page). Notes hold the "why"
// (decisions, local conventions, known pitfalls); the structure itself is
// generated elsewhere. Each note stores the entity version it was written
// against: when the entity has moved on, the note is flagged as stale.
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { notes } from "../db/schema";
import { appError, notFound } from "../errors/app-error";
import { functionsService } from "../functions";
import { objectsService } from "../objects";
import { pagesService } from "../pages";
import { workflowsService } from "../workflows";
import { withTenant, type TenantContext } from "../tenant";

export const NOTE_ENTITY_TYPES = [
  "workspace",
  "object",
  "workflow",
  "function",
  "page",
] as const;
export type NoteEntityType = (typeof NOTE_ENTITY_TYPES)[number];

// Per entity: beyond that, merge or delete notes instead of adding more.
export const MAX_NOTES_PER_ENTITY = 20;
export const MAX_NOTE_TITLE = 120;
export const MAX_NOTE_BODY = 10_000;

// `ref`: object slug or id, workflow id or name, function name, page id or
// name. Ignored for the workspace.
export type NoteEntity = { type: NoteEntityType; ref?: string };
export type NoteInput = { entity: NoteEntity; title: string; body: string };

const res = (id: string) => ({ type: "note", id });
const key = (type: string, id: string) => `${type}:${id}`;

// Current version of every entity of the workspace, keyed by `type:id`.
// workspace: null (never stale); object and page: last update; workflow:
// current version; function: latest version.
type Entity = {
  type: NoteEntityType;
  id: string;
  name: string;
  version: string | null;
};
async function entities(ctx: TenantContext): Promise<Entity[]> {
  const [objs, wfs, fns, pgs] = await Promise.all([
    objectsService.list(ctx),
    workflowsService.list(ctx),
    functionsService.list(ctx),
    pagesService.list(ctx),
  ]);
  return [
    {
      type: "workspace",
      id: ctx.workspaceId,
      name: "workspace",
      version: null,
    },
    ...objs.map((o) => ({
      type: "object" as const,
      id: o.id,
      name: o.slug,
      version: o.updatedAt.toISOString(),
    })),
    ...wfs.map((w) => ({
      type: "workflow" as const,
      id: w.id,
      name: w.name,
      version: String(w.currentVersion),
    })),
    ...fns.map((f) => ({
      type: "function" as const,
      id: f.name,
      name: f.name,
      version: String(f.version),
    })),
    ...pgs.map((p) => ({
      type: "page" as const,
      id: p.id,
      name: p.name,
      version: p.updatedAt.toISOString(),
    })),
  ];
}

function resolve(all: Entity[], entity: NoteEntity): Entity {
  if (entity.type === "workspace") return all[0]!;
  const ref = entity.ref?.trim();
  const found =
    ref &&
    (all.find((e) => e.type === entity.type && e.id === ref) ??
      all.find((e) => e.type === entity.type && e.name === ref));
  if (!found)
    throw notFound("notes.entityNotFound", "{type} not found: {ref}", {
      type: entity.type,
      ref: ref ?? "",
    });
  return found;
}

type NoteRow = typeof notes.$inferSelect;
// Public shape: the entity as type + id, the stale flag computed against
// the entity's current version (a deleted entity also makes its notes stale).
function shape(row: NoteRow, current: Map<string, Entity>) {
  const e = current.get(key(row.entityType, row.entityId));
  return {
    id: row.id,
    entity: { type: row.entityType, id: row.entityId, name: e?.name ?? null },
    title: row.title,
    body: row.body,
    entityVersion: row.entityVersion,
    stale: !e || e.version !== row.entityVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export type Note = ReturnType<typeof shape>;
export type NoteSummary = Omit<Note, "body">;

const byKey = (all: Entity[]) =>
  new Map(all.map((e) => [key(e.type, e.id), e]));
const loadRows = (ctx: TenantContext, where?: ReturnType<typeof and>) =>
  withTenant(ctx, (tx) =>
    tx
      .select()
      .from(notes)
      .where(and(eq(notes.workspaceId, ctx.workspaceId), where))
      .orderBy(asc(notes.entityType), asc(notes.entityId), asc(notes.title)),
  );

const input = z.object({
  entity: z.object({
    type: z.enum(NOTE_ENTITY_TYPES),
    ref: z.string().optional(),
  }),
  title: z.string().trim().min(1).max(MAX_NOTE_TITLE),
  body: z.string().trim().min(1).max(MAX_NOTE_BODY),
});

export const notesService = {
  // Titles only (no body): agents load bodies on demand with get.
  list: async (
    ctx: TenantContext,
    filter: { entity?: NoteEntity } = {},
  ): Promise<NoteSummary[]> => {
    await requireScope(ctx, "read");
    const all = await entities(ctx);
    const e = filter.entity ? resolve(all, filter.entity) : null;
    const rows = await loadRows(
      ctx,
      e
        ? and(eq(notes.entityType, e.type), eq(notes.entityId, e.id))
        : undefined,
    );
    const current = byKey(all);
    return rows.map((r) => {
      const note: Partial<Note> = shape(r, current);
      delete note.body;
      return note as NoteSummary;
    });
  },
  get: async (ctx: TenantContext, id: string): Promise<Note> => {
    await requireScope(ctx, "read");
    const parsed = z.uuid().safeParse(id);
    const [row] = parsed.success
      ? await loadRows(ctx, eq(notes.id, parsed.data))
      : [];
    if (!row) throw notFound("notes.notFound", "Note not found: {id}", { id });
    return shape(row, byKey(await entities(ctx)));
  },
  // Creates the note, or updates the entity's note with the same title.
  // Stamps the entity's current version (the note is fresh again).
  save: async (ctx: TenantContext, raw: NoteInput): Promise<Note> => {
    await requireScope(ctx, "write");
    const { entity, title, body } = input.parse(raw);
    const all = await entities(ctx);
    const e = resolve(all, entity);
    const row = await withTenant(ctx, async (tx) => {
      const scope = and(
        eq(notes.workspaceId, ctx.workspaceId),
        eq(notes.entityType, e.type),
        eq(notes.entityId, e.id),
      );
      const [existing] = await tx
        .select({ id: notes.id })
        .from(notes)
        .where(and(scope, eq(notes.title, title)));
      if (!existing) {
        const [c] = await tx
          .select({ n: sql<number>`count(*)`.mapWith(Number) })
          .from(notes)
          .where(scope);
        if ((c?.n ?? 0) >= MAX_NOTES_PER_ENTITY)
          throw appError(
            "notes.limit",
            "Note limit reached for this {type} ({max}): update or delete an existing note",
            { type: e.type, max: MAX_NOTES_PER_ENTITY },
            { kind: "conflict" },
          );
      }
      const values = { body, entityVersion: e.version, updatedAt: new Date() };
      const [saved] = await tx
        .insert(notes)
        .values({
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          entityType: e.type,
          entityId: e.id,
          title,
          ...values,
        })
        .onConflictDoUpdate({
          target: [
            notes.workspaceId,
            notes.entityType,
            notes.entityId,
            notes.title,
          ],
          set: values,
        })
        .returning();
      await audit(tx, ctx, "note.save", res(saved!.id), {
        entity: { type: e.type, id: e.id },
        title,
      });
      return saved!;
    });
    return shape(row, byKey(all));
  },
  remove: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "write");
    const parsed = z.uuid().safeParse(id);
    const row = parsed.success
      ? await withTenant(ctx, async (tx) => {
          const [r] = await tx
            .delete(notes)
            .where(
              and(
                eq(notes.workspaceId, ctx.workspaceId),
                eq(notes.id, parsed.data),
              ),
            )
            .returning();
          if (r)
            await audit(tx, ctx, "note.delete", res(r.id), { title: r.title });
          return r;
        })
      : undefined;
    if (!row) throw notFound("notes.notFound", "Note not found: {id}", { id });
    return true;
  },
};
