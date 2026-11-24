// Signed incoming webhooks: POST /api/hooks/<id> (public). The signature is
// verified on the raw body with the vault secret, then the payload becomes
// an `eventType` event (workflow trigger), deduplicated by the external
// id: a provider replay restarts nothing.
// Formats : `stripe`, `standard` (Standard Webhooks / Svix), `hmac`
// (configurable: header, algorithm, encoding, prefix, signed timestamp, `kv`
// value "t=…,v1=…", secret encoding). Cal.com = hmac sha256 hex on
// `x-cal-signature-256`; GitHub-like = `sha256=` prefix; `stripe` = hmac
// kv on `stripe-signature` (same code).
// Deduplication (`dedupe`): `id` (default) = a resend of the same external id is
// discarded (response `duplicate: true`, no workflow); `id+hash` = discarded
// only if the content is identical, an enriched resend creates a new
// event; `none` = each call creates an event.
// Batches: `splitPath` (e.g. `events`) or a root array give one event per
// element, deduplicated by `idPath` relative to the element.
// Test mode (`/api/hooks/<id>/test`): signature verified and sample stored,
// no event pushed, hence no workflow started.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { db } from "../db/client";
import { webhooks } from "../db/schema";
import { eventsService } from "../events";
import { decryptAll, decryptSecret, secretNameSchema } from "../secrets";
import { withTenant, type TenantContext } from "../tenant";
import { appError, notFound } from "../errors/app-error";

export const webhookConfigSchema = z.discriminatedUnion("format", [
  z.object({
    format: z.literal("stripe"),
    toleranceSec: z.number().optional(),
  }),
  z.object({
    format: z.literal("standard"),
    toleranceSec: z.number().optional(),
  }),
  z.object({
    format: z.literal("hmac"),
    header: z.string().min(1),
    algorithm: z.enum(["sha256", "sha1", "sha512"]).default("sha256"),
    encoding: z.enum(["hex", "base64"]).default("hex"),
    // Prefix of the header value, e.g. `sha256=`.
    prefix: z.string().optional(),
    // `kv`: header "t=<unix>,v1=<sig>[,v1=<sig>…]" (Stripe format under
    // another name), configurable keys, one valid signature is enough.
    headerFormat: z.enum(["raw", "kv"]).optional(),
    timestampKey: z.string().min(1).optional(),
    signatureKey: z.string().min(1).optional(),
    // HMAC key: raw string (default), base64, or `whsec_<base64>`.
    secretEncoding: z.enum(["raw", "base64", "whsec"]).optional(),
    // Signed timestamp: signed content = template ({timestamp} or {t},
    // {body}). `signedPayload` = alias of `template`.
    timestampHeader: z.string().optional(),
    template: z.string().optional(),
    signedPayload: z.string().optional(),
    toleranceSec: z.number().optional(),
    // Header carrying the event id (otherwise `idPath` in the body).
    idHeader: z.string().optional(),
  }),
]);
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

// Shared options: path of the external id (`id`, `data.id`…, relative to
// the element in a batch), path of the array to split, sample storage.
const optionsSchema = z.object({
  idPath: z.string().min(1).optional(),
  splitPath: z.string().min(1).optional(),
  storeSample: z.boolean().optional(),
  dedupe: z.enum(["id", "id+hash", "none"]).optional(),
});
type WebhookOptions = z.infer<typeof optionsSchema>;

type Headers = Record<string, string | undefined>;

const hmac = (algo: string, key: string | Buffer, msg: string) =>
  createHmac(algo, key).update(msg);

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function fresh(ts: string | undefined, toleranceSec = 300, now = Date.now()) {
  const t = Number(ts);
  return Number.isFinite(t) && Math.abs(now / 1000 - t) <= toleranceSec;
}

type HmacConfig = Extract<WebhookConfig, { format: "hmac" }>;

// `stripe` = special case of the hmac config.
const asHmac = (config: WebhookConfig): HmacConfig | null =>
  config.format === "stripe"
    ? {
        format: "hmac",
        header: "stripe-signature",
        algorithm: "sha256",
        encoding: "hex",
        headerFormat: "kv",
        toleranceSec: config.toleranceSec,
      }
    : config.format === "hmac"
      ? config
      : null;

const hmacKey = (c: HmacConfig, secret: string) =>
  c.secretEncoding === "base64"
    ? Buffer.from(secret, "base64")
    : c.secretEncoding === "whsec"
      ? Buffer.from(secret.replace(/^whsec_/, ""), "base64")
      : secret;

