"use server";

import type { Filter } from "@getrunbase/core/filter";
import { eventsService } from "@getrunbase/core/events";
import {
  fieldsSchema,
  objectsService,
  recordTitle,
} from "@getrunbase/core/objects";
import { recordsService } from "@getrunbase/core/records";
import { runsService } from "@getrunbase/core/runs";
import { triggersService } from "@getrunbase/core/triggers";
import { filesService, type FileMeta } from "@getrunbase/core/files";
import { viewsService, type ViewInput } from "@getrunbase/core/views";
import type { FileInfo } from "@/lib/direct-upload";
import { billingService, isQuotaError } from "@getrunbase/core/quotas";
import { z } from "zod";
import { actionError, type ActionError } from "@/lib/action-error";
import { id as idSchema, parseInput } from "@/lib/action-input";
import { getTenant } from "@/lib/tenant";
import { isOrgAdmin } from "@/lib/settings-access";
import type { QuotaHint } from "@/components/quota-link";

const PAGE_SIZE = 50;

// quota: quota reached and Plan and usage page available: a link for
// owners/admins, "ask an admin" for the other roles (no billing access).
type Result<T> = { data?: T; error?: ActionError; quota?: QuotaHint };
async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { data: await fn() };
  } catch (e) {
    if (!isQuotaError(e) || !billingService.enabled())
      return { error: actionError(e) };
    const { role } = await getTenant();
    return { error: actionError(e), quota: isOrgAdmin(role) ? "link" : "ask" };
  }
}

// Inputs of these actions come from the client as is: shapes checked
// here, content (filters, values, views) validated by the core services.
const idList = z.array(idSchema).max(10_000);
const sort = z
  .array(z.object({ field: z.string().max(200), dir: z.enum(["asc", "desc"]) }))
  .max(20);
const searchInput = z.object({
  objectId: idSchema,
  filter: z.unknown().optional(),
  sort: sort.optional(),
  after: idSchema.optional(),
  refs: z.array(z.string().max(200)).max(200).optional(),
});
const importInput = z.object({
  csv: z.string().max(50_000_000),
  mapping: z.record(z.string(), z.string()),
  match: z.string().max(200).optional(),
  dryRun: z.boolean().optional(),
});
const fileInfos = z
  .array(
    z.object({
      name: z.string().max(1000),
      type: z.string().max(200),
      size: z.number().int().nonnegative(),
    }),
  )
  .max(100);
// Invalid input: same error result as a core refusal.
function invalid(...pairs: [z.ZodType, unknown][]): Result<never> | undefined {
  try {
    for (const [schema, value] of pairs) parseInput(schema, value);
  } catch (e) {
    return { error: actionError(e) };
  }
}

export type Row = { id: string; data: Record<string, unknown> };
type Link = { id: string; label: string };

// Table view: one page of records, filtered and sorted on the server,
// keyset-paginated: `after` = `next` of the previous page.
export async function searchRecords(
  objectId: string,
  input: {
    filter?: Filter;
    sort?: { field: string; dir: "asc" | "desc" }[];
    after?: string;
    // Keys of the ref / refs fields whose labels are resolved.
    refs?: string[];
  },
) {
  const { ctx } = await getTenant();
  const bad = invalid([searchInput, { objectId, ...input }]);
  if (bad) return bad;
  return run(async () => {
    // One extra row to know whether there is a next page (no count).
    const rows = await recordsService.search(ctx, objectId, {
      filter: input.filter,
      sort: input.sort,
      pagination: { limit: PAGE_SIZE + 1, after: input.after },
    });
    const page = rows.slice(0, PAGE_SIZE);
    const hasMore = rows.length > PAGE_SIZE;
    const ids = new Set(
      page.flatMap((r) =>
        (input.refs ?? []).flatMap((k) => r.data[k] ?? []),
      ) as string[],
    );
    const labels: Record<string, string> = {};
    const recordLabel = await labeler(ctx);
    await Promise.all(
      [...ids].map(async (id) => {
        labels[id] = recordLabel(await recordsService.get(ctx, id));
      }),
    );
    return {
      rows: page.map((r): Row => ({ id: r.id, data: r.data })),
      hasMore,
      next: hasMore ? page.at(-1)!.id : null,
      labels,
    };
  });
}

