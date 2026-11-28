// Incoming webhooks: signatures (unit) and deduplicated reception
// (integration, DATABASE_URL).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import postgres from "postgres";
import { apiKeysService } from "../api-keys";
import { secretsService } from "../secrets";
import { eventsService } from "../events";
import type { TenantContext } from "../tenant";
import {
  parseBody,
  receiveWebhook,
  signFor,
  verifySignature,
  webhooksService,
} from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

const body = '{"id":"evt_1","type":"invoice.paid"}';
const now = Date.now();
const ts = String(Math.floor(now / 1000));
const hex = (k: string | Buffer, m: string, a = "sha256") =>
  createHmac(a, k).update(m).digest("hex");

test("stripe: signature, expired timestamp, wrong key", () => {
  const h = {
    "stripe-signature": `t=${ts},v1=${hex("whsec_s", `${ts}.${body}`)}`,
  };
  assert.equal(
    verifySignature({ format: "stripe" }, "whsec_s", body, h, now).ok,
    true,
  );
  assert.equal(
    verifySignature({ format: "stripe" }, "autre", body, h, now).ok,
    false,
  );
  assert.equal(
    verifySignature({ format: "stripe" }, "whsec_s", body, h, now + 600_000).ok,
    false,
  );
});

test("standard (svix): base64 key, id in header", () => {
  const key = Buffer.from("secret-key-123");
  const secret = `whsec_${key.toString("base64")}`;
  const sig = createHmac("sha256", key)
    .update(`msg_1.${ts}.${body}`)
    .digest("base64");
  const h = {
    "webhook-id": "msg_1",
    "webhook-timestamp": ts,
    "webhook-signature": `v1,AAAA v1,${sig}`,
  };
  assert.deepEqual(
    verifySignature({ format: "standard" }, secret, body, h, now),
    {
      ok: true,
      id: "msg_1",
    },
  );
  assert.equal(
    verifySignature({ format: "standard" }, secret, body + " ", h, now).ok,
    false,
  );
});

test("hmac: cal.com (hex), sha256= prefix, base64, signed timestamp", () => {
  const cfg = (o: object) =>
    ({ format: "hmac", algorithm: "sha256", encoding: "hex", ...o }) as never;
  assert.equal(
    verifySignature(cfg({ header: "X-Cal-Signature-256" }), "k", body, {
      "x-cal-signature-256": hex("k", body),
    }).ok,
    true,
  );
  assert.equal(
    verifySignature(
      cfg({ header: "x-hub-signature-256", prefix: "sha256=" }),
      "k",
      body,
      {
        "x-hub-signature-256": `sha256=${hex("k", body)}`,
      },
    ).ok,
    true,
  );
  const b64 = createHmac("sha512", "k").update(body).digest("base64");
  assert.equal(
    verifySignature(
      cfg({ header: "x-sig", algorithm: "sha512", encoding: "base64" }),
      "k",
      body,
      {
        "x-sig": b64,
      },
    ).ok,
    true,
  );
  assert.equal(
    verifySignature(
      cfg({ header: "x-sig", timestampHeader: "x-ts" }),
      "k",
      body,
      {
        "x-sig": hex("k", `${ts}.${body}`),
        "x-ts": ts,
      },
      now,
    ).ok,
    true,
  );
  assert.equal(
    verifySignature(cfg({ header: "x-sig" }), "k", body, {}).ok,
    false,
  );
  // Template without timestampHeader: ignored, raw body signed (legacy behavior).
  assert.equal(
    verifySignature(
      cfg({ header: "x-sig", template: "{timestamp}.{body}" }),
      "k",
      body,
      {
        "x-sig": createHmac("sha256", "k").update(body).digest("hex"),
      },
    ).ok,
    true,
  );
});

async function owner(name: string): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values (${name}) returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'h', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