function signHmac(c: HmacConfig, secret: string, body: string, ts?: string) {
  // Without timestamp, signed content = raw body (template ignored, as before).
  const tpl =
    ts === undefined
      ? "{body}"
      : (c.signedPayload ?? c.template ?? "{t}.{body}");
  // Replacement by function: a `$` in the body stays literal.
  const msg = tpl.replace(/\{(t|timestamp|body)\}/g, (_, k) =>
    k === "body" ? body : (ts ?? ""),
  );
  return hmac(c.algorithm ?? "sha256", hmacKey(c, secret), msg).digest(
    c.encoding ?? "hex",
  );
}

const kvParts = (raw: string) =>
  raw.split(",").map((p) => {
    const i = p.indexOf("=");
    return i < 0
      ? [p.trim(), ""]
      : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  });

// Signature headers read and timestamp checked, without the secret: an
// unsigned call or one replayed outside the tolerance is refused before any
// decryption. null = missing or expired signature.
type Signed = { sigs: string[]; ts?: string; id?: string };
export function readSignature(
  config: WebhookConfig,
  h: Headers,
  now = Date.now(),
): Signed | null {
  if (config.format === "standard") {
    const id = h["webhook-id"] ?? h["svix-id"];
    const ts = h["webhook-timestamp"] ?? h["svix-timestamp"];
    const sigs = (h["webhook-signature"] ?? h["svix-signature"] ?? "")
      .split(" ")
      .filter((s) => s.startsWith("v1,"))
      .map((s) => s.slice(3));
    if (!id || !fresh(ts, config.toleranceSec, now) || !sigs.length)
      return null;
    return { sigs, ts, id };
  }
  const c = asHmac(config)!;
  const raw = h[c.header.toLowerCase()] ?? "";
  let sigs: string[];
  let ts: string | undefined;
  if (c.headerFormat === "kv") {
    const parts = kvParts(raw);
    ts = parts.find(([k]) => k === (c.timestampKey ?? "t"))?.[1];
    sigs = parts
      .filter(([k]) => k === (c.signatureKey ?? "v1"))
      .map(([, v]) => v ?? "");
    if (!fresh(ts, c.toleranceSec, now)) return null;
  } else {
    sigs = [
      c.prefix && raw.startsWith(c.prefix) ? raw.slice(c.prefix.length) : raw,
    ];
    if (c.timestampHeader) {
      ts = h[c.timestampHeader.toLowerCase()];
      if (!fresh(ts, c.toleranceSec, now)) return null;
    }
  }
  sigs = sigs.filter(Boolean);
  if (!sigs.length) return null;
  const id = c.idHeader ? h[c.idHeader.toLowerCase()] : undefined;
  return { sigs, ts, id };
}

// Signature read by readSignature, compared in constant time.
function signatureMatches(
  config: WebhookConfig,
  secret: string,
  body: string,
  { sigs, ts, id }: Signed,
) {
  const want =
    config.format === "standard"
      ? hmac(
          "sha256",
          Buffer.from(secret.replace(/^whsec_/, ""), "base64"),
          `${id}.${ts}.${body}`,
        ).digest("base64")
      : signHmac(asHmac(config)!, secret, body, ts);
  return sigs.some((s) => safeEqual(s, want));
}

// Verifies the signature; returns the event id carried by the headers (standard).
export function verifySignature(
  config: WebhookConfig,
  secret: string,
  body: string,
  h: Headers,
  now = Date.now(),
): { ok: boolean; id?: string } {
  const signed = readSignature(config, h, now);
  if (!signed) return { ok: false };
  return {
    ok: signatureMatches(config, secret, body, signed),
    id: signed.id,
  };
}

// Headers signed as the provider would: used for the test send
// from the interface (checks secret and configuration end to end).
export function signFor(
  config: WebhookConfig,
  secret: string,
  body: string,
  now = Date.now(),
): Headers {
  const ts = String(Math.floor(now / 1000));
  if (config.format === "standard") {
    const id = `msg_test_${now}`;
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const sig = hmac("sha256", key, `${id}.${ts}.${body}`).digest("base64");
    return {
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": `v1,${sig}`,
    };
  }
  const c = asHmac(config)!;
  const header = c.header.toLowerCase();
  if (c.headerFormat === "kv")
    return {
      [header]: `${c.timestampKey ?? "t"}=${ts},${c.signatureKey ?? "v1"}=${signHmac(c, secret, body, ts)}`,
    };
  const h: Headers = {};
  if (c.timestampHeader) h[c.timestampHeader.toLowerCase()] = ts;
  h[header] =
    (c.prefix ?? "") +
    signHmac(c, secret, body, c.timestampHeader ? ts : undefined);
  return h;
}

