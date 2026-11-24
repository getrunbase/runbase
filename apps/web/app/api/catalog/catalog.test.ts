// Public catalog API: integration of each endpoint against
// the Next handlers, on a fixture repository. Requires REDIS_URL (limiter).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resetCatalog } from "@getrunbase/core/catalog";
import { catalogFixture } from "@getrunbase/core/testing";
import * as templates from "./templates/route";
import * as template from "./templates/[id]/route";
import * as connectors from "./connectors/route";
import * as connector from "./connectors/[slug]/route";
import * as creator from "./creators/[username]/route";

after(() => setImmediate(() => process.exit(0)));

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

// Unique IP per run: limit counter isolated from the other tests.
const ip = `10.${Date.now() % 250}.${process.pid % 250}.1`;

async function call(
  handler: Handler,
  path: string,
  params: Record<string, string> = {},
) {
  const res = await handler(
    new Request(`http://localhost/api/catalog${path}`, {
      headers: { "x-forwarded-for": ip },
    }),
    { params: Promise.resolve(params) },
  );
  return { status: res.status, headers: res.headers, json: await res.json() };
}

before(() => {
  process.env.CATALOG_ROOT = catalogFixture();
  delete process.env.CATALOG_INDEX;
  resetCatalog();
});

test("GET /templates: search, filters, keyset, cache and rate limit", async () => {
  const all = await call(templates.GET, "/templates");
  assert.equal(all.status, 200);
  assert.equal(all.json.total, 3);
  assert.match(all.headers.get("cache-control")!, /public.*s-maxage/);
  assert.ok(all.headers.get("x-ratelimit-limit"));

  const q = await call(templates.GET, "/templates?q=unpaid&connector=slack");
  assert.deepEqual(
    q.json.data.map((t: { id: string }) => t.id),
    ["invoice-reminder"],
  );
  const cat = await call(templates.GET, "/templates?category=sales");
  assert.equal(cat.json.total, 2);

  const p1 = await call(templates.GET, "/templates?limit=2");
  assert.equal(p1.json.next, "prospect-reply");
  const p2 = await call(
    templates.GET,
    `/templates?limit=2&after=${p1.json.next}`,
  );
  assert.deepEqual(
    p2.json.data.map((t: { id: string }) => t.id),
    ["team-digest"],
  );
  assert.equal(p2.json.next, null);

  const bad = await call(templates.GET, "/templates?limit=0");
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "api.invalidRequest");
});

test("GET /templates/:id: detail and 404", async () => {
  const ok = await call(template.GET, "/templates/prospect-reply", {
    id: "prospect-reply",
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.connectors, ["mailer"]);
  assert.equal(ok.json.manifest.format, "runbase-template");
  const ko = await call(template.GET, "/templates/nope", { id: "nope" });
  assert.equal(ko.status, 404);
  assert.deepEqual(ko.json, {
    code: "catalog.templateNotFound",
    params: { id: "nope" },
    message: "Template nope not found in the catalog",
  });
});

test("GET /connectors and /connectors/:slug", async () => {
  const list = await call(connectors.GET, "/connectors");
  assert.deepEqual(
    list.json.data.map((c: { slug: string }) => c.slug),
    ["mailer", "slack"],
  );
  const one = await call(connector.GET, "/connectors/slack", { slug: "slack" });
  assert.equal(one.status, 200);
  assert.equal(one.json.templates.length, 2);
  const ko = await call(connector.GET, "/connectors/nope", { slug: "nope" });
  assert.equal(ko.status, 404);
  assert.equal(ko.json.code, "catalog.connectorNotFound");
});

test("GET /creators/:username", async () => {
  const ok = await call(creator.GET, "/creators/hubot", { username: "hubot" });
  assert.equal(ok.status, 200);
  assert.deepEqual(
    ok.json.templates.map((t: { id: string }) => t.id),
    ["team-digest"],
  );
  const ko = await call(creator.GET, "/creators/ghost", { username: "ghost" });
  assert.equal(ko.status, 404);
  assert.equal(ko.json.code, "catalog.creatorNotFound");
});