export async function updateCell(id: string, key: string, value: unknown) {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, id], [z.string().max(200), key]);
  if (bad) return bad;
  return run(async () => {
    const { record } = await recordsService.update(ctx, id, { [key]: value });
    return record.data;
  });
}

export async function deleteRecords(ids: string[]) {
  const { ctx } = await getTenant();
  const bad = invalid([idList, ids]);
  if (bad) return bad;
  return run(async () => {
    for (const id of ids) await recordsService.remove(ctx, id);
    return ids.length;
  });
}

export async function runWorkflow(workflowId: string, ids: string[]) {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, workflowId], [idList, ids]);
  if (bad) return bad;
  return run(async () => {
    const runs = await triggersService.manual(ctx, workflowId, ids);
    return runs.length;
  });
}

// New empty record, then opened in its record view.
export async function createRecord(
  objectId: string,
  data: Record<string, unknown> = {},
) {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, objectId], [z.record(z.string(), z.unknown()), data]);
  if (bad) return bad;
  return run(async () => {
    const { record } = await recordsService.upsert(ctx, { objectId, data });
    return record.id;
  });
}

// Candidate records for a ref / refs field: server-side search on the
// text fields of the target object (20 results).
export async function refOptions(slug: string, q = "") {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, slug], [z.string().max(500), q]);
  if (bad) return bad;
  return run(async () => {
    const object = await objectsService.get(ctx, slug);
    if (!object) return [];
    const texts = fieldsSchema
      .parse(object.fields)
      .filter((f) => ["text", "email", "url"].includes(f.type));
    const term = q.trim();
    const fields = fieldsSchema.parse(object.fields);
    const rows = await recordsService.search(ctx, object.id, {
      filter:
        term && texts.length
          ? {
              any: texts.map((f) => ({
                field: f.key,
                op: "contains" as const,
                value: term,
              })),
            }
          : undefined,
      pagination: { limit: 20 },
    });
    return rows.map((r): Link => ({ id: r.id, label: recordTitle(fields, r) }));
  });
}

// Record view: attributes, resolved refs (id + label), timeline and runs.
export async function loadRecord(id: string) {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, id]);
  if (bad) return bad;
  return run(async () => {
    // Inverse relations: ref / refs fields of other objects
    // pointing to the record's object, followed via `include` `<slug>:<field>`.
    const objects = await objectsService.list(ctx);
    const recordLabel = await labeler(ctx, objects);
    const head = await recordsService.get(ctx, id);
    const self = objects.find((o) => o.id === head.objectId)!;
    const many = fieldsSchema
      .parse(self.fields)
      .filter((f) => f.type === "refs")
      .map((f) => f.key);
    const inverses = objects.flatMap((o) =>
      fieldsSchema
        .parse(o.fields)
        .filter(
          (f) =>
            (f.type === "ref" || f.type === "refs") && f.object === self.slug,
        )
        .map((f) => ({
          path: `${o.slug}:${f.key}`,
          object: o.slug,
          label: `${o.name} · ${f.label}`,
        })),
    );
    const record = await recordsService.get(ctx, id, {
      include: [...many, ...inverses.map((i) => i.path)],
    });
    const links = (path: string) =>
      ((record.included[path] ?? []) as Row[]).map((r): Link => ({
        id: r.id,
        label: recordLabel(r),
      }));
    const refs: Record<string, Link | null> = {};
    for (const [key, r] of Object.entries(record.refs))
      refs[key] = r && { id: r.id, label: recordLabel(r) };
    const refsMany = Object.fromEntries(many.map((k) => [k, links(k)]));
    const inverse = inverses.map((i) => ({
      object: i.object,
      label: i.label,
      records: links(i.path),
    }));
    const [events, runs] = await Promise.all([
      eventsService.timeline(ctx, id),
      runsService.forRecord(ctx, id),
    ]);
    return {
      id: record.id,
      data: record.data,
      refs,
      refsMany,
      inverse,
      events,
      runs,
    };
  });
}