// Value of a dotted path (`a.b.0.c`) in a JSON.
export const pick = (o: unknown, path: string) =>
  path
    .split(".")
    .reduce<unknown>((v, k) => (v == null ? undefined : (v as never)[k]), o);

export type WebhookResponse = { status: number; body: unknown };

// Elements of a payload: array at `splitPath`, root array, otherwise the
// payload alone.
export function splitPayload(payload: unknown, splitPath?: string) {
  const list = splitPath ? pick(payload, splitPath) : payload;
  if (splitPath && !Array.isArray(list))
    throw appError("webhooks.splitPathNotArray", "splitPath {path}: not an array", {
      path: splitPath,
    });
  return Array.isArray(list) ? list : [payload];
}

const asObject = (v: unknown) =>
  (v && typeof v === "object" && !Array.isArray(v)
    ? v
    : { value: v }) as Record<string, unknown>;

// Public reception. The webhook is read without tenant (unguessable id), everything
// else goes through its creator's context. `test`: nothing is pushed.
export async function receiveWebhook(
  id: string,
  body: string,
  headers: Headers,
  opts: { test?: boolean } = {},
): Promise<WebhookResponse> {
  if (!z.uuid().safeParse(id).success)
    return { status: 404, body: { error: "Webhook not found" } };
  const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, id));
  if (!hook) return { status: 404, body: { error: "Webhook not found" } };
  const ctx: TenantContext = {
    organizationId: hook.organizationId,
    workspaceId: hook.workspaceId,
    actor: hook.createdByKey
      ? { apiKeyId: hook.createdByKey, scopes: ["write"] }
      : { userId: hook.createdBy! },
  };
  const config = webhookConfigSchema.parse(hook.config);
  // Missing headers or expired timestamp: refused without decrypting the secret.
  const signed = readSignature(config, headers);
  if (!signed) return { status: 401, body: { error: "Invalid signature" } };
  const secret = await decryptSecret(ctx, hook.secretName);
  if (!secret) return { status: 500, body: { error: "Secret missing" } };
  if (!signatureMatches(config, secret, body, signed))
    return { status: 401, body: { error: "Invalid signature" } };
  const headerId = signed.id;
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { status: 422, body: { error: "Invalid JSON" } };
  }
  const o = hook.config as WebhookOptions;
  const saveSample = () =>
    db
      .update(webhooks)
      .set({ sample: payload, sampleAt: new Date() })
      .where(eq(webhooks.id, hook.id));
  if (opts.test) {
    await saveSample();
    return { status: 200, body: { test: true, events: [] } };
  }
  let items: unknown[];
  try {
    items = splitPayload(payload, o.splitPath);
  } catch (e) {
    return { status: 422, body: { error: (e as Error).message } };
  }
  const batch = items.length > 1 || !!o.splitPath || Array.isArray(payload);
  const out = [];
  for (const [i, item] of items.entries()) {
    // Header id (standard) takes precedence outside batches; in a batch, the
    // element id, otherwise header id + rank.
    const own = pick(item, o.idPath ?? "id");
    const ext = !batch
      ? (headerId ?? own)
      : own != null && own !== ""
        ? own
        : headerId && `${headerId}:${i}`;
    // `id+hash`: key = id + fingerprint of the element content.
    const key =
      o.dedupe === "none" || ext == null || ext === ""
        ? null
        : `webhook:${hook.id}:${String(ext)}` +
          (o.dedupe === "id+hash"
            ? `:${createHash("sha256").update(JSON.stringify(item)).digest("hex").slice(0, 32)}`
            : "");
    const event = await eventsService.insert(ctx, {
      type: hook.eventType,
      payload: asObject(item),
      source: `webhook:${hook.name}`,
      idempotencyKey: key,
    });
    out.push({ event_id: event.id, duplicate: event.duplicate });
  }
  const duplicate = out.every((e) => e.duplicate);
  // Sample for the mapping: last new one received (a replay does not overwrite it).
  if (!duplicate && o.storeSample !== false) await saveSample();
  return {
    status: 200,
    body: batch
      ? { events: out, duplicate }
      : { event_id: out[0]?.event_id, duplicate },
  };
}

export type WebhookInput = {
  name: string;
  eventType: string;
  secretName: string;
  config: WebhookConfig & WebhookOptions;
};

const res = (id: string) => ({ type: "webhook", id });

const parseConfig = (config: WebhookInput["config"]) => ({
  ...webhookConfigSchema.parse(config),
  ...optionsSchema.parse({
    idPath: config.idPath,
    splitPath: config.splitPath,
    storeSample: config.storeSample,
    dedupe: config.dedupe,
  }),
});

