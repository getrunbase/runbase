// MCP tools: files and records.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { TenantContext } from "@getrunbase/core/tenant";
import { fieldSchema, objectsService } from "@getrunbase/core/objects";
import { recordsService } from "@getrunbase/core/records";
import { filterSchema } from "@getrunbase/core/filter";
import { requireConfirm } from "@getrunbase/core/errors";
import { viewsService } from "@getrunbase/core/views";
import { filesService } from "@getrunbase/core/files";
import { run, must, objectId, slug, data, mode, upsertItem } from "./shared";

export function defineRecordTools(server: McpServer, ctx: TenantContext) {
  // Files
  server.registerTool(
    "files.upload",
    {
      description:
        "Uploads a file (base64, 10 MB max) and returns { key, name, size, type }: put it in a record's `file` field (value = list of these objects).",
      inputSchema: z.object({
        name: z.string().min(1),
        type: z.string().optional().describe("MIME type"),
        base64: z.string().min(1),
      }),
    },
    (input) => run(() => filesService.upload(ctx, input)),
  );
  server.registerTool(
    "files.download",
    {
      description:
        "Reads an uploaded file by its key (value of a file field): returns { name, type, base64 }.",
      inputSchema: z.object({ key: z.string().min(1) }),
    },
    ({ key }) =>
      run(async () => {
        const f = await filesService.download(ctx, key);
        return {
          name: f.name,
          type: f.type,
          base64: Buffer.from(f.bytes).toString("base64"),
        };
      }),
  );
  server.registerTool(
    "files.delete",
    {
      description:
        "Deletes an uploaded file by its key and frees its bytes from the workspace storage usage. Remove it from the record's `file` field too.",
      inputSchema: z.object({ key: z.string().min(1) }),
    },
    ({ key }) =>
      run(async () => {
        await filesService.remove(ctx, key);
        return { deleted: key };
      }),
  );

  server.registerTool(
    "objects.migrate",
    {
      description:
        "Evolves an object's schema while carrying the data over. op: rename { field, to, label? } (values copied); change_type { field, type, options?, object?, dropInvalid? } (values converted; refused if invalid values remain, unless dropInvalid empties them); add { field: definition, default? } (default written to existing records, mandatory if required); require { field, default? } (default for empty records); delete { field, force? } (purged from records; refused while a formula, lookup or rollup uses it, unless force); rename_slug { to } (object slug renamed; refused while other objects point to it). A field rename rewrites the formulas, lookups and rollups that read it. Always call with dryRun: true first: returns { records, touched, invalid, samples, dependents, examples: [{ id, before, after, computed: [{ field, before, after }] }] }.",
      inputSchema: z.object({
        object: slug,
        operation: z.discriminatedUnion("op", [
          z.object({
            op: z.literal("rename"),
            field: z.string(),
            to: z.string(),
            label: z.string().optional(),
          }),
          z.object({
            op: z.literal("change_type"),
            field: z.string(),
            type: z.enum([
              "text",
              "number",
              "bool",
              "date",
              "select",
              "multi_select",
              "email",
              "url",
              "json",
              "ref",
              "refs",
              "currency",
              "percent",
              "phone",
              "rating",
              "user",
            ]),
            options: z.array(z.string()).optional(),
            object: z.string().optional(),
            dropInvalid: z.boolean().optional(),
          }),
          z.object({
            op: z.literal("add"),
            field: fieldSchema,
            default: z.unknown().optional(),
          }),
          z.object({
            op: z.literal("require"),
            field: z.string(),
            default: z.unknown().optional(),
          }),
          z.object({
            op: z.literal("delete"),
            field: z.string(),
            force: z.boolean().optional(),
          }),
          z.object({ op: z.literal("rename_slug"), to: z.string().min(1) }),
        ]),
        dryRun: z.boolean().optional(),
      }),
    },
    ({ object, operation, dryRun }) =>
      run(async () =>
        objectsService.migrate(ctx, await objectId(ctx, object), operation, {
          dryRun,
        }),
      ),
  );

  // Records
  server.registerTool(
    "records.upsert",
    {
      description:
        "Creates or updates a record, validated against the object's schema. Key: `externalId`, or `match` = key of a `unique: true` field (email, domain); without a key, always creates. `test: true`: test record (on creation), deleted by workspace.purge_test.",
      inputSchema: upsertItem.extend({ object: slug }),
    },
    ({ object, ...input }) =>
      run(async () =>
        recordsService.upsert(ctx, {
          objectId: await objectId(ctx, object),
          ...input,
        }),
      ),
  );
  server.registerTool(
    "records.upsert_batch",
    {
      description:
        "Upserts several records of an object (max 1000), atomically: one invalid item cancels the whole batch. Item shape: { data: { fieldKey: value }, match?, externalId?, test?, mode? }. Top-level `test`, `match` and `mode` are defaults for every item (an item value wins). Example: `{ object: 'contact', match: 'email', test: true, items: [{ data: { email: 'a@x.io', name: 'Ada' } }] }`. Unknown keys are rejected.",
      inputSchema: z
        .object({
          object: slug,
          test: upsertItem.shape.test,
          match: upsertItem.shape.match,
          mode: upsertItem.shape.mode,
          items: z.array(upsertItem.strict()).min(1).max(1000),
        })
        .strict(),
    },
    ({ object, items, ...defaults }) =>
      run(async () =>
        recordsService.upsertBatch(
          ctx,
          await objectId(ctx, object),
          withBatchDefaults(items, defaults),
        ),
      ),
  );
  server.registerTool(
    "records.get",
    {
      description:
        "Reads a record by id, refs resolved. `include`: relation paths (e.g. `company`, `contact.company`, reverse relation `contact`) -> `included`.",
      inputSchema: z.object({
        id: z.string(),
        include: z.array(z.string()).optional(),
      }),
    },
    ({ id, include }) => run(() => recordsService.get(ctx, id, { include })),
  );
  server.registerTool(
    "records.search",
    {
      description:
        "Searches an object's records (DSL filter all/any of { field, op, value }; ops: eq, neq, gt, gte, lt, lte, between, in, not_in, contains, starts_with, ends_with, regex (case-sensitive), before, after, within, older_than, is, is_empty, is_not_empty; older_than and within take a number of days, e.g. `{ field: 'updated_at', op: 'older_than', value: 30 }`). `q`: free text (trigram index). Returns { records, hasMore, total, next }. Pagination: `after` = `next` of the previous page (keyset, works with any sort). `view`: name of a saved view (its filter is added, its sort applies when there is no `sort`).",
      inputSchema: z.object({
        object: slug,
        filter: filterSchema.optional(),
        sort: z
          .array(
            z.object({
              field: z.string(),
              dir: z.enum(["asc", "desc"]).optional(),
            }),
          )
          .optional(),
        q: z.string().optional(),
        view: z.string().optional(),
        limit: z.number().int().optional(),
        after: z.string().optional(),
      }),
    },
    ({ object, filter, sort, q, view, limit, after }) =>
      run(async () => {
        const id = await objectId(ctx, object);
        if (view) {
          const v = await viewsService.get(ctx, id, view);
          const own = v.filter as typeof filter | null;
          if (own) filter = filter ? { all: [own, filter] } : own;
          sort ??= v.sort as typeof sort;
        }
        return recordsService.searchPage(ctx, id, {
          filter,
          sort,
          q,
          pagination: { limit, after },
        });
      }),
  );
  server.registerTool(
    "records.merge",
    {
      description:
        "Merges duplicates into `keep`, atomically: its values win, empty fields are filled, the merged records' relations (ref/refs) and events move to `keep`, then they are deleted.",
      inputSchema: z.object({
        keep: z.string(),
        merge: z.array(z.string()).min(1),
      }),
    },
    ({ keep, merge }) => run(() => recordsService.merge(ctx, keep, merge)),
  );
  server.registerTool(
    "records.transact",
    {
      description:
        'Several writes (upsert, update, delete; different objects allowed) in a single transaction: one error cancels everything. Max 1000. "$n" (0-based index) refers to the record id of a previous op n: usable in id and in ref/refs fields (e.g. { company: "$0" }).',
      inputSchema: z.object({
        ops: z
          .array(
            z.discriminatedUnion("op", [
              upsertItem.extend({ op: z.literal("upsert"), object: slug }),
              z.object({
                op: z.literal("update"),
                id: z.string(),
                data,
                mode,
              }),
              z.object({ op: z.literal("delete"), id: z.string() }),
            ]),
          )
          .min(1)
          .max(1000),
      }),
    },
    ({ ops }) =>
      run(async () => {
        const ids = new Map<string, string>();
        for (const o of ops)
          if (o.op === "upsert" && !ids.has(o.object))
            ids.set(o.object, await objectId(ctx, o.object));
        return recordsService.transact(
          ctx,
          ops.map((o) =>
            o.op === "upsert"
              ? (({ object, ...rest }) => ({
                  ...rest,
                  objectId: ids.get(object)!,
                }))(o)
              : o,
          ),
        );
      }),
  );
  server.registerTool(
    "records.update",
    {
      description: "Updates a record by id (merge by default, or replace).",
      inputSchema: z.object({ id: z.string(), data, mode }),
    },
    ({ id, data, mode }) =>
      run(() => recordsService.update(ctx, id, data, mode)),
  );
  server.registerTool(
    "records.delete",
    {
      description:
        "Moves a record to the trash: it disappears from reads, searches and SQL queries; its relations (ref/refs) are removed and its timeline kept. Restorable for 30 days (records.restore), then purged.",
      inputSchema: z.object({ id: z.string() }),
    },
    ({ id }) =>
      run(() =>
        must(
          recordsService.remove(ctx, id),
          "Record",
          id,
          "Already deleted or wrong id: see records.search or records.trash.",
        ),
      ),
  );
  server.registerTool(
    "records.trash",
    {
      description:
        "An object's trash: deleted records (most recent first), with deletedAt and purgeAt (automatic purge). Next page: `after` = id of the last item.",
      inputSchema: z.object({
        object: slug,
        limit: z.number().int().optional(),
        after: z.string().optional(),
      }),
    },
    ({ object, ...p }) =>
      run(async () =>
        recordsService.trash(ctx, await objectId(ctx, object), p),
      ),
  );
  server.registerTool(
    "records.restore",
    {
      description:
        "Restores a record from the trash: same id, values, timeline and relations restored. Fails if its unique value or externalId has been taken in the meantime.",
      inputSchema: z.object({ id: z.string() }),
    },
    ({ id }) => run(() => recordsService.restore(ctx, id)),
  );
  server.registerTool(
    "records.purge",
    {
      description:
        "Empties the trash permanently: the given ids, otherwise the whole given object, otherwise the whole workspace. Irreversible: confirm: true required.",
      inputSchema: z.object({
        object: slug.optional(),
        ids: z.array(z.string()).optional(),
        confirm: z.boolean().optional(),
      }),
    },
    ({ object, ids, confirm }) =>
      run(async () => {
        requireConfirm(confirm, "records.purgeTrashConfirm", "Trash purge");
        return recordsService.purge(ctx, {
          ids,
          objectId: object ? await objectId(ctx, object) : undefined,
        });
      }),
  );
  server.registerTool(
    "records.history",
    {
      description:
        "A record's history (most recent first): creation, updates with diff { changed, before, after }, deletion, restore, actor and date.",
      inputSchema: z.object({ id: z.string() }),
    },
    ({ id }) => run(() => recordsService.history(ctx, id)),
  );
  server.registerTool(
    "records.revert",
    {
      description:
        "Restores the values from before an update: auditId = id of a record.update entry from records.history. Creates a new update.",
      inputSchema: z.object({ id: z.string(), auditId: z.string() }),
    },
    ({ id, auditId }) => run(() => recordsService.revert(ctx, id, auditId)),
  );
  server.registerTool(
    "records.update_where",
    {
      description:
        "Updates (merge) all records of an object matching the filter (max 10000). Preview required: call with dryRun: true (returns { count }), then with expected = that count.",
      inputSchema: z.object({
        object: slug,
        filter: filterSchema,
        data,
        dryRun: z.boolean().optional(),
        expected: z.number().int().optional(),
      }),
    },
    ({ object, ...input }) =>
      run(async () =>
        recordsService.updateWhere(ctx, await objectId(ctx, object), input),
      ),
  );
  server.registerTool(
    "records.delete_where",
    {
      description:
        "Moves to the trash all records of an object matching the filter (max 10000). Preview required: dryRun: true (returns { count }), then expected = that count.",
      inputSchema: z.object({
        object: slug,
        filter: filterSchema,
        dryRun: z.boolean().optional(),
        expected: z.number().int().optional(),
      }),
    },
    ({ object, ...input }) =>
      run(async () =>
        recordsService.deleteWhere(ctx, await objectId(ctx, object), input),
      ),
  );
  server.registerTool(
    "records.import_csv",
    {
      description:
        'Imports a CSV (1st line = headers, max 10000 lines). mapping { column: field key }; match = unique field (e.g. email) to update the existing record instead of creating a duplicate. Lists: JSON or values separated by ";". Each line is independent: returns { total, created, updated, unchanged, failed: [{ line, field, value, message }] (first 50), failedCount, emptyMatchKey, skipped, warnings }. onEmptyMatch (create | skip | fail, default create): what to do with a row whose match column is empty. dryRun: true to check without writing. test: true marks created records as test data (workspace.purge_test).',
      inputSchema: z.object({
        object: slug,
        csv: z.string().min(1),
        mapping: z.record(z.string(), z.string()),
        match: z.string().optional(),
        onEmptyMatch: z.enum(["create", "skip", "fail"]).optional(),
        dryRun: z.boolean().optional(),
        test: z.boolean().optional(),
      }),
    },
    ({ object, ...input }) =>
      run(async () =>
        recordsService.importCsv(ctx, await objectId(ctx, object), input),
      ),
  );
}

// Top-level batch options (test, match, mode) are defaults for each item;
// a value set on the item wins.
export function withBatchDefaults<T extends Record<string, unknown>>(
  items: T[],
  defaults: Record<string, unknown>,
): T[] {
  const set = Object.fromEntries(
    Object.entries(defaults).filter(([, v]) => v !== undefined),
  );
  return items.map((item) => ({
    ...set,
    ...Object.fromEntries(
      Object.entries(item).filter(([, v]) => v !== undefined),
    ),
  })) as T[];
}
