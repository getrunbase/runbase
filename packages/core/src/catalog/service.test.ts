import assert from "node:assert/strict";
import { before, test } from "node:test";
import { AppError } from "../errors/app-error";
import { catalogFixture } from "../testing";
import { catalogService, excerpt, resetCatalog } from "./service";

before(() => {
  process.env.CATALOG_ROOT = catalogFixture();
  delete process.env.CATALOG_INDEX;
  resetCatalog();
});

const ids = (r: { data: { id: string }[] }) => r.data.map((t) => t.id);

test("full-text search: all words, case and accent insensitive", async () => {
  assert.deepEqual(
    ids(await catalogService.searchTemplates({ q: "UNPAID invoices" })),
    ["invoice-reminder"],
  );
  assert.deepEqual(
    ids(await catalogService.searchTemplates({ q: "reponse prospects" })),
    ["prospect-reply"],
  );
  assert.deepEqual(
    ids(await catalogService.searchTemplates({ q: "unpaid nope" })),
    [],
  );
});

test("category and connector filters (derived from the manifest)", async () => {
  assert.deepEqual(
    ids(await catalogService.searchTemplates({ category: "sales" })),
    ["prospect-reply", "team-digest"],
  );
  assert.deepEqual(
    ids(await catalogService.searchTemplates({ connector: "mailer" })),
    ["invoice-reminder", "prospect-reply"],
  );
  const r = await catalogService.searchTemplates({
    category: "sales",
    connector: "slack",
  });
  assert.deepEqual(ids(r), ["team-digest"]);
  assert.equal(r.total, 1);
});

test("keyset pagination: disjoint pages, next null at the end", async () => {
  const p1 = await catalogService.searchTemplates({ limit: 2 });
  assert.deepEqual(ids(p1), ["invoice-reminder", "prospect-reply"]);
  assert.equal(p1.next, "prospect-reply");
  assert.equal(p1.total, 3);
  const p2 = await catalogService.searchTemplates({
    limit: 2,
    after: p1.next!,
  });
  assert.deepEqual(ids(p2), ["team-digest"]);
  assert.equal(p2.next, null);
});

test("list: short entry without manifest", async () => {
  const [t] = (await catalogService.searchTemplates({ q: "digest" })).data;
  assert.ok(t && !("manifest" in t));
  assert.ok(t.excerpt.startsWith("Daily summary"));
});

test("template, connector, creator detail", async () => {
  const t = await catalogService.getTemplate("invoice-reminder");
  assert.deepEqual(t.connectors, ["mailer", "slack"]);
  assert.ok(t.manifest);
  const c = await catalogService.getConnector("mailer");
  assert.deepEqual(
    c.actions.map((a) => a.name),
    ["mailer.send", "mailer.list"],
  );
  assert.equal(c.templates.length, 2);
  const a = await catalogService.getCreator("OCTOCAT");
  assert.equal(a.username, "octocat");
  assert.equal(a.templates.length, 2);
  assert.deepEqual(
    (await catalogService.listConnectors({ category: "email" })).map(
      (x) => x.slug,
    ),
    ["mailer"],
  );
});

test("connector detail: readme from README.md, null when absent", async () => {
  const mailer = await catalogService.getConnector("mailer");
  assert.equal(mailer.readme, "# Mailer automations\n\nSend emails.\n");
  assert.equal((await catalogService.getConnector("slack")).readme, null);
  const list = await catalogService.listConnectors();
  assert.ok(list.every((c) => !("readme" in c)));
});

test("clean 404: code, kind not_found and English message", async () => {
  for (const [p, code, msg] of [
    [
      catalogService.getTemplate("nope"),
      "catalog.templateNotFound",
      "Template nope not found in the catalog",
    ],
    [
      catalogService.getConnector("nope"),
      "catalog.connectorNotFound",
      "Connector nope not found in the catalog",
    ],
    [
      catalogService.getCreator("nope"),
      "catalog.creatorNotFound",
      "Creator nope not found in the catalog",
    ],
  ] as const)
    await assert.rejects(p, (e) => {
      assert.ok(e instanceof AppError);
      assert.equal(e.code, code);
      assert.equal(e.kind, "not_found");
      assert.equal(e.message, msg);
      return true;
    });
});

test("excerpt: manifest description first, else first README paragraph", () => {
  const readme =
    "# Title\n\nFirst paragraph\non two lines.\n\n## Section\n\nSecond paragraph.";
  assert.equal(
    excerpt(readme, { description: " One-line pitch. " }),
    "One-line pitch.",
  );
  assert.equal(excerpt(readme, {}), "First paragraph on two lines.");
  assert.equal(excerpt(readme), "First paragraph on two lines.");
});

test("excerpt: long text cut at a word boundary with an ellipsis", () => {
  const long = Array.from({ length: 80 }, () => "word").join(" ");
  const e = excerpt(long);
  assert.ok(e.length <= 280);
  assert.ok(e.endsWith("word…"));
});
