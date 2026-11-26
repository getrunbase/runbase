import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildTemplate, loadCatalog } from "./load";
import { checkDescription, deriveConnectors, wordCount } from "./schemas";
import type { ErrorItem } from "../errors/app-error";

const filler = (n: number) => Array.from({ length: n }, () => "word").join(" ");
export const description = (words = 300) =>
  [
    "## Who it's for",
    filler(words),
    "## The problem",
    "x",
    "## What it does",
    "y",
    "## Setup",
    "1. Import.",
  ].join("\n\n");

const meta = {
  id: "demo",
  slug: "demo",
  name: "Demo",
  categories: ["sales"],
  authorId: "octocat",
  createdAt: "2026-11-23",
  updatedAt: "2026-11-23",
};
const manifest = {
  format: "runbase-template",
  version: 1,
  name: "Demo",
  workflows: [
    {
      key: "w",
      name: "W",
      definition: {
        trigger: { type: "trigger.manual" },
        steps: [
          { id: "a", type: "node.mailer.send" },
          { id: "b", type: "node.mailer.list" },
          { id: "c", type: "condition" },
          { id: "d", type: "node.unknown.x" },
        ],
      },
    },
  ],
};
const ctx = {
  owners: new Map([
    ["mailer.send", "mailer"],
    ["mailer.list", "mailer"],
  ]),
  authors: new Set(["octocat"]),
};
const build = (over: Partial<Parameters<typeof buildTemplate>[0]> = {}) => {
  const issues: ErrorItem[] = [];
  const t = buildTemplate(
    { slug: "demo", meta, readme: description(), manifest, ...over },
    ctx,
    issues,
  );
  return { t, issues, codes: issues.map((i) => i.code) };
};

test("valid template: connectors derived from the manifest", () => {
  const { t, issues } = build();
  assert.deepEqual(issues, []);
  assert.deepEqual(t?.connectors, ["mailer"]);
  assert.equal(t?.authorId, "octocat");
});

test("description too short: clear message with the word count", () => {
  const { t, issues } = build({ readme: description(10) });
  assert.equal(t, undefined);
  assert.equal(issues[0]?.code, "catalog.descriptionTooShort");
  assert.match(
    issues[0]!.message,
    /^templates\/demo\/README\.md: description has \d+ words, at least 300 are required$/,
  );
});

test("missing setup section", () => {
  const readme = description().replace("## Setup", "## Notes");
  const { codes, issues } = build({ readme });
  assert.deepEqual(codes, ["catalog.sectionMissing"]);
  assert.match(issues[0]!.message, /missing the "## Setup" section/);
});

test("missing author profile, slug different from the folder, invalid manifest", () => {
  const { codes, issues } = build({
    meta: { ...meta, authorId: "ghost", slug: "other" },
    manifest: { ...manifest, version: 2 },
  });
  assert.deepEqual(codes.sort(), [
    "catalog.authorMissing",
    "catalog.invalidFile",
    "catalog.slugMismatch",
  ]);
  assert.ok(issues.some((i) => i.message.includes("add authors/ghost.json")));
});

test("connectors never entered: connectors field refused in template.json", () => {
  const { codes } = build({ meta: { ...meta, connectors: ["slack"] } });
  assert.deepEqual(codes, ["catalog.invalidFile"]);
});

test("word count: code blocks excluded", () => {
  assert.equal(wordCount("one two\n```\nthree four\n```\nfive"), 3);
  assert.deepEqual(
    checkDescription(description(), "x").map((i) => i.code),
    [],
  );
  assert.deepEqual(deriveConnectors({ workflows: [] }, ctx.owners), []);
});

test("the real repo (connectors/, templates/, authors/) passes validation", async () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const c = await loadCatalog(root);
  assert.deepEqual(c.issues, []);
  assert.ok(c.connectors.some((x) => x.slug === "slack"));
  // Logo read from the connector's logo.svg, as a data URL.
  const gmail = c.connectors.find((x) => x.slug === "gmail");
  assert.match(gmail?.logo ?? "", /^data:image\/svg\+xml;base64,/);
  assert.ok(
    Buffer.from(gmail!.logo!.split(",")[1]!, "base64")
      .toString()
      .includes("<svg"),
  );
  assert.ok(c.templates.length >= 1);
  for (const t of c.templates)
    assert.ok(c.authors.some((a) => a.username === t.authorId));
});