test("reception: 401 without signature, event pushed only once", async () => {
  const ctx = await owner("Hook");
  await secretsService.set(ctx, "CAL_SECRET", "k");
  const hook = await webhooksService.create(ctx, {
    name: "calcom",
    eventType: "cal.booking",
    secretName: "CAL_SECRET",
    config: { format: "hmac", header: "x-cal-signature-256" } as never,
  });
  assert.equal((await receiveWebhook(hook.id, body, {})).status, 401);
  assert.equal(
    (await receiveWebhook(crypto.randomUUID(), body, {})).status,
    404,
  );
  const h = { "x-cal-signature-256": hex("k", body) };
  const r1 = await receiveWebhook(hook.id, body, h);
  const r2 = await receiveWebhook(hook.id, body, h);
  assert.equal(r1.status, 200);
  assert.deepEqual(r2.body, { ...(r1.body as object), duplicate: true });
  assert.equal((r1.body as { duplicate: boolean }).duplicate, false);
  assert.deepEqual(await eventsService.types(ctx), ["cal.booking"]);
});

const signed = (b: unknown) => {
  const raw = JSON.stringify(b);
  return [raw, { "x-sig": hex("k", raw) }] as const;
};

test("batch: one event per element (splitPath, root array), deduplicated per element", async () => {
  const ctx = await owner("HookBatch");
  await secretsService.set(ctx, "K", "k");
  const hook = await webhooksService.create(ctx, {
    name: "lot",
    eventType: "lot.item",
    secretName: "K",
    config: {
      format: "hmac",
      header: "x-sig",
      splitPath: "events",
      idPath: "uid",
    } as never,
  });
  const [b1, h1] = signed({ events: [{ uid: "a" }, { uid: "b" }] });
  const r1 = await receiveWebhook(hook.id, b1, h1);
  assert.deepEqual(
    (r1.body as { events: { duplicate: boolean }[] }).events.map(
      (e) => e.duplicate,
    ),
    [false, false],
  );
  // "b" already received: only "c" is new.
  const [b2, h2] = signed({ events: [{ uid: "b" }, { uid: "c" }] });
  const r2 = await receiveWebhook(hook.id, b2, h2);
  assert.deepEqual(
    (r2.body as { events: { duplicate: boolean }[] }).events.map(
      (e) => e.duplicate,
    ),
    [true, false],
  );
  const [b3, h3] = signed({ events: {} });
  assert.equal((await receiveWebhook(hook.id, b3, h3)).status, 422);

  const root = await webhooksService.create(ctx, {
    name: "racine",
    eventType: "root.item",
    secretName: "K",
    config: { format: "hmac", header: "x-sig" } as never,
  });
  const [b4, h4] = signed([{ id: 1 }, { id: 2 }, { id: 1 }]);
  const r4 = await receiveWebhook(root.id, b4, h4);
  assert.equal((r4.body as { duplicate: boolean }).duplicate, false);
  const { items } = await eventsService.list(ctx, { type: "root.item" });
  assert.equal(items.length, 2);
});

