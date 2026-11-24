// Data blocks: write and search through the records service
// (schema validation, audit, bus).
import { z } from "zod";
import { defineBlock, type BlockServices } from "../block";
import type { Filter } from "../../filter";
import { appError, notFound } from "../../errors/app-error";

const data = z.record(z.string(), z.unknown());

async function objectId(objects: BlockServices["objects"], slug: string) {
  const obj = await objects.get(slug);
  if (!obj)
    throw notFound("blocks.unknownObject", "Unknown object: {object}", {
      object: slug,
    });
  return obj.id;
}

// Writes one or more fields of a record (merge).
export const recordUpdate = defineBlock({
  type: "record.update",
  label: "Update a record",
  description: "Updates one or more fields of a record.",
  sideEffect: true,
  inputSchema: z.object({ recordId: z.string(), data }),
  outputSchema: z.object({ record: z.unknown(), changed: z.array(z.string()) }),
  branches: ["ok"],
  run: async ({ recordId, data }, { services }) => {
    const { record, changed } = await services.records.update(recordId, data);
    return { branch: "ok", output: { record, changed } };
  },
});

// Deletes a record (relations and timeline included).
export const recordDelete = defineBlock({
  type: "record.delete",
  label: "Delete a record",
  description: "Permanently deletes a record.",
  sideEffect: true,
  inputSchema: z.object({ recordId: z.string() }),
  outputSchema: z.object({ deleted: z.boolean() }),
  branches: ["ok", "not_found"],
  run: async ({ recordId }, { services }) => {
    const row = await services.records.remove(recordId);
    return { branch: row ? "ok" : "not_found", output: { deleted: !!row } };
  },
});

// Creates a record in a workspace object (slug).
export const recordCreate = defineBlock({
  type: "record.create",
  label: "Create a record",
  description: "Creates a record in an object of a database.",
  sideEffect: true,
  inputSchema: z.object({ object: z.string().min(1), data }),
  outputSchema: z.object({ record: z.unknown() }),
  branches: ["ok"],
  run: async ({ object, data }, { services }) => {
    const { record } = await services.records.upsert({
      objectId: await objectId(services.objects, object),
      data,
    });
    return { branch: "ok", output: { record } };
  },
});

// Search by DSL filter; `records` feeds a loop.
export const recordSearch = defineBlock({
  type: "record.search",
  label: "Search records",
  description: "Searches the records of an object with a filter.",
  sideEffect: false,
  inputSchema: z.object({
    object: z.string().min(1),
    filter: z.unknown().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  outputSchema: z.object({ records: z.array(z.unknown()) }),
  branches: ["found", "empty"],
  run: async ({ object, filter, limit }, { services }) => {
    const records = await services.records.search(
      await objectId(services.objects, object),
      {
        filter: filter as Filter | undefined,
        pagination: { limit },
      },
    );
    return { branch: records.length ? "found" : "empty", output: { records } };
  },
});

// Creates or updates by key: `match` (unique field, e.g. email) or
// `externalId`. Idempotent: replaying the step creates no duplicate.
export const recordUpsert = defineBlock({
  type: "record.upsert",
  label: "Create or update a record",
  description:
    "Upsert by unique field (email, domain…) or external id, without duplicates.",
  sideEffect: true,
  inputSchema: z.object({
    object: z.string().min(1),
    data,
    match: z.string().optional(),
    externalId: z.string().optional(),
  }),
  outputSchema: z.object({
    record: z.unknown(),
    created: z.boolean(),
    changed: z.array(z.string()),
  }),
  branches: ["created", "updated"],
  run: async ({ object, data, match, externalId }, { services }) => {
    if (!match && !externalId)
      throw appError(
        "blocks.matchOrExternalIdRequired",
        "match or externalId required",
      );
    const r = await services.records.upsert({
      objectId: await objectId(services.objects, object),
      data,
      match,
      externalId,
    });
    return {
      branch: r.created ? "created" : "updated",
      output: { record: r.record, created: r.created, changed: r.changed },
    };
  },
});

// Atomic merge: `keep` absorbs `merge` (fields, relations, timeline).
export const recordMerge = defineBlock({
  type: "record.merge",
  label: "Merge records",
  description:
    "Merges duplicates into one record: fields, relations and timeline, all or nothing.",
  sideEffect: true,
  inputSchema: z.object({
    keep: z.string(),
    merge: z.array(z.string()).min(1),
  }),
  outputSchema: z.object({ record: z.unknown(), merged: z.array(z.string()) }),
  branches: ["ok"],
  run: async ({ keep, merge }, { services }) => {
    const r = await services.records.merge(keep, merge);
    return { branch: "ok", output: { record: r.record, merged: r.merged } };
  },
});

const op = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("upsert"),
    object: z.string().min(1),
    data,
    match: z.string().optional(),
    externalId: z.string().optional(),
  }),
  z.object({ op: z.literal("update"), id: z.string(), data }),
  z.object({ op: z.literal("delete"), id: z.string() }),
]);

// Transaction: several writes applied together or not at all.
export const recordTransact = defineBlock({
  type: "record.transact",
  label: "Batch writes",
  description:
    "Applies several creates, updates and deletes in one transaction.",
  sideEffect: true,
  inputSchema: z.object({ ops: z.array(op).min(1).max(1000) }),
  outputSchema: z.object({ results: z.array(z.unknown()) }),
  branches: ["ok"],
  run: async ({ ops }, { services }) => {
    const ids = new Map<string, string>();
    for (const o of ops)
      if (o.op === "upsert" && !ids.has(o.object))
        ids.set(o.object, await objectId(services.objects, o.object));
    const results = await services.records.transact(
      ops.map((o) =>
        o.op === "upsert"
          ? {
              op: "upsert" as const,
              objectId: ids.get(o.object)!,
              data: o.data,
              match: o.match,
              externalId: o.externalId,
            }
          : o,
      ),
    );
    return { branch: "ok", output: { results } };
  },
});
