// REST API v1: per-resource integration against the Next handlers.
// Requires DATABASE_URL and REDIS_URL. Set up through the test MCP client.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { client, owner } from "../mcp/test-client";
import * as objects from "./objects/route";
import * as object from "./objects/[object]/route";
import * as records from "./objects/[object]/records/route";
import * as record from "./records/[id]/route";
import * as runs from "./runs/route";
import * as run from "./runs/[id]/route";
import * as events from "./events/route";
import * as files from "./files/route";
import * as fileContent from "./files/content/route";

after(() => setImmediate(() => process.exit(0)));

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

let key = "";
let workflowId = "";

// Handler call: JSON or FormData body, default key.
async function call(
  handler: Handler,
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
    key?: string | null;
  } = {},
) {
  const headers: Record<string, string> = {};
  const auth = opts.key === undefined ? key : opts.key;
  if (auth) headers.authorization = `Bearer ${auth}`;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await handler(
    new Request(`http://localhost/api/v1${path}`, {
      method: opts.method ?? (body ? "POST" : "GET"),
      headers,
      body,
    }),
    { params: Promise.resolve(opts.params ?? {}) },
  );
  const text = await res.text();
  // Untyped JSON response: read field by field in the assertions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // binaire
  }
  return { status: res.status, json, headers: res.headers };
}

before(async () => {
  const mcp = client(await owner());
  await mcp("objects.create", {
    slug: "contact",
    name: "Contact",
    fields: [
      { key: "email", label: "Email", type: "email", unique: true },
      { key: "name", label: "Name", type: "text" },
    ],
  });
  const wf = await mcp("workflows.create", {
    name: "Noop",
    definition: { trigger: { type: "trigger.manual" }, steps: [] },
  });
  workflowId = wf.id;
  // Key limited to the owner's workspace.
  const ws = await mcp("workspaces.list");
  key = (
    await mcp("api_keys.create", {
      name: "v1",
      scopes: ["write"],
      workspaceIds: [ws[0].id],
    })
  ).key;
});

test("auth: no key 401, invalid key 401, stable JSON error", async () => {
  const none = await call(objects.GET, "/objects", { key: null });
  assert.equal(none.status, 401);
  assert.equal(none.json.code, "api.missingKey");
  assert.deepEqual(Object.keys(none.json).sort(), [
    "code",
    "message",
    "params",
  ]);
  const bad = await call(objects.GET, "/objects", { key: "agk_nope" });
  assert.equal(bad.status, 401);
  assert.equal(typeof bad.json.message, "string");
});

test("objects: list and read, 404 on an unknown slug", async () => {
  const list = await call(objects.GET, "/objects");
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.json.data.map((o: { slug: string }) => o.slug),
    ["contact"],
  );
  const one = await call(object.GET, "/objects/contact", {
    params: { object: "contact" },
  });
  assert.equal(one.json.slug, "contact");
  assert.equal(one.json.fields.length, 2);
  const missing = await call(object.GET, "/objects/nope", {
    params: { object: "nope" },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.code, "objects.notFound");
});

