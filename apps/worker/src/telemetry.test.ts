// Unit tests: no database or network access (injected dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucket,
  buildPayload,
  DEFAULT_TELEMETRY_URL,
  sendPing,
  startTelemetry,
} from "./telemetry";

const id = async () => "11111111-1111-4111-8111-111111111111";
const counts = async () => ({ workspaces: 3, workflows: 42, runs: 12_345 });
const URL = "https://telemetry.test/ping";

test("bucket: ranges, never the exact value", () => {
  assert.equal(bucket(0), "0");
  assert.equal(bucket(1), "<10");
  assert.equal(bucket(10), "<100");
  assert.equal(bucket(999), "<1000");
  assert.equal(bucket(250_000), "100000+");
});

test("payload: documented fields only", () => {
  const p = buildPayload({
    id: "abc",
    version: "1.2.3",
    counts: { workspaces: 3, workflows: 42, runs: 12_345 },
  });
  assert.deepEqual(Object.keys(p).sort(), [
    "arch",
    "instanceId",
    "node",
    "os",
    "runs",
    "version",
    "workflows",
    "workspaces",
  ]);
  assert.equal(p.workspaces, "<10");
  assert.equal(p.workflows, "<100");
  assert.equal(p.runs, "<100000");
  assert.equal(p.version, "1.2.3");
});

test("ping: JSON POST to RUNBASE_TELEMETRY_URL", async () => {
  const calls: [string, RequestInit][] = [];
  const ok = await sendPing({
    env: { RUNBASE_TELEMETRY_URL: URL, APP_VERSION: "9.9.9" },
    fetch: (async (u: string, init: RequestInit) => {
      calls.push([u, init]);
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    id,
    counts,
  });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![0], URL);
  assert.equal(calls[0]![1].method, "POST");
  const body = JSON.parse(calls[0]![1].body as string);
  assert.equal(body.version, "9.9.9");
  assert.equal(body.runs, "<100000");
});

test("opt-out RUNBASE_TELEMETRY=0: no outgoing request", async () => {
  let n = 0;
  const f = (async () => {
    n++;
    return new Response();
  }) as typeof fetch;
  const env = { RUNBASE_TELEMETRY: "0", RUNBASE_TELEMETRY_URL: URL };
  const logs: string[] = [];
  assert.equal(await sendPing({ env, fetch: f, id, counts }), false);
  startTelemetry({
    env,
    fetch: f,
    id,
    counts,
    log: { info: (m) => logs.push(m) },
  }).stop();
  await new Promise((r) => setImmediate(r));
  assert.equal(n, 0);
  assert.match(logs[0]!, /disabled/);
});

test("network or database failure ignored", async () => {
  const env = { RUNBASE_TELEMETRY_URL: URL };
  const boom = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  assert.equal(await sendPing({ env, fetch: boom, id, counts }), false);
  const dbDown = async () => {
    throw new Error("db down");
  };
  assert.equal(await sendPing({ env, fetch: boom, id, counts: dbDown }), false);
});

test("startup: log explaining how to turn telemetry off", async () => {
  const logs: string[] = [];
  let n = 0;
  const t = startTelemetry({
    env: { RUNBASE_TELEMETRY_URL: URL },
    fetch: (async () => {
      n++;
      return new Response();
    }) as typeof fetch,
    id,
    counts,
    log: { info: (m) => logs.push(m) },
  });
  t.stop();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(logs[0]!, /RUNBASE_TELEMETRY=0/);
  assert.equal(n, 1);
});

test("enabled by default: without variable, POST to the project receiver", async () => {
  let url = "";
  const ok = await sendPing({
    env: {},
    fetch: (async (u: string) => {
      url = u;
      return new Response();
    }) as typeof fetch,
    id,
    counts,
  });
  assert.equal(ok, true);
  assert.equal(url, DEFAULT_TELEMETRY_URL);
});