test("sample written after deduplication, option without storage, test mode without event", async () => {
  const ctx = await owner("HookSample");
  await secretsService.set(ctx, "K", "k");
  const hook = await webhooksService.create(ctx, {
    name: "s",
    eventType: "s.in",
    secretName: "K",
    config: { format: "hmac", header: "x-sig" } as never,
  });
  const sampleOf = async () =>
    (await webhooksService.list(ctx)).find((w) => w.id === hook.id)!.sample;
  const [b1, h1] = signed({ id: "1", v: "first" });
  await receiveWebhook(hook.id, b1, h1);
  // Replay of the same id with other content: the sample stays the first one.
  const [b2, h2] = signed({ id: "1", v: "replay" });
  await receiveWebhook(hook.id, b2, h2);
  assert.deepEqual(await sampleOf(), { id: "1", v: "first" });

  // Test mode: sample stored, no event.
  const [b3, h3] = signed({ id: "2", v: "test" });
  const t = await receiveWebhook(hook.id, b3, h3, { test: true });
  assert.deepEqual(t.body, { test: true, events: [] });
  assert.deepEqual(await sampleOf(), { id: "2", v: "test" });
  assert.equal(
    (await eventsService.list(ctx, { type: "s.in" })).items.length,
    1,
  );

  assert.equal(await webhooksService.clearSample(ctx, hook.id), true);
  assert.equal(await sampleOf(), null);

  // update: the URL does not change, storeSample: false no longer writes a sample.
  const up = await webhooksService.update(ctx, hook.id, {
    name: "s2",
    config: { format: "hmac", header: "x-sig", storeSample: false } as never,
  });
  assert.equal(up!.path, hook.path);
  assert.equal(up!.name, "s2");
  const [b4, h4] = signed({ id: "3" });
  assert.equal((await receiveWebhook(hook.id, b4, h4)).status, 200);
  assert.equal(await sampleOf(), null);

  // Unique name per workspace: readable message.
  await assert.rejects(
    webhooksService.create(ctx, {
      name: "s2",
      eventType: "x",
      secretName: "K",
      config: { format: "hmac", header: "x-sig" } as never,
    }),
    /already exists in this workspace/,
  );
});

test("webhook created by an API key: the key carries the events, revoked it cuts", async () => {
  const o = await owner("HookKey");
  const { id } = await apiKeysService.create(o, {
    name: "agent",
    scopes: ["admin"],
    workspaceIds: [o.workspaceId],
  });
  const ctx: TenantContext = {
    ...o,
    actor: { apiKeyId: id, scopes: ["admin"] },
  };
  await secretsService.set(ctx, "K", "k");
  const hook = await webhooksService.create(ctx, {
    name: "byKey",
    eventType: "key.evt",
    secretName: "K",
    config: { format: "hmac", header: "x-sig" } as never,
  });
  const [raw, h] = signed({ id: "e1" });
  assert.equal((await receiveWebhook(hook.id, raw, h)).status, 200);
  assert.deepEqual(await eventsService.types(o), ["key.evt"]);
  await apiKeysService.revoke(o, id);
  const [raw2, h2] = signed({ id: "e2" });
  await assert.rejects(receiveWebhook(hook.id, raw2, h2), /Access denied/);
});

test("signFor: signatures accepted by verifySignature, all formats", () => {
  const std = `whsec_${Buffer.from("k").toString("base64")}`;
  const cases = [
    [{ format: "stripe" }, "whsec_s"],
    [{ format: "standard" }, std],
    [
      {
        format: "hmac",
        header: "X-Sig",
        algorithm: "sha256",
        encoding: "hex",
        prefix: "sha256=",
      },
      "k",
    ],
    [
      {
        format: "hmac",
        header: "x-sig",
        algorithm: "sha1",
        encoding: "base64",
        timestampHeader: "x-ts",
      },
      "k",
    ],
  ] as const;
  for (const [config, secret] of cases)
    assert.equal(
      verifySignature(
        config as never,
        secret,
        body,
        signFor(config as never, secret, body, now),
        now,
      ).ok,
      true,
      config.format,
    );
});

test("sendTest: sample stored without event, missing secret refused", async () => {
  const ctx = await owner("HookSendTest");
  const hook = await webhooksService.create(ctx, {
    name: "t",
    eventType: "t.in",
    secretName: "TK",
    config: { format: "standard" } as never,
  });
  await assert.rejects(
    webhooksService.sendTest(ctx, hook.id, { a: 1 }),
    /Secret TK is missing/,
  );
  await secretsService.set(
    ctx,
    "TK",
    `whsec_${Buffer.from("x").toString("base64")}`,
  );
  const r = await webhooksService.sendTest(ctx, hook.id, { a: 1 });
  assert.equal(r.status, 200);
  const [w] = await webhooksService.list(ctx);
  assert.deepEqual(w!.sample, { a: 1 });
  assert.equal(
    (await eventsService.list(ctx, { type: "t.in" })).items.length,
    0,
  );
});

