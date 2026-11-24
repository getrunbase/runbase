// Ingestion: POST /api/ingest/:workspace/:object[/batch], API key
// with `write` scope. Record upsert and optional event in one transaction,
// bus publications after commit. Idempotency through Idempotency-Key.
// `backfill: true`: records and events written, nothing published on the bus.
// CSV import: POST .../import, columns mapped to fields.
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authenticateApiKey, requireScope } from "../api-keys";
import { idempotencyKeys } from "../db/schema";
import { authStatus, unauthorized } from "../errors/app-error";
import { recordError } from "../errors/record";
import { insertInTx, publishEvent } from "../events";
import { objectsService } from "../objects";
import { fieldsSchema, type Field } from "../objects/fields";
import { publishUpsert, upsertInTx } from "../records";
import { parseCsv } from "../records/csv";
import { QuotaError, rateLimit } from "../quotas";
import { withTenant, type TenantContext } from "../tenant";

export const ingestItem = z
  .object({
    external_id: z.string().min(1).optional(),
    // Upsert by a unique field of the object (email, domain) instead of external_id.
    match: z.string().min(1).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    event: z
      .object({
        type: z.string().min(1),
        payload: z.record(z.string(), z.unknown()).optional(),
        occurred_at: z.coerce.date().optional(),
        source: z.string().optional(),
      })
      .optional(),
    backfill: z.boolean().optional(),
  })
  .refine((i) => !!(i?.external_id || i?.match), {
    message: "external_id or match required",
    path: ["external_id"],
    // Reported even if other fields are invalid.
    when: () => true,
  });
const batchBody = z.object({
  items: z.array(ingestItem).min(1).max(1000),
  backfill: z.boolean().optional(),
});
const importBody = z.object({
  csv: z.string().min(1),
  // CSV column -> object field key; unmapped columns ignored.
  mapping: z.record(z.string(), z.string().min(1)),
  external_id_column: z.string().min(1),
  backfill: z.boolean().optional(),
});

export type IngestRequest = {
  apiKey: string | null;
  workspaceId: string;
  objectSlug: string;
  body: unknown;
  // Raw body (HTTP): parsed only after authentication and rate
  // limiting, never for an anonymous call.
  rawBody?: string;
  batch?: boolean;
  csv?: boolean;
  idempotencyKey?: string | null;
};
export type IngestResponse = { status: number; body: unknown };

const issues = (e: z.ZodError) =>
  e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));

async function ingestOne(
  ctx: TenantContext,
  objectId: string,
  item: z.infer<typeof ingestItem>,
  backfill: boolean,
) {
  // Record and event in the same transaction; bus published after commit.
  const input = {
    objectId,
    externalId: item.external_id,
    match: item.match,
    data: item.data ?? {},
    backfill,
  };
  const { result, event } = await withTenant(ctx, async (tx) => {
    const result = await upsertInTx(tx, ctx, input);
    const event = item.event
      ? await insertInTx(tx, ctx, {
          recordId: result.record.id,
          type: item.event.type,
          payload: item.event.payload,
          occurredAt: item.event.occurred_at,
          source: item.event.source,
        })
      : null;
    return { result, event };
  });
  await publishUpsert(ctx, input, result);
  if (event) await publishEvent(ctx, { backfill }, event);
  const { record, created, changed } = result;
  return {
    external_id: item.external_id,
    record_id: record.id,
    created,
    changed,
    event_id: event?.id ?? null,
  };
}

// Converts a CSV into ingestion items according to the mapping. Empty cells
// are omitted; number/bool/multi_select (separated by ";") are converted,
// validation (types, required) stays the object's.
function csvValue(field: Field | undefined, v: string): unknown {
  if (field?.type === "number" && v.trim() !== "" && !isNaN(Number(v)))
    return Number(v);
  if (field?.type === "bool" && /^(true|false)$/i.test(v))
    return v.toLowerCase() === "true";
  if (field?.type === "multi_select") return v.split(";").map((x) => x.trim());
  return v;
}

function csvItems(body: z.infer<typeof importBody>, fields: Field[]) {
  const [header = [], ...rows] = parseCsv(body.csv);
  const idx = header.indexOf(body.external_id_column);
  if (idx < 0) return null;
  return rows.map((r) => {
    const data: Record<string, unknown> = {};
    header.forEach((col, i) => {
      const key = body.mapping[col];
      const v = r[i];
      if (key && v !== undefined && v !== "")
        data[key] = csvValue(
          fields.find((f) => f.key === key),
          v,
        );
    });
    return { external_id: r[idx] ?? "", data };
  });
}

