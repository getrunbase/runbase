// Generates the docs references in apps/docs/content/docs/<lang>/reference:
// REST API (OpenAPI spec /api/v1), MCP tools (tools.ts) and nodes (building
// block catalog + connectors), plus the self-hosting page. Run by
// `pnpm gen:docs`; CI fails if the result differs from the committed files.
//
// French: the template prose comes from apps/docs/messages/fr/generated.json,
// the texts of the code (English only) from apps/docs/translations/fr/
// (generated.json keyed by stable id, self-hosting.md). A missing or stale
// translation fails the run (exit 1) and is listed; with
// GEN_DOCS_MISSING=<file>, the missing entries are also written there as
// { id: { en } } to translate.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { z as Z } from "zod";
import { openapi } from "../apps/web/lib/api-v1/openapi";
import { registerTools, withMcpRequest } from "../apps/web/app/api/mcp/tools";
import { blocksService } from "../packages/core/src/blocks/index";
import { NODE_PREFIX } from "../packages/core/src/blocks/connectors";
import {
  loadMessages,
  locale,
  renderApi,
  renderMcp,
  renderMarkdownPage,
  renderNodes,
} from "./gen-docs-lib.mjs";

// zod from apps/web (the scripts/ folder has no dependencies of its own).
const { z } = (await import(
  createRequire(join(import.meta.dirname, "../apps/web/package.json")).resolve("zod"),
)) as { z: typeof Z };

const docsDir = join(import.meta.dirname, "../apps/docs");

// MCP tools: registered on a fake server, for a user without
// tool restrictions (no tool body is executed).
const tools: { name: string; description?: string; inputSchema: unknown }[] =
  [];
withMcpRequest({ principal: { key: "docs", actor: { userId: "docs" } } }, () =>
  registerTools({
    registerTool: (
      name: string,
      cfg: { description?: string; inputSchema?: Z.ZodType },
    ) =>
      tools.push({
        name,
        description: cfg.description,
        inputSchema: z.toJSONSchema(cfg.inputSchema ?? z.object({}), {
          unrepresentable: "any",
          io: "input",
        }),
      }),
  } as never),
);

const nodes = (await blocksService.list()).map((n) => ({
  ...n,
  connector: n.type.startsWith(NODE_PREFIX),
}));

// Self-hosting: taken as is from docs/self-hosting.md (single source). Its
// French version records the hash of the English source it translates.
const selfHostingMd = readFileSync(
  join(import.meta.dirname, "../docs/self-hosting.md"),
  "utf8",
);
const selfHostingHash = createHash("sha256").update(selfHostingMd).digest("hex");
const HASH_LINE = /^<!-- source-sha256: ([0-9a-f]+) -->\n/;

const translations = JSON.parse(
  readFileSync(join(docsDir, "translations/fr/generated.json"), "utf8"),
);
const missing = new Map<string, string>();

for (const lang of ["en", "fr"]) {
  const l = locale(lang, loadMessages(lang), lang === "en" ? null : translations);
  const out = join(docsDir, `content/docs/${lang}/reference`);
  mkdirSync(out, { recursive: true });
  let md = selfHostingMd;
  if (lang !== "en") {
    const file = join(docsDir, `translations/${lang}/self-hosting.md`);
    const tr = existsSync(file) ? readFileSync(file, "utf8") : "";
    const m = tr.match(HASH_LINE);
    if (m && m[1] === selfHostingHash) md = tr.slice(m[0].length);
    else missing.set(`self-hosting.md (source-sha256: ${selfHostingHash})`, "");
  }
  writeFileSync(
    join(out, "../self-hosting.mdx"),
    renderMarkdownPage(md, l.t("selfHosting.description")),
  );
  writeFileSync(join(out, "api.mdx"), renderApi(openapi(), l));
  // MCP tools: one page per group, the folder is rebuilt (no stale group).
  const mcpDir = join(out, "mcp");
  rmSync(mcpDir, { recursive: true, force: true });
  mkdirSync(mcpDir);
  for (const [file, content] of Object.entries(renderMcp(tools, l)))
    writeFileSync(join(mcpDir, file), content);
  writeFileSync(join(out, "nodes.mdx"), renderNodes(nodes, l));
  for (const [id, en] of l.missing) missing.set(id, en);
}

console.log(`docs: ${tools.length} MCP tools, ${nodes.length} nodes (en, fr)`);
if (missing.size) {
  if (process.env.GEN_DOCS_MISSING)
    writeFileSync(
      process.env.GEN_DOCS_MISSING,
      JSON.stringify(
        Object.fromEntries([...missing].map(([id, en]) => [id, { en }])),
        null,
        2,
      ) + "\n",
    );
  console.error(
    `docs: ${missing.size} missing or stale French translations ` +
      "(apps/docs/translations/fr):\n" +
      [...missing.keys()].map((id) => `  - ${id}`).join("\n"),
  );
  process.exit(1);
}
process.exit(0);