test("records: full CRUD", async () => {
  const params = { object: "contact" };
  const created = await call(records.POST, "/objects/contact/records", {
    params,
    body: { data: { email: "a@x.io", name: "Ada" } },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.created, true);
  const id = created.json.record.id;

  // Upsert on the unique field: same record, 200.
  const again = await call(records.POST, "/objects/contact/records", {
    params,
    body: { data: { email: "a@x.io", name: "Ada L." }, match: "email" },
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.record.id, id);

  const got = await call(record.GET, `/records/${id}`, { params: { id } });
  assert.equal(got.status, 200);
  assert.equal(got.json.data.name, "Ada L.");

  const patched = await call(record.PATCH, `/records/${id}`, {
    method: "PATCH",
    params: { id },
    body: { data: { name: "Ada Lovelace" } },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.data.name, "Ada Lovelace");
  assert.equal(patched.json.data.email, "a@x.io");

  const del = await call(record.DELETE, `/records/${id}`, {
    method: "DELETE",
    params: { id },
  });
  assert.equal(del.status, 204);
  const gone = await call(record.GET, `/records/${id}`, { params: { id } });
  assert.equal(gone.status, 404);
  assert.equal(gone.json.code, "records.notFound");
  const delAgain = await call(record.DELETE, `/records/${id}`, {
    method: "DELETE",
    params: { id },
  });
  assert.equal(delAgain.status, 404);
});

test("records: non-UUID id 400, invalid body 400", async () => {
  const bad = await call(record.GET, "/records/abc", { params: { id: "abc" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "api.invalidParam");
  assert.deepEqual(bad.json.params, { param: "id", value: "abc" });

  const body = await call(records.POST, "/objects/contact/records", {
    params: { object: "contact" },
    body: { nope: true },
  });
  assert.equal(body.status, 400);
  assert.equal(body.json.code, "api.invalidRequest");

  const cursor = await call(records.GET, "/objects/contact/records?after=x", {
    params: { object: "contact" },
  });
  assert.equal(cursor.status, 400);
});

test("records: stable keyset pagination", async () => {
  const params = { object: "contact" };
  for (let i = 0; i < 7; i++)
    await call(records.POST, "/objects/contact/records", {
      params,
      body: { data: { email: `p${i}@x.io` } },
    });
  const seen: string[] = [];
  let after: string | null = null;
  let pages = 0;
  do {
    const res: Awaited<ReturnType<typeof call>> = await call(
      records.GET,
      `/objects/contact/records?limit=3${after ? `&after=${after}` : ""}`,
      { params },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.total, 7);
    seen.push(...res.json.data.map((r: { id: string }) => r.id));
    after = res.json.next;
    pages++;
  } while (after);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 7);
  // Same traversal, same order.
  const all = await call(records.GET, "/objects/contact/records?limit=50", {
    params,
  });
  assert.deepEqual(
    all.json.data.map((r: { id: string }) => r.id),
    seen,
  );
  assert.equal(all.json.next, null);
});

test("runs: start, get, list; unknown workflow 404", async () => {
  const started = await call(runs.POST, "/runs", {
    body: { workflowId, test: true },
  });
  assert.equal(started.status, 201);
  assert.equal(started.json.workflowId, workflowId);
  const id = started.json.id;
  const got = await call(run.GET, `/runs/${id}`, { params: { id } });
  assert.equal(got.status, 200);
  assert.equal(got.json.id, id);
  assert.ok(Array.isArray(got.json.steps));
  const list = await call(runs.GET, `/runs?workflowId=${workflowId}`);
  assert.equal(list.status, 200);
  assert.ok(list.json.data.some((r: { id: string }) => r.id === id));
  assert.equal(list.json.next, null);

  const unknown = crypto.randomUUID();
  const missing = await call(run.GET, `/runs/${unknown}`, {
    params: { id: unknown },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.code, "api.runNotFound");
  const noWf = await call(runs.POST, "/runs", {
    body: { workflowId: unknown },
  });
  assert.equal(noWf.status, 404);
  assert.equal(noWf.json.code, "api.workflowNotFound");
  const badStatus = await call(runs.GET, "/runs?status=nope");
  assert.equal(badStatus.status, 400);
});

test("events: deduplicated push, paginated list", async () => {
  const pushed = await call(events.POST, "/events", {
    body: { type: "signup", payload: { plan: "pro" }, idempotencyKey: "e1" },
  });
  assert.equal(pushed.status, 201);
  assert.equal(pushed.json.duplicate, false);
  assert.equal(pushed.json.source, "api");
  const dup = await call(events.POST, "/events", {
    body: { type: "signup", idempotencyKey: "e1" },
  });
  assert.equal(dup.status, 200);
  assert.equal(dup.json.id, pushed.json.id);
  await call(events.POST, "/events", { body: { type: "signup" } });

  const first = await call(events.GET, "/events?type=signup&limit=1");
  assert.equal(first.json.data.length, 1);
  assert.ok(first.json.next);
  const second = await call(
    events.GET,
    `/events?type=signup&limit=1&after=${first.json.next}`,
  );
  assert.equal(second.json.data.length, 1);
  assert.notEqual(second.json.data[0].id, first.json.data[0].id);
  assert.equal(second.json.next, null);
});

test("files: multipart upload then download", async () => {
  const form = new FormData();
  form.set("file", new File(["hello"], "hi.txt", { type: "text/plain" }));
  const up = await call(files.POST, "/files", { body: form });
  assert.equal(up.status, 201);
  assert.equal(up.json.name, "hi.txt");
  assert.equal(up.json.size, 5);
  const down = await call(
    fileContent.GET,
    `/files/content?key=${encodeURIComponent(up.json.key)}`,
  );
  assert.equal(down.status, 200);
  assert.equal(down.json, "hello");
  assert.equal(down.headers.get("content-type"), "text/plain");

  const empty = await call(files.POST, "/files", { body: new FormData() });
  assert.equal(empty.status, 400);
  assert.equal(empty.json.code, "api.invalidRequest");
});

test("per-key rate limit: 429 beyond it, with Retry-After", async () => {
  process.env.API_V1_RATE_LIMIT = "3";
  const minute = () => Math.floor(Date.now() / 60_000);
  try {
    // Fixed one-minute window: a minute rollover during the burst
    // resets the counter, so we start again with another key.
    for (let attempt = 0; ; attempt++) {
      const mcp = client(await owner());
      const ws = await mcp("workspaces.list");
      const fresh = (
        await mcp("api_keys.create", {
          name: "rl",
          scopes: ["read"],
          workspaceIds: [ws[0].id],
        })
      ).key;
      const start = minute();
      const statuses = [];
      for (let i = 0; i < 4; i++) {
        const res = await call(objects.GET, "/objects", { key: fresh });
        statuses.push(res.status);
        if (res.status === 429) {
          assert.equal(res.json.code, "api.rateLimited");
          assert.ok(Number(res.headers.get("retry-after")) > 0);
        } else assert.equal(res.headers.get("x-ratelimit-limit"), "3");
      }
      if (start !== minute() && attempt === 0) continue;
      assert.deepEqual(statuses, [200, 200, 200, 429]);
      break;
    }
  } finally {
    delete process.env.API_V1_RATE_LIMIT;
  }
});

test("scope: read key refused for writes (403)", async () => {
  const mcp = client(await owner());
  const ws = await mcp("workspaces.list");
  const read = (
    await mcp("api_keys.create", {
      name: "ro",
      scopes: ["read"],
      workspaceIds: [ws[0].id],
    })
  ).key;
  const res = await call(events.POST, "/events", {
    key: read,
    body: { type: "x" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, "apiKeys.scopeRequired");
});