// Name already taken in the workspace: readable message rather than the SQL error.
const uniqueName = (e: unknown) => {
  const err = ((e as { cause?: unknown }).cause ?? e) as { code?: string };
  if (err.code === "23505")
    throw appError(
      "webhooks.nameTaken",
      "A webhook with this name already exists in this workspace",
      {},
      { kind: "conflict" },
    );
  throw e;
};

const inWs = (ctx: TenantContext, id: string) =>
  and(eq(webhooks.id, id), eq(webhooks.workspaceId, ctx.workspaceId));

// URLs: production (starts workflows) and test (stores the sample only).
const withPaths = <T extends { id: string }>(row: T) => ({
  ...row,
  path: `/api/hooks/${row.id}`,
  testPath: `/api/hooks/${row.id}/test`,
});

export const webhooksService = {
  list: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select()
        .from(webhooks)
        .where(eq(webhooks.workspaceId, ctx.workspaceId))
        .orderBy(webhooks.createdAt),
    );
    return rows.map(withPaths);
  },
  // The creator (user or API key) becomes the actor of the received events:
  // revoking the key or removing the member cuts the webhook.
  create: async (ctx: TenantContext, input: WebhookInput) => {
    await requireScope(ctx, "admin");
    const config = parseConfig(input.config);
    const secretName = secretNameSchema.parse(input.secretName);
    const a = ctx.actor;
    return withTenant(ctx, async (tx) => {
      const [row] = await tx
        .insert(webhooks)
        .values({
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          name: z.string().min(1).parse(input.name),
          eventType: z.string().min(1).parse(input.eventType),
          secretName,
          config,
          createdBy: "userId" in a ? a.userId : null,
          createdByKey: "apiKeyId" in a ? a.apiKeyId : null,
        })
        .returning();
      await audit(tx, ctx, "webhook.create", res(row!.id), input);
      return withPaths(row!);
    }).catch(uniqueName);
  },
  // Changes name, event type, secret or config: the URL (id) does not change.
  update: async (
    ctx: TenantContext,
    id: string,
    patch: Partial<WebhookInput>,
  ) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, async (tx) => {
      const set = {
        ...(patch.name !== undefined && {
          name: z.string().min(1).parse(patch.name),
        }),
        ...(patch.eventType !== undefined && {
          eventType: z.string().min(1).parse(patch.eventType),
        }),
        ...(patch.secretName !== undefined && {
          secretName: secretNameSchema.parse(patch.secretName),
        }),
        ...(patch.config && { config: parseConfig(patch.config) }),
      };
      if (!Object.keys(set).length) {
        const [row] = await tx.select().from(webhooks).where(inWs(ctx, id));
        return row ? withPaths(row) : null;
      }
      const [row] = await tx
        .update(webhooks)
        .set(set)
        .where(inWs(ctx, id))
        .returning();
      if (!row) return null;
      await audit(tx, ctx, "webhook.update", res(id), patch);
      return withPaths(row);
    }).catch(uniqueName);
  },
  // Clears the stored sample (sensitive payload, or new listening).
  clearSample: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, async (tx) => {
      const [row] = await tx
        .update(webhooks)
        .set({ sample: null, sampleAt: null })
        .where(inWs(ctx, id))
        .returning({ id: webhooks.id });
      if (row) await audit(tx, ctx, "webhook.clear_sample", res(id));
      return !!row;
    });
  },
  // Signed test send in test mode: stores the sample, starts nothing.
  sendTest: async (ctx: TenantContext, id: string, payload: unknown) => {
    await requireScope(ctx, "admin");
    const [hook] = await withTenant(ctx, (tx) =>
      tx.select().from(webhooks).where(inWs(ctx, id)),
    );
    if (!hook) throw notFound("webhooks.notFound", "Webhook not found");
    const secret = (await decryptAll(ctx))[hook.secretName];
    if (!secret)
      throw appError(
        "webhooks.secretMissing",
        "Secret {name} is missing: create it first",
        { name: hook.secretName },
      );
    const body = JSON.stringify(payload);
    const config = webhookConfigSchema.parse(hook.config);
    return receiveWebhook(id, body, signFor(config, secret, body), {
      test: true,
    });
  },
  remove: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, async (tx) => {
      const [row] = await tx.delete(webhooks).where(inWs(ctx, id)).returning();
      if (row) await audit(tx, ctx, "webhook.delete", res(id), row);
      return row ?? null;
    });
  },
};