async function run(
  ctx: TenantContext,
  req: IngestRequest,
): Promise<IngestResponse> {
  const parsed = (
    req.csv ? importBody : req.batch ? batchBody : ingestItem
  ).safeParse(req.body);
  if (!parsed.success)
    return { status: 422, body: { errors: issues(parsed.error) } };
  const object = await objectsService.get(ctx, req.objectSlug);
  if (!object) return { status: 404, body: { error: "Object not found" } };
  // Batch: item flag OR batch flag.
  const batchBackfill = parsed.data.backfill ?? false;

  const one = async (item: z.infer<typeof ingestItem>) => {
    try {
      return await ingestOne(
        ctx,
        object.id,
        item,
        (item.backfill ?? false) || batchBackfill,
      );
    } catch (e) {
      if (e instanceof z.ZodError)
        return { external_id: item.external_id, errors: issues(e) };
      throw e;
    }
  };

  if (req.csv) {
    const items = csvItems(
      parsed.data as z.infer<typeof importBody>,
      fieldsSchema.parse(object.fields),
    );
    if (!items)
      return {
        status: 422,
        body: {
          errors: [
            { path: "external_id_column", message: "Column missing from CSV" },
          ],
        },
      };
    const results = [];
    for (const item of items) results.push(await one(item));
    return { status: 200, body: { results } };
  }
  if (!req.batch) {
    const r = await one(parsed.data as z.infer<typeof ingestItem>);
    return { status: "errors" in r ? 422 : 200, body: r };
  }
  const results = [];
  for (const item of (parsed.data as z.infer<typeof batchBody>).items)
    results.push(await one(item));
  return { status: 200, body: { results } };
}

// Ingestion reference stored with the error: `object[/batch|/import]`.
const route = (req: Pick<IngestRequest, "objectSlug" | "batch" | "csv">) =>
  `${req.objectSlug}${req.csv ? "/import" : req.batch ? "/batch" : ""}`;

const failed = (res: IngestResponse) =>
  res.status >= 400 ||
  ((res.body as { results?: object[] }).results ?? []).some(
    (r) => "errors" in r,
  );

// Runs the request and records any failure (422, unknown object, upsert)
// in the error center, with the rejected body for replay.
async function runLogged(
  ctx: TenantContext,
  req: IngestRequest,
): Promise<IngestResponse> {
  const ref = {
    source: "ingest" as const,
    request: route(req),
    payload: {
      objectSlug: req.objectSlug,
      body: req.body,
      batch: req.batch ?? false,
      csv: req.csv ?? false,
    },
  };
  let res: IngestResponse;
  try {
    res = await run(ctx, req);
  } catch (e) {
    await recordError(ctx, {
      ...ref,
      message: `Upsert failed: ${(e as Error).message}`,
      stack: (e as Error).stack,
    });
    throw e;
  }
  if (failed(res))
    await recordError(ctx, {
      ...ref,
      message:
        res.status === 404
          ? `Unknown object: ${req.objectSlug}`
          : `Invalid payload (${res.status})`,
      stack: JSON.stringify(res.body),
    });
  return res;
}

// Replay of a failed ingestion (error center) with the current context.
export async function replayIngest(
  ctx: TenantContext,
  payload: Pick<IngestRequest, "objectSlug" | "body" | "batch" | "csv">,
) {
  await requireScope(ctx, "write");
  const res = await run(ctx, {
    ...payload,
    apiKey: null,
    workspaceId: ctx.workspaceId,
  });
  return { ...res, ok: !failed(res) };
}

export async function ingest(req: IngestRequest): Promise<IngestResponse> {
  try {
    if (!req.apiKey) throw unauthorized("apiKeys.required", "API key required");
    const ctx = await authenticateApiKey(req.apiKey, req.workspaceId);
    await requireScope(ctx, "write");
    await rateLimit(ctx, "api");
    if (req.rawBody !== undefined) {
      try {
        req = { ...req, body: JSON.parse(req.rawBody) };
      } catch {
        return {
          status: 422,
          body: { errors: [{ path: "", message: "Invalid JSON" }] },
        };
      }
    }
    const key = req.idempotencyKey;
    if (!key) return await runLogged(ctx, req);

    // Key bound to the workspace, the route and the body hash. Reserved
    // atomically (in-progress status) before execution, response stored after.
    const requestHash = createHash("sha256")
      .update(JSON.stringify(req.body ?? null))
      .digest("hex");
    const where = and(
      eq(idempotencyKeys.workspaceId, ctx.workspaceId),
      eq(idempotencyKeys.key, key),
    );
    const [reserved] = await withTenant(ctx, (tx) =>
      tx
        .insert(idempotencyKeys)
        .values({
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          key,
          route: route(req),
          requestHash,
        })
        .onConflictDoNothing()
        .returning(),
    );
    if (!reserved) {
      const [seen] = await withTenant(ctx, (tx) =>
        tx.select().from(idempotencyKeys).where(where),
      );
      if (!seen)
        return {
          status: 409,
          body: { error: "Request is being processed" },
        };
      if (seen.route !== route(req) || seen.requestHash !== requestHash)
        return {
          status: 422,
          body: {
            error: "Idempotency-Key already used for another request",
          },
        };
      // Key already seen: replay the stored response without rewriting anything.
      if (seen.status !== null)
        return { status: seen.status, body: seen.response };
      return { status: 409, body: { error: "Request is being processed" } };
    }
    let res: IngestResponse;
    try {
      res = await runLogged(ctx, req);
    } catch (e) {
      // Failure: release the key to allow a new attempt.
      await withTenant(ctx, (tx) => tx.delete(idempotencyKeys).where(where));
      throw e;
    }
    await withTenant(ctx, (tx) =>
      tx
        .update(idempotencyKeys)
        .set({ status: res.status, response: res.body })
        .where(where),
    );
    return res;
  } catch (e) {
    const status = authStatus(e);
    if (status) return { status, body: { error: (e as Error).message } };
    if (e instanceof QuotaError)
      return { status: e.status, body: { error: e.message } };
    throw e;
  }
}
