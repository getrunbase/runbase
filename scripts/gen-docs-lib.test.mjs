// Docs reference generator: a fictional MCP tool and node
// produce exactly the expected page.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BANNER,
  loadMessages,
  locale,
  mdxText,
  renderApi,
  renderMarkdownPage,
  renderMcp,
  renderNodes,
} from "./gen-docs-lib.mjs";

test("fictional MCP tools -> one page per group, index and meta", () => {
  const files = renderMcp([
    {
      name: "demo.ping",
      description: "Pings {target} <now>.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "Host | name" },
          mode: { enum: ["a", "b"] },
        },
        required: ["target"],
      },
    },
    { name: "alpha.go", inputSchema: { type: "object", properties: {} } },
  ]);
  assert.deepEqual(Object.keys(files).sort(), [
    "alpha.mdx",
    "demo.mdx",
    "index.mdx",
    "meta.json",
  ]);
  assert.equal(
    files["demo.mdx"],
    `---
title: "demo"
description: "The demo.* tools of the Runbase MCP server, generated from their definitions."
---

${BANNER}

## demo.ping

Pings \\{target\\} &lt;now&gt;.

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| \`target\` | string | yes | Host \\| name |
| \`mode\` | enum | no | One of: \`a\`, \`b\`. |
`,
  );
  assert.match(files["alpha.mdx"], /## alpha\.go\n\nNo description\.\n\n_No parameters\._/);
  assert.match(files["index.mdx"], /exposes 2 tools/);
  assert.match(
    files["index.mdx"],
    /- \[alpha\]\(\/docs\/reference\/mcp\/alpha\): `alpha.go`\n- \[demo\]\(\/docs\/reference\/mcp\/demo\): `demo.ping`/,
  );
  // Former single-page anchors -> group page.
  assert.match(
    files["index.mdx"],
    /<McpAnchorRedirect anchors=\{\{"alphago":"alpha","demoping":"demo"\}\} \/>/,
  );
  assert.deepEqual(JSON.parse(files["meta.json"]), {
    title: "MCP tools",
    pages: ["index", "alpha", "demo"],
  });
});

test("fictional node -> expected page, connectors separate", () => {
  const node = {
    type: "demo.echo",
    label: "Echo",
    description: "Returns its input.",
    branches: ["ok", "empty"],
    dynamicBranches: false,
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "string" },
  };
  const out = renderNodes([node]);
  assert.equal(
    out,
    `---
title: "Workflow nodes"
description: "Every workflow node, generated from the block catalog and the connectors."
---

${BANNER}

Built-in nodes run in the workflow engine. Connector nodes (\`node.<id>\`) come from \`connectors/\` and run in the functions sandbox. Workspace functions are also available as \`fn.<name>\` nodes.

## Built-in nodes

### demo.echo

**Echo**. Returns its input.

Branches: \`ok\`, \`empty\`.

#### Input

_No parameters._

#### Output

\`\`\`json
{
  "type": "string"
}
\`\`\`
`,
  );
  const both = renderNodes([
    { ...node, type: "node.x.y", connector: true },
    node,
  ]);
  assert.ok(both.indexOf("## Built-in nodes") < both.indexOf("### demo.echo"));
  assert.ok(both.indexOf("## Connector nodes") < both.indexOf("### node.x.y"));
});

test("API: operations sorted by tag, parameters and responses", () => {
  const out = renderApi({
    info: { description: "Demo API." },
    paths: {
      "/things/{id}": {
        get: {
          tags: ["Things"],
          summary: "Get a thing",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-workspace-id", in: "header", schema: { type: "string" } },
          ],
          responses: { 404: { description: "Not found" }, 200: { description: "OK" } },
        },
      },
    },
  });
  assert.match(out, /## Things\n\n### Get a thing\n\n`GET \/api\/v1\/things\/\{id\}`/);
  assert.match(out, /\| `id` \| string \| yes \| path\. \|/);
  assert.doesNotMatch(out, /x-workspace-id/);
  assert.match(out, /- `200`: OK\n- `404`: Not found/);
});

test("API: non-operation keys of the path item ignored (servers, parameters)", () => {
  const out = renderApi({
    paths: {
      "/things": {
        servers: [{ url: "https://example.com" }],
        parameters: [{ name: "q", in: "query" }],
        summary: "Things",
        post: { tags: ["Things"], summary: "Create a thing", responses: {} },
      },
    },
  });
  assert.match(out, /### Create a thing/);
  assert.doesNotMatch(out, /SERVERS|PARAMETERS|SUMMARY/);
  assert.equal(out.match(/^### /gm).length, 1);
});

test("API: path item with servers -> own base", () => {
  const out = renderApi({
    paths: {
      "/catalog/connectors": {
        servers: [{ url: "/api" }],
        get: { tags: ["Catalog"], summary: "List connectors", responses: {} },
      },
    },
  });
  assert.match(out, /`GET \/api\/catalog\/connectors`/);
  assert.doesNotMatch(out, /\/api\/v1\/catalog/);
});

test("Markdown page reuse and MDX escaping", () => {
  const out = renderMarkdownPage("# Self-hosting\n\nBody.\n", "Desc.");
  assert.match(out, /^---\ntitle: "Self-hosting"\ndescription: "Desc."\n---/);
  assert.match(out, /Body\.\n$/);
  assert.equal(mdxText("a{b}<c>"), "a\\{b\\}&lt;c&gt;");
});

test("French locale: template prose and code texts translated by id", () => {
  const l = locale("fr", loadMessages("fr"), {
    "mcp.demo.ping": { en: "Pings.", fr: "Envoie un ping." },
    "mcp.demo.ping.target": { en: "Old text", fr: "Ancien texte" },
  });
  const files = renderMcp(
    [
      {
        name: "demo.ping",
        description: "Pings.",
        inputSchema: {
          type: "object",
          properties: { target: { type: "string", description: "Host" } },
          required: ["target"],
        },
      },
    ],
    l,
  );
  assert.match(files["demo.mdx"], /## demo\.ping\n\nEnvoie un ping\./);
  assert.match(files["demo.mdx"], /\| Nom \| Type \| Requis \| Description \|/);
  // Stale translation (English source changed): English kept, id reported.
  assert.match(files["demo.mdx"], /\| `target` \| string \| oui \| Host \|/);
  assert.deepEqual([...l.missing], [["mcp.demo.ping.target", "Host"]]);
  assert.equal(JSON.parse(files["meta.json"]).title, "Outils MCP");
});

test("en and fr template messages: same keys", () => {
  const keys = (o, p = "") =>
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`],
    );
  assert.deepEqual(keys(loadMessages("fr")).sort(), keys(loadMessages("en")).sort());
});
