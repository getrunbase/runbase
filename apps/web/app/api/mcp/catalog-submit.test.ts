// Creator program: MCP submission -> validation -> pull request
// (simulated GitHub) -> merge -> signed webhook (simulated receiver) -> creator page
// served by the public API. Requires DATABASE_URL and REDIS_URL.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import {
  loadCatalog,
  resetCatalog,
  revalidationPaths,
  sendRevalidation,
  signRevalidation,
} from "@runbase/core/catalog";
import {
  catalogFixture,
  fixtureManifest,
  validDescription,
} from "@runbase/core/testing";
import * as creator from "../catalog/creators/[username]/route";
import { owner, raw } from "./test-client";

const read = (req: IncomingMessage) =>
  new Promise<string>((ok) => {
    let s = "";
    req.on("data", (c) => (s += c)).on("end", () => ok(s));
  });

// Simulated GitHub: files committed per branch, open PRs.
const committed = new Map<string, string>();
const pulls: { title: string; head: string; base: string }[] = [];
const hooks: { headers: IncomingMessage["headers"]; body: string }[] = [];
const server = createServer(async (req, res) => {
  const body = await read(req);
  const send = (status: number, value: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const url = req.url ?? "";
  if (url === "/hook") {
    hooks.push({ headers: req.headers, body });
    return send(200, { ok: true });
  }
  assert.equal(req.headers.authorization, "Bearer gh-test-token");
  if (req.method === "GET" && url.endsWith("/git/ref/heads/main"))
    return send(200, { object: { sha: "abc123" } });
  if (req.method === "POST" && url.endsWith("/git/refs")) return send(201, {});
  const file = url.match(/\/contents\/(.+)$/)?.[1];
  if (req.method === "PUT" && file) {
    const { content } = JSON.parse(body) as { content: string };
    committed.set(file, Buffer.from(content, "base64").toString("utf8"));
    return send(201, {});
  }
  if (req.method === "POST" && url.endsWith("/pulls")) {
    pulls.push(JSON.parse(body));
    return send(201, {
      number: 42,
      html_url: "https://github.com/acme/runbase/pull/42",
    });
  }
  send(404, {});
});

let root = "";
let base = "";
before(async () => {
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  root = catalogFixture();
  Object.assign(process.env, {
    CATALOG_ROOT: root,
    CATALOG_GITHUB_REPO: "acme/runbase",
    CATALOG_GITHUB_TOKEN: "gh-test-token",
    CATALOG_GITHUB_API: base,
  });
  delete process.env.CATALOG_INDEX;
  resetCatalog();
});
after(() => {
  server.close();
  setImmediate(() => process.exit(0));
});

const submission = {
  slug: "churn-alert",
  name: "Churn alert",
  categories: ["customer-success"],
  githubUsername: "newbie",
  description: validDescription("Warn the team when a customer goes quiet"),
  manifest: fixtureManifest("Churn alert", ["slack.post"]),
  author: {
    username: "newbie",
    name: "New Bie",
    bio: "Automation fan.",
    avatar: "https://github.com/newbie.png",
    links: [{ label: "Site", url: "https://newbie.dev" }],
  },
};

test("MCP submission -> validation -> PR -> merge -> webhook -> creator page", async () => {
  const call = raw(await owner());

  // Rejected: clear messages, no PR opened.
  const bad = await call("templates.submit", {
    ...submission,
    description: "## Who it's for\n\nShort.",
  });
  assert.equal(bad.isError, true);
  const text = bad.content[0]!.text;
  assert.match(text, /^\[invalid_input\] Invalid catalog entry/);
  assert.match(text, /description has 4 words, at least 300 are required/);
  assert.match(text, /missing the "## Setup" section/);
  assert.equal(pulls.length, 0);

  // Accepted: PR opened with the template and the author profile.
  const ok = await call("templates.submit", submission);
  assert.equal(ok.isError, undefined);
  const out = JSON.parse(ok.content[0]!.text);
  assert.equal(out.status, "in_review");
  assert.deepEqual(out.pullRequest, {
    url: "https://github.com/acme/runbase/pull/42",
    number: 42,
  });
  assert.deepEqual(out.connectors, ["slack"]);
  assert.equal(pulls[0]?.base, "main");
  assert.match(pulls[0]!.head, /^templates\/churn-alert-/);
  assert.deepEqual([...committed.keys()].sort(), [
    "authors/newbie.json",
    "templates/churn-alert/README.md",
    "templates/churn-alert/runbase-template.json",
    "templates/churn-alert/template.json",
  ]);

  // Merge: the PR files land in the repository, CI re-validates.
  for (const [path, content] of committed) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const catalog = await loadCatalog(root);
  assert.deepEqual(catalog.issues, []);
  const paths = revalidationPaths([...committed.keys()], catalog);
  assert.deepEqual(paths, [
    "/creators/newbie",
    "/templates",
    "/templates/churn-alert",
  ]);
  await sendRevalidation(paths, { url: `${base}/hook`, secret: "hook-secret" });
  const hook = hooks[0]!;
  const ts = String(hook.headers["x-runbase-timestamp"]);
  assert.equal(
    hook.headers["x-runbase-signature"],
    signRevalidation("hook-secret", ts, hook.body),
  );
  assert.deepEqual(JSON.parse(hook.body), {
    type: "catalog.revalidate",
    paths,
  });

  // Publication: the creator page reads the public API.
  resetCatalog();
  const res = await creator.GET(
    new Request("http://localhost/api/catalog/creators/newbie", {
      headers: { "x-forwarded-for": `10.9.${process.pid % 250}.2` },
    }),
    { params: Promise.resolve({ username: "newbie" }) },
  );
  assert.equal(res.status, 200);
  const page = await res.json();
  assert.equal(page.name, "New Bie");
  assert.deepEqual(
    page.templates.map((t: { id: string }) => t.id),
    ["churn-alert"],
  );
});
