import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { AppError } from "../errors/app-error";
import { catalogFixture, fixtureManifest, validDescription } from "../testing";
import { loadCatalog } from "./load";
import {
  githubConfig,
  prepareSubmission,
  revalidationPaths,
  sendRevalidation,
  signRevalidation,
} from "./publish";

const submission = {
  slug: "new-template",
  name: "New template",
  categories: ["sales"],
  githubUsername: "newbie",
  description: validDescription("Fresh"),
  manifest: fixtureManifest("New template", ["slack.post"]),
  author: {
    username: "newbie",
    name: "New Bie",
    avatar: "https://github.com/newbie.png",
  },
};

test("valid submission: PR files, author profile, connectors", async () => {
  const catalog = await loadCatalog(catalogFixture());
  const { files, connectors } = prepareSubmission(
    submission,
    catalog,
    "2026-11-23",
  );
  assert.deepEqual(connectors, ["slack"]);
  assert.deepEqual(
    files.map((f) => f.path),
    [
      "templates/new-template/template.json",
      "templates/new-template/README.md",
      "templates/new-template/runbase-template.json",
      "authors/newbie.json",
    ],
  );
  assert.equal(JSON.parse(files[0]!.content).authorId, "newbie");
});

test("invalid template rejected: one clear message per problem", async () => {
  const catalog = await loadCatalog(catalogFixture());
  try {
    prepareSubmission(
      {
        ...submission,
        author: undefined,
        description: "## Who it's for\n\nToo short.",
      },
      catalog,
    );
    assert.fail("must be rejected");
  } catch (e) {
    assert.ok(e instanceof AppError);
    assert.equal(e.code, "catalog.invalid");
    assert.equal(e.kind, "invalid_input");
    const messages = e.items.map((i) => i.message);
    assert.ok(
      messages.includes(
        "templates/new-template/README.md: description has 5 words, at least 300 are required",
      ),
    );
    assert.ok(
      messages.includes(
        'templates/new-template/README.md: description is missing the "## Setup" section',
      ),
    );
    assert.ok(
      messages.includes(
        "templates/new-template/template.json: author newbie has no profile, add authors/newbie.json",
      ),
    );
    assert.match(e.message, /^Invalid catalog entry \(\d+ problem\(s\)\):\n/);
  }
});

test("slug already in the catalog: conflict", async () => {
  const catalog = await loadCatalog(catalogFixture());
  assert.throws(
    () => prepareSubmission({ ...submission, slug: "team-digest" }, catalog),
    (e: AppError) =>
      e.code === "catalog.templateExists" && e.kind === "conflict",
  );
});

test("submissions not configured: explicit error", () => {
  const saved = process.env.CATALOG_GITHUB_REPO;
  delete process.env.CATALOG_GITHUB_REPO;
  assert.throws(
    githubConfig,
    (e: AppError) => e.code === "catalog.submissionsDisabled",
  );
  if (saved) process.env.CATALOG_GITHUB_REPO = saved;
});

test("webhook: HMAC-SHA256 signature of timestamp.body", () => {
  const expected = createHmac("sha256", "s3cret")
    .update("1700000000.{}")
    .digest("hex");
  assert.equal(
    signRevalidation("s3cret", "1700000000", "{}"),
    `sha256=${expected}`,
  );
});

test("pages to revalidate from the merge diff", async () => {
  const catalog = await loadCatalog(catalogFixture());
  assert.deepEqual(
    revalidationPaths(
      [
        "templates/team-digest/README.md",
        "authors/octocat.json",
        "connectors/slack/catalog.json",
        "templates/README.md",
      ],
      catalog,
    ),
    [
      "/connectors",
      "/connectors/slack",
      "/creators/hubot",
      "/creators/octocat",
      "/templates",
      "/templates/team-digest",
    ],
  );
});

test("revalidation: Bearer POST + signature to the configured URL", async () => {
  let seen = { auth: "", sig: "", body: "" };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen = {
        auth: String(req.headers.authorization),
        sig: String(req.headers["x-runbase-signature"]),
        body,
      };
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  try {
    const now = new Date("2026-11-23T00:00:00Z");
    const r = await sendRevalidation(["/templates"], {
      url: `http://127.0.0.1:${port}/api/revalidate`,
      secret: "s3cret",
      now,
    });
    assert.equal(r.status, 200);
    assert.equal(seen.auth, "Bearer s3cret");
    assert.deepEqual(JSON.parse(seen.body).paths, ["/templates"]);
    assert.equal(
      seen.sig,
      signRevalidation("s3cret", String(now.getTime() / 1000), seen.body),
    );
  } finally {
    server.close();
  }
});

test("closed category list: unknown category refused, missing list skips the check", async () => {
  const root = catalogFixture();
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  writeFileSync(
    join(root, "templates", "categories.json"),
    JSON.stringify([{ slug: "sales", name: "Sales" }]),
  );
  const catalog = await loadCatalog(root);
  assert.deepEqual(catalog.categories, [{ slug: "sales", name: "Sales" }]);
  assert.doesNotThrow(() => prepareSubmission(submission, catalog));
  assert.throws(
    () =>
      prepareSubmission({ ...submission, categories: ["sales", "x"] }, catalog),
    (e: unknown) =>
      e instanceof AppError &&
      e.items?.some((i) => i.code === "catalog.unknownCategory") === true &&
      /unknown category "x": use one from templates\/categories\.json/.test(
        e.message,
      ),
  );
  const open = await loadCatalog(catalogFixture());
  assert.equal(open.categories, undefined);
  assert.doesNotThrow(() =>
    prepareSubmission({ ...submission, categories: ["anything"] }, open),
  );
});
