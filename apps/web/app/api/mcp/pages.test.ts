// Acceptance test: an agent creates and edits a page (TSX package)
// only through MCP. Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pagesService } from "@runbase/core/pages";
import { client, owner, raw } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

const tsx = (s: string) => `export default () => <p>${s}</p>;`;

test("TSX package page: creation, file patch, errors, publication, restore", async () => {
  const ctx = await owner();
  const call = client(ctx);

  const page = await call("page.create", {
    name: "Leads",
    files: { "index.tsx": tsx("v1") },
    publish: true,
  });
  assert.equal(page.currentVersion, 1);
  assert.equal(page.entry, "index.tsx");

  const patched = await call("page.update", {
    id: page.id,
    review: false,
    changes: [
      { op: "write", path: "components/card.tsx", source: tsx("card") },
      { op: "write", path: "index.tsx", source: tsx("v1") },
      { op: "edit", path: "index.tsx", old: "v1", new: "v2" },
    ],
  });
  assert.deepEqual(patched.errors, []);
  assert.equal(patched.page.files["index.tsx"], tsx("v2"));
  // Invisible draft: the published one keeps v1.
  const live = await call("page.get", { id: page.id });
  assert.deepEqual(live.files, { "index.tsx": tsx("v1") });
  const draft = await call("page.get", { id: page.id, draft: true });
  assert.equal(draft.hasDraft, true);
  assert.equal(draft.files["components/card.tsx"], tsx("card"));

  await call("page.update", {
    id: page.id,
    review: false,
    changes: [
      { op: "rename", from: "components/card.tsx", to: "components/item.tsx" },
      { op: "delete", path: "components/item.tsx" },
    ],
  });

  const bad = await raw(ctx)("page.update", {
    id: page.id,
    changes: [{ op: "write", path: "../escape.tsx", source: "" }],
  });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0]!.text, /Invalid file path/);
  const noEntry = await raw(ctx)("page.update", {
    id: page.id,
    changes: [{ op: "delete", path: "index.tsx" }],
  });
  assert.equal(noEntry.isError, true);
  assert.match(noEntry.content[0]!.text, /Entry file not found/);
  const noMatch = await raw(ctx)("page.update", {
    id: page.id,
    changes: [{ op: "edit", path: "index.tsx", old: "nope", new: "x" }],
  });
  assert.equal(noMatch.isError, true);
  // Recompile: the syntax error is returned, the draft kept.
  const broken = await call("page.update", {
    id: page.id,
    review: false,
    changes: [{ op: "edit", path: "index.tsx", old: "</p>", new: "</p" }],
  });
  assert.equal(broken.errors.length > 0, true);
  await call("page.update", {
    id: page.id,
    review: false,
    changes: [{ op: "edit", path: "index.tsx", old: "</p", new: "</p>" }],
  });

  await call("page.publish", { id: page.id });
  assert.equal(
    (await call("page.get", { id: page.id })).files["index.tsx"],
    tsx("v2"),
  );

  await call("page.restore", { id: page.id, version: 1 });
  const back = await call("page.get", { id: page.id });
  assert.equal(back.currentVersion, 3);
  assert.equal(back.files["index.tsx"], tsx("v1"));
  assert.equal((await call("page.versions", { id: page.id })).length, 3);

  const u = await call("page.update", {
    id: page.id,
    review: false,
    name: "Leads 2",
    files: { "main.tsx": tsx("m") },
    entry: "main.tsx",
  });
  assert.equal(u.page.name, "Leads 2");
  assert.equal(u.page.entry, "main.tsx");
  assert.equal(await call("page.delete", { id: page.id }), true);
});

// Runtime error reported by the iframe, readable via page.errors.
test("page.errors: reported error readable through MCP", async () => {
  const ctx = await owner();
  const call = client(ctx);
  const page = await call("page.create", {
    name: "Boom",
    files: { "index.tsx": tsx("boom") },
  });
  await pagesService.reportError(ctx, page.id, {
    draft: true,
    message: "boom",
    stack: "Error: boom",
  });
  const errs = await call("page.errors", { id: page.id, draft: true });
  assert.equal(errs.length, 1);
  assert.equal(errs[0].message, "boom");
  assert.deepEqual(await call("page.errors", { id: page.id }), []);
});