test("hmac kv (outreach): t=…,v1=… on a free header, several v1, expired refused", () => {
  const cfg = {
    format: "hmac",
    header: "X-Outreach-Signature",
    headerFormat: "kv",
    signedPayload: "{t}.{body}",
    toleranceSec: 300,
  } as never;
  const secret = "whsec_abc";
  const sig = hex(secret, `${ts}.${body}`);
  const h = { "x-outreach-signature": `t=${ts},v1=deadbeef,v1=${sig}` };
  assert.equal(verifySignature(cfg, secret, body, h, now).ok, true);
  assert.equal(verifySignature(cfg, "autre", body, h, now).ok, false);
  assert.equal(verifySignature(cfg, secret, body, h, now + 600_000).ok, false);
  const noTs = { "x-outreach-signature": `v1=${sig}` };
  assert.equal(verifySignature(cfg, secret, body, noTs, now).ok, false);
  // Configurable keys and secret encoding.
  const key = Buffer.from("raw-key");
  const cfg2 = {
    format: "hmac",
    header: "x-s",
    headerFormat: "kv",
    timestampKey: "ts",
    signatureKey: "s",
    encoding: "base64",
    secretEncoding: "whsec",
  } as never;
  const s64 = createHmac("sha256", key)
    .update(`${ts}.${body}`)
    .digest("base64");
  const whsec = `whsec_${key.toString("base64")}`;
  const h2 = { "x-s": `ts=${ts},s=${s64}` };
  assert.equal(verifySignature(cfg2, whsec, body, h2, now).ok, true);
  // signFor signs according to the config (webhooks.test).
  const h3 = signFor(cfg, secret, body, now);
  assert.equal(verifySignature(cfg, secret, body, h3, now).ok, true);
});

test("dedupe: id (default) discards an enriched resend, id+hash accepts it, none accepts everything", async () => {
  const ctx = await owner("HookDedupe");
  await secretsService.set(ctx, "K", "k");
  const mk = (name: string, dedupe?: string) =>
    webhooksService.create(ctx, {
      name,
      eventType: `d.${name}`,
      secretName: "K",
      config: { format: "hmac", header: "x-sig", dedupe } as never,
    });
  const dup = (r: { body: unknown }) =>
    (r.body as { duplicate: boolean }).duplicate;
  const [b1, h1] = signed({ id: "e1", step: 1 });
  const [b2, h2] = signed({ id: "e1", step: 2 });
  const count = async (t: string) =>
    (await eventsService.list(ctx, { type: t })).items.length;

  const byId = await mk("byid");
  assert.equal(dup(await receiveWebhook(byId.id, b1, h1)), false);
  assert.equal(dup(await receiveWebhook(byId.id, b2, h2)), true);
  assert.equal(await count("d.byid"), 1);

  const hash = await mk("hash", "id+hash");
  assert.equal(dup(await receiveWebhook(hash.id, b1, h1)), false);
  assert.equal(dup(await receiveWebhook(hash.id, b2, h2)), false);
  assert.equal(dup(await receiveWebhook(hash.id, b2, h2)), true);
  assert.equal(await count("d.hash"), 2);

  const none = await mk("none", "none");
  await receiveWebhook(none.id, b1, h1);
  assert.equal(dup(await receiveWebhook(none.id, b1, h1)), false);
  assert.equal(await count("d.none"), 2);
});

test("parseBody: JSON, form posts (repeated keys as arrays), invalid", () => {
  assert.deepEqual(parseBody('{"a":1}', "application/json"), { a: 1 });
  assert.deepEqual(
    parseBody(
      "email=a%40x.io&tag=a&tag=b&name=Jo+Do",
      "application/x-www-form-urlencoded; charset=utf-8",
    ),
    { email: "a@x.io", tag: ["a", "b"], name: "Jo Do" },
  );
  assert.equal(parseBody("email=a", "application/json"), undefined);
});
