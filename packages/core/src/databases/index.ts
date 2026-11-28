// Databases: level between the workspace and the objects.
import { appError, notFound } from "../errors/app-error";
import { and, count, eq, inArray } from "drizzle-orm";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { databases, objects, records } from "../db/schema";
import { publishDeleted, removeObjectInTx } from "../objects";
import { withTenant, type TenantContext, type Tx } from "../tenant";

export const DEFAULT_DATABASE = { slug: "default", name: "Default" };
// Slug of the default database in workspaces created before the rename.
const LEGACY_DEFAULT = "defaut";

// Slugs accepted for a lookup: "default" and its legacy alias are the same database.
const slugsOf = (slug: string) =>
  slug === DEFAULT_DATABASE.slug || slug === LEGACY_DEFAULT
    ? [DEFAULT_DATABASE.slug, LEGACY_DEFAULT]
    : [slug];

// Unique constraint violated (direct Postgres error or wrapped by Drizzle).
const isUniqueViolation = (e: unknown) =>
  (((e as { cause?: unknown }).cause ?? e) as { code?: string }).code ===
  "23505";

type DatabaseInput = {
  slug: string;
  name: string;
  icon?: string | null;
  description?: string | null;
};

const res = (id: string) => ({ type: "database", id });
const inWs = (ctx: TenantContext, id: string) =>
  and(eq(databases.id, id), eq(databases.workspaceId, ctx.workspaceId));

// Id of the `slug` database (default: "Default", created if needed).
export async function resolveDatabaseId(
  tx: Tx,
  ctx: TenantContext,
  slug?: string,
) {
  const s = slug ?? DEFAULT_DATABASE.slug;
  const find = () =>
    tx
      .select({ id: databases.id })
      .from(databases)
      .where(
        and(
          eq(databases.workspaceId, ctx.workspaceId),
          inArray(databases.slug, slugsOf(s)),
        ),
      );
  const [row] = await find();
  if (row) return row.id;
  if (slug)
    throw notFound("databases.notFound", "Database not found: {slug}", {
      slug,
    });
  const [created] = await tx
    .insert(databases)
    .values({
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      ...DEFAULT_DATABASE,
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    await audit(tx, ctx, "database.create", res(created.id), DEFAULT_DATABASE);
    return created.id;
  }
  return (await find())[0]!.id;
}

export const databasesService = {
  list: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) =>
      tx
        .select()
        .from(databases)
        .where(eq(databases.workspaceId, ctx.workspaceId))
        .orderBy(databases.createdAt),
    );
  },
  // The database and its objects, with their record count.
  get: async (ctx: TenantContext, slug: string) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(databases)
        .where(
          and(
            eq(databases.workspaceId, ctx.workspaceId),
            inArray(databases.slug, slugsOf(slug)),
          ),
        );
      if (!row) return null;
      const objs = await tx
        .select()
        .from(objects)
        .where(eq(objects.databaseId, row.id))
        .orderBy(objects.createdAt);
      const counts = await tx
        .select({ objectId: records.objectId, n: count() })
        .from(records)
        .innerJoin(objects, eq(objects.id, records.objectId))
        .where(eq(objects.databaseId, row.id))
        .groupBy(records.objectId);
      const n = new Map(counts.map((c) => [c.objectId, Number(c.n)]));
      return {
        ...row,
        objects: objs.map((o) => ({ ...o, records: n.get(o.id) ?? 0 })),
      };
    });
  },
  create: async (ctx: TenantContext, input: DatabaseInput) => {
    await requireScope(ctx, "admin");
    const taken = () =>
      appError(
        "data.conflict",
        "A database with slug {slug} already exists in this workspace",
        { slug: input.slug },
        { kind: "conflict" },
      );
    return withTenant(ctx, async (tx) => {
      // "default" and "defaut" name the same database: either one taken.
      const [dup] = await tx
        .select({ id: databases.id })
        .from(databases)
        .where(
          and(
            eq(databases.workspaceId, ctx.workspaceId),
            inArray(databases.slug, slugsOf(input.slug)),
          ),
        );
      if (dup) throw taken();
      const [row] = await tx
        .insert(databases)
        .values({
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          slug: input.slug,
          name: input.name,
          icon: input.icon ?? null,
          description: input.description ?? null,
        })
        .returning();
      await audit(tx, ctx, "database.create", res(row!.id), input);
      return row!;
    }).catch((e: unknown) => {
      if (isUniqueViolation(e)) throw taken();
      throw e;
    });
  },
  rename: async (
    ctx: TenantContext,
    id: string,
    patch: Partial<Omit<DatabaseInput, "slug">>,
  ) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, async (tx) => {
      const [row] = await tx
        .update(databases)
        .set({ ...patch, updatedAt: new Date() })
        .where(inWs(ctx, id))
        .returning();
      if (row) await audit(tx, ctx, "database.update", res(id), patch);
      return row ?? null;
    });
  },
  // Refuses a non-empty database, unless `confirm`: objects and records are
  // then permanently deleted, in a single transaction (all or nothing).
  // object.delete audit per object; record.deleted published after commit.
  remove: async (
    ctx: TenantContext,
    id: string,
    opts: { confirm?: boolean } = {},
  ) => {
    await requireScope(ctx, "admin");
    const { row, deleted } = await withTenant(ctx, async (tx) => {
      const inside = await tx
        .select({ id: objects.id })
        .from(objects)
        .where(
          and(
            eq(objects.databaseId, id),
            eq(objects.workspaceId, ctx.workspaceId),
          ),
        );
      if (inside.length > 0 && !opts.confirm)
        throw appError(
          "databases.notEmpty",
          "Database not empty ({count} object(s)): export the objects (objects.export) then confirm (confirm: true) to delete everything",
          { count: inside.length },
          { kind: "confirm_required" },
        );
      const deleted = [];
      for (const o of inside)
        deleted.push(...(await removeObjectInTx(tx, ctx, o.id)).deleted);
      const [row] = await tx.delete(databases).where(inWs(ctx, id)).returning();
      if (row)
        await audit(tx, ctx, "database.delete", res(id), {
          ...row,
          objects: inside.length,
        });
      return { row, deleted };
    });
    await publishDeleted(ctx, deleted);
    return row ?? null;
  },
};
