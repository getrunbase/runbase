// record.map block: copies a source record (any
// database) to a target object, target field <- expression. An expression is
// `{ path }` (field or relation path of the source record, e.g.
// `contact.entreprise.nom`) or `{ value }` (constant or `{{…}}` template,
// rendered by the engine).
import { z } from "zod";
import { defineBlock, type BlockServices } from "../block";
import { recordValidator } from "../../objects/fields";
import { resolveRelation, schemaGraph } from "../../filter";
import {
  appError,
  errorItem,
  notFound,
  type ErrorItem,
} from "../../errors/app-error";

const expr = z.union([
  z.strictObject({ path: z.string().min(1) }),
  z.strictObject({ value: z.unknown() }),
]);

export const recordMapInput = z.object({
  // Source record id, e.g. `{{record.id}}` (trigger).
  source: z.string().min(1),
  // Source object slug: validates paths when saving.
  sourceObject: z.string().min(1).optional(),
  object: z.string().min(1),
  mode: z.enum(["create", "update", "upsert"]).default("create"),
  // update: target record.
  recordId: z.string().optional(),
  // upsert: `external_id` or key of a target field present in the mapping.
  key: z.string().optional(),
  externalId: z.string().optional(),
  mapping: z.record(z.string(), expr),
});
type Input = z.infer<typeof recordMapInput>;

const isTemplate = (v: unknown) => typeof v === "string" && v.includes("{{");

// Mapping errors against the source and target schemas (when saving).
export async function validateMapping(
  list: BlockServices["objects"]["list"],
  raw: unknown,
  step = "record.map",
): Promise<ErrorItem[]> {
  const parsed = recordMapInput.safeParse(raw);
  if (!parsed.success) return []; // input errors already reported
  const input = parsed.data;
  const rows = await list();
  const errors: ErrorItem[] = [];
  const target = schemaGraph(input.object, rows).objects[input.object];
  if (!target)
    return [
      errorItem(
        "blocks.mapUnknownTarget",
        "{step}: unknown target object: {object}",
        {
          step,
          object: input.object,
        },
      ),
    ];
  const validate = recordValidator(target.fields).shape;
  if (input.mode === "update" && !input.recordId)
    errors.push(
      errorItem(
        "blocks.mapRecordIdRequired",
        "{step}: recordId required in update mode",
        { step },
      ),
    );
  if (input.mode === "upsert") {
    if (!input.key)
      errors.push(
        errorItem(
          "blocks.mapKeyRequired",
          "{step}: key required in upsert mode",
          {
            step,
          },
        ),
      );
    else if (input.key === "external_id") {
      if (!input.externalId)
        errors.push(
          errorItem(
            "blocks.mapExternalIdRequired",
            "{step}: externalId required",
            {
              step,
            },
          ),
        );
    } else if (!input.mapping[input.key])
      errors.push(
        errorItem(
          "blocks.mapKeyNotMapped",
          "{step}: key {key} missing from the mapping",
          { step, key: input.key },
        ),
      );
  }
  const graph = input.sourceObject
    ? schemaGraph(input.sourceObject, rows)
    : undefined;
  const source = graph?.objects[input.sourceObject!];
  if (input.sourceObject && !source)
    errors.push(
      errorItem(
        "blocks.mapUnknownSource",
        "{step}: unknown source object: {object}",
        {
          step,
          object: input.sourceObject,
        },
      ),
    );
  for (const [k, e] of Object.entries(input.mapping)) {
    const field = validate[k] as z.ZodType | undefined;
    if (!field) {
      errors.push(
        errorItem(
          "blocks.mapUnknownField",
          "{step}: mapping.{field}: unknown target field",
          { step, field: k },
        ),
      );
      continue;
    }
    if ("value" in e) {
      if (!isTemplate(e.value) && !field.safeParse(e.value).success)
        errors.push(
          errorItem(
            "blocks.mapInvalidValue",
            "{step}: mapping.{field}: invalid value",
            { step, field: k },
          ),
        );
    } else if (source && graph) {
      const segs = e.path.split(".");
      const last = segs.pop()!;
      try {
        let fields = source.fields;
        if (segs.length) {
          const hops = resolveRelation(source.fields, graph, segs.join("."));
          const id = hops.at(-1)!.objectId;
          fields = Object.values(graph.objects).find(
            (o) => o.id === id,
          )!.fields;
        }
        if (last !== "id" && !fields.some((f) => f.key === last))
          // eslint-disable-next-line no-restricted-syntax -- caught just below
          throw new Error();
      } catch {
        errors.push(
          errorItem(
            "blocks.mapUnknownPath",
            "{step}: mapping.{field}: unknown source path {path}",
            { step, field: k, path: e.path },
          ),
        );
      }
    }
  }
  return errors;
}

// Value of a source record path (relations followed through include).
export async function readPath(
  records: BlockServices["records"],
  sourceId: string,
  path: string,
) {
  const segs = path.split(".");
  const last = segs.pop()!;
  const rel = segs.join(".");
  const rec = await records.get(sourceId, rel ? { include: [rel] } : {});
  const at = (r: { id: string; data: Record<string, unknown> } | null) =>
    r ? (last === "id" ? r.id : (r.data[last] ?? null)) : null;
  if (!rel) return at(rec);
  const inc = rec.included[rel];
  return Array.isArray(inc) ? inc.map(at) : at(inc ?? null);
}

async function mapData(input: Input, records: BlockServices["records"]) {
  const data: Record<string, unknown> = {};
  for (const [k, e] of Object.entries(input.mapping))
    data[k] =
      "value" in e ? e.value : await readPath(records, input.source, e.path);
  return data;
}

export const recordMap = defineBlock({
  type: "record.map",
  label: "Copy a record",
  description: "Copies a record to an object in any database, field by field.",
  sideEffect: true,
  inputSchema: recordMapInput,
  outputSchema: z.object({ record: z.unknown(), created: z.boolean() }),
  branches: ["ok"],
  simulate: () => ({
    branch: "ok",
    output: { record: null, created: false },
  }),
  run: async (input, { services }) => {
    const obj = await services.objects.get(input.object);
    if (!obj)
      throw notFound("blocks.unknownObject", "Unknown object: {object}", {
        object: input.object,
      });
    const data = await mapData(input, services.records);
    let targetId = input.mode === "update" ? input.recordId : undefined;
    if (input.mode === "upsert" && input.key && input.key !== "external_id") {
      const [hit] = await services.records.search(obj.id, {
        filter: { field: input.key, op: "eq", value: data[input.key] as never },
        pagination: { limit: 1 },
      });
      targetId = hit?.id;
    }
    if (targetId) {
      const { record } = await services.records.update(targetId, data);
      return { branch: "ok", output: { record, created: false } };
    }
    if (input.mode === "update")
      throw appError("blocks.mapRecordIdRequired", "recordId required");
    const { record, created } = await services.records.upsert({
      objectId: obj.id,
      data,
      externalId:
        input.mode === "upsert" && input.key === "external_id"
          ? input.externalId
          : undefined,
    });
    return { branch: "ok", output: { record, created } };
  },
});
