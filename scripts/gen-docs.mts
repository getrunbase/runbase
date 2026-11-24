// Generates the docs references in apps/docs/content/docs/reference:
// REST API (OpenAPI spec /api/v1), MCP tools (tools.ts) and nodes (building
// block catalog + connectors). Run by `pnpm gen:docs`; CI fails if the
// result differs from the committed files.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { z as Z } from "zod";
import { openapi } from "../apps/web/lib/api-v1/openapi";
import { registerTools, withMcpRequest } from "../apps/web/app/api/mcp/tools";
import { blocksService } from "../packages/core/src/blocks/index";
import { NODE_PREFIX } from "../packages/core/src/blocks/connectors";
import {
  renderApi,
  renderMcp,
  renderMarkdownPage,
  renderNodes,
} from "./gen-docs-lib.mjs";

// zod from apps/web (the scripts/ folder has no dependencies of its own).
const { z } = (await import(
  createRequire(join(import.meta.dirname, "../apps/web/package.json")).resolve("zod"),
)) as { z: typeof Z };

const out = join(import.meta.dirname, "../apps/docs/content/docs/reference");

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

// Self-hosting: taken as is from docs/self-hosting.md (single source).
writeFileSync(
  join(out, "../self-hosting.mdx"),
  renderMarkdownPage(
    readFileSync(join(import.meta.dirname, "../docs/self-hosting.md"), "utf8"),
    "Run Runbase on your own server with Docker, using prebuilt images.",
  ),
);
writeFileSync(join(out, "api.mdx"), renderApi(openapi()));
writeFileSync(join(out, "mcp.mdx"), renderMcp(tools));
writeFileSync(join(out, "nodes.mdx"), renderNodes(nodes));
console.log(
  `docs: ${tools.length} MCP tools, ${nodes.length} nodes -> ${out}`,
);
process.exit(0);