// Readable record label: title field of its object.
async function labeler(
  ctx: Awaited<ReturnType<typeof getTenant>>["ctx"],
  list?: Awaited<ReturnType<typeof objectsService.list>>,
) {
  const objects = list ?? (await objectsService.list(ctx));
  const fields = new Map(
    objects.map((o) => [o.id, fieldsSchema.parse(o.fields)]),
  );
  return (r: {
    id: string;
    objectId?: string;
    data: Record<string, unknown>;
  }) => recordTitle((r.objectId && fields.get(r.objectId)) || [], r);
}

// Object trash (deleted records, restorable).
export async function listTrash(objectId: string) {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, objectId]);
  if (bad) return bad;
  return run(async () =>
    (await recordsService.trash(ctx, objectId, { limit: 200 })).map((r) => ({
      id: r.id,
      data: r.data,
      deletedAt: r.deletedAt,
      purgeAt: r.purgeAt,
    })),
  );
}

export async function restoreRecord(id: string) {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, id]);
  if (bad) return bad;
  return run(async () => (await recordsService.restore(ctx, id)).id);
}

export async function emptyTrash(objectId: string, ids?: string[]) {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, objectId], [idList.optional(), ids]);
  if (bad) return bad;
  return run(
    async () => (await recordsService.purge(ctx, { objectId, ids })).purged,
  );
}

// Record history: who changed what, with the previous values.
export async function recordHistory(id: string) {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, id]);
  if (bad) return bad;
  return run(async () =>
    (await recordsService.history(ctx, id)).map((h) => ({
      id: h.id,
      action: h.action,
      diff: h.diff as {
        changed?: string[];
        before?: Record<string, unknown>;
        after?: Record<string, unknown>;
      } | null,
      byKey: !!h.actorApiKeyId,
      createdAt: h.createdAt,
    })),
  );
}

export async function revertRecord(id: string, auditId: string) {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, id], [idSchema, auditId]);
  if (bad) return bad;
  return run(async () => {
    await recordsService.revert(ctx, id, auditId);
    return true;
  });
}

export async function importRecords(
  objectId: string,
  input: {
    csv: string;
    mapping: Record<string, string>;
    match?: string;
    dryRun?: boolean;
  },
) {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, objectId], [importInput, input]);
  if (bad) return bad;
  return run(() => recordsService.importCsv(ctx, objectId, input));
}

// Saved views of the object (filter, sort, columns).
export type SavedView = {
  name: string;
  filter: Filter | null;
  sort: { field: string; dir: "asc" | "desc" }[];
  columns: string[] | null;
};
export async function listViews(objectId: string) {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, objectId]);
  if (bad) return bad;
  return run(async () =>
    (await viewsService.list(ctx, objectId)).map((v): SavedView => ({
      name: v.name,
      filter: v.filter as Filter | null,
      sort: v.sort as SavedView["sort"],
      columns: v.columns as string[] | null,
    })),
  );
}

export async function saveView(objectId: string, input: ViewInput) {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, objectId], [z.record(z.string(), z.unknown()), input]);
  if (bad) return bad;
  return run(async () => (await viewsService.save(ctx, objectId, input)).name);
}

export async function deleteView(objectId: string, name: string) {
  const { ctx } = await getTenant();
  const bad = invalid([idSchema, objectId], [z.string().max(200), name]);
  if (bad) return bad;
  return run(() => viewsService.remove(ctx, objectId, name));
}

// s3 driver: one presigned PUT URL per file, the browser uploads
// straight to the bucket. null: storage without direct upload (local), the
// client goes through uploadFiles.
export async function fileUploadUrls(list: FileInfo[]) {
  const { ctx } = await getTenant();
  const bad = invalid([fileInfos, list]);
  if (bad) return bad;
  return run(async () => {
    if (!filesService.direct()) return null;
    const out = [];
    for (const f of list) out.push(await filesService.uploadUrl(ctx, f));
    return out;
  });
}

// File upload (`file` field): returns the values to add to the field.
export async function uploadFiles(form: FormData) {
  const { ctx } = await getTenant();
  return run(async () => {
    const out: FileMeta[] = [];
    for (const f of form.getAll("files"))
      if (f instanceof File)
        out.push(
          await filesService.upload(ctx, {
            name: f.name,
            type: f.type,
            bytes: new Uint8Array(await f.arrayBuffer()),
          }),
        );
    return out;
  });
}
