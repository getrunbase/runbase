// MCP tools: pages.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { TenantContext } from "@getrunbase/core/tenant";
import { notFound } from "@getrunbase/core/errors";
import { compilePackage } from "@getrunbase/core/components";
import { render, reviewPage } from "@getrunbase/core/render";
import { appUrl, shotToken } from "@/lib/screenshot-token";
import { pagesService } from "@getrunbase/core/pages";
import { run, runImage } from "./shared";

export function definePageTools(server: McpServer, ctx: TenantContext) {
  // Pages: an agent builds a page only through MCP.
  const pageId = z.string().describe("Page id");
  const pageFiles = z
    .record(z.string(), z.string())
    .describe(
      'TSX package: {"<relative path>": "<source>"}, e.g. {"index.tsx": "export default function Page() {…}", "components/card.tsx": "…"}. Paths are relative (no "..", no leading "/"); the entry file must be present.',
    );
  const pageEntry = z
    .string()
    .optional()
    .describe("entry file of the package (default index.tsx)");
  const pageDeps = z.record(z.string(), z.string()).optional();
  const pagePerms = z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'SDK permissions declared by the page: { objects, write, workflows, files, ai }. `ai` = AI configs for useAI: { "default": { provider, model, secret }, "<name>": {...} } (no workspace default).',
    );
  const filePath = z.string().describe("relative file path in the package");
  const pageRow = async <T>(p: Promise<T | null>, id: string) => {
    const row = await p;
    if (!row)
      throw notFound(
        "mcp.pageNotFound",
        "Page not found: {id}. See page.list.",
        { id },
      );
    return row;
  };
  const getPage = async (id: string, draft = false) => {
    const p = await pagesService.get(ctx, id, { draft });
    if (!p)
      throw notFound(
        "mcp.pageNotFound",
        "Page not found: {id}. See page.list.",
        { id },
      );
    return p;
  };
  // Page capture job (app URL + read-only capture token).
  const pageJob = (
    pageIdValue: string,
    draft?: boolean,
    params?: Record<string, string>,
    componentState?: Record<string, Record<string, unknown>>,
  ) => {
    const url = new URL(`/p/${encodeURIComponent(pageIdValue)}`, appUrl());
    if (draft) url.searchParams.set("draft", "1");
    for (const [k, v] of Object.entries(params ?? {}))
      url.searchParams.set(k, v);
    for (const [block, state] of Object.entries(componentState ?? {}))
      for (const [k, v] of Object.entries(state))
        url.searchParams.set(`c.${block}.${k}`, JSON.stringify(v));
    const a = ctx.actor;
    const token = shotToken({
      ws: ctx.workspaceId,
      ...("userId" in a ? { user: a.userId } : { key: a.apiKeyId }),
      page: pageIdValue,
    });
    return {
      kind: "page" as const,
      workspaceId: ctx.workspaceId,
      url: url.href,
      token,
      theme: "light" as const,
    };
  };
  server.registerTool(
    "page.screenshot",
    {
      description:
        "PNG screenshot of a saved page as a user sees it (real workspace data, code components included), read-only: actions and workflows are not run. `draft: true` captures the draft (after page.update, before page.publish). Waits until every code component has finished rendering and loaders (skeletons) are gone (max 8 s). User account (OAuth) or API key. Returns the image then {errors, console}; errors include code component errors (also recorded in errors.list, source component). Use after page.create/update to check the rendering (desktop and mobile).",
      inputSchema: z.object({
        id: pageId,
        draft: z.boolean().optional().describe("capture the draft"),
        params: z
          .record(z.string(), z.string())
          .optional()
          .describe('URL parameters, e.g. {"id": "<recordId>"}'),
        componentState: z
          .record(z.string(), z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            'useParam state of code blocks: {<blockId>: {<key>: value}} (same as URL parameters c.<blockId>.<key>=<JSON>), e.g. {"app": {"tab": "deals"}}',
          ),
        viewport: z.enum(["desktop", "mobile"]).default("desktop"),
        theme: z.enum(["light"]).default("light"),
        audit: z
          .boolean()
          .optional()
          .describe(
            "also run an axe-core accessibility audit (WCAG 2.1 A/AA): returns `a11y` = [{id, impact, help, nodes, targets}]",
          ),
      }),
    },
    ({ id, draft, params, componentState, viewport, theme, audit }) =>
      runImage(async () => {
        const page = await getPage(id, draft);
        return render({
          ...pageJob(page.id, draft, params, componentState),
          viewport,
          theme,
          audit,
        });
      }),
  );
  const pageIcon = z
    .string()
    .optional()
    .describe(
      "Lucide icon of the page in the navigation (kebab-case, e.g. users, shopping-cart, kanban, chart-line; see lucide.dev/icons). Pick the icon that best fits the page content. Default: layout-dashboard.",
    );
  server.registerTool(
    "page.list",
    { description: "Lists the workspace pages." },
    () => run(() => pagesService.list(ctx)),
  );
  server.registerTool(
    "page.get",
    {
      description:
        "Reads a page package (files, entry, deps, permissions): the published version seen by users (null if never published), or the draft with `draft: true` (hasDraft = draft waiting for page.publish).",
      inputSchema: z.object({ id: pageId, draft: z.boolean().optional() }),
    },
    ({ id, draft }) => run(() => getPage(id, draft)),
  );
  server.registerTool(
    "page.versions",
    {
      description: "Published versions of a page.",
      inputSchema: z.object({ id: pageId }),
    },
    ({ id }) => run(() => pagesService.versions(ctx, id)),
  );
  server.registerTool(
    "page.errors",
    {
      description:
        "Recent browser runtime errors of a page (uncaught errors, unhandled rejections, React render errors, console.error), reported by the page iframe within seconds: the published version, or the draft with `draft: true`. Each error has message, location (file:line:col in the package source), stack, count (deduplicated) and lastSeen; errors expire after 24 h. Open the page first (page.screenshot) to collect them.",
      inputSchema: z.object({ id: pageId, draft: z.boolean().optional() }),
    },
    ({ id, draft }) => run(() => pagesService.errors(ctx, id, { draft })),
  );
  server.registerTool(
    "page.create",
    {
      description:
        "Creates a page from a TSX package (draft; `publish: true` publishes right away). Shared components are files of the package (e.g. components/card.tsx).",
      inputSchema: z.object({
        name: z.string().min(1),
        icon: pageIcon,
        files: pageFiles,
        entry: pageEntry,
        deps: pageDeps,
        permissions: pagePerms,
        publish: z.boolean().optional(),
      }),
    },
    (input) => run(() => pagesService.create(ctx, input)),
  );
  const fileOp = z.discriminatedUnion("op", [
    z.object({ op: z.literal("write"), path: filePath, source: z.string() }),
    z.object({
      op: z.literal("edit"),
      path: filePath,
      old: z.string().min(1).describe("exact text, must match once"),
      new: z.string(),
    }),
    z.object({ op: z.literal("rename"), from: filePath, to: filePath }),
    z.object({ op: z.literal("delete"), path: filePath }),
  ]);
  server.registerTool(
    "page.update",
    {
      description:
        "Updates a page. Name and icon apply immediately. `changes` is a file patch applied in order to the draft, all or nothing: {op: write, path, source} creates or replaces a file, {op: edit, path, old, new} replaces text matching once, {op: rename, from, to} (the entry follows), {op: delete, path} (not the entry). `files` replaces the whole package. Draft changes are invisible to users until page.publish (`publish: true` publishes right away). The package is recompiled: returns {page, errors} (compile errors, file:line), then, unless `review: false` or compile errors, `review` = {a11y (axe violations), pageErrors (runtime errors), renderErrors, warnings} followed by desktop and mobile screenshots of the draft.",
      inputSchema: z.object({
        id: pageId,
        name: z.string().min(1).optional(),
        icon: pageIcon,
        changes: z.array(fileOp).min(1).optional(),
        files: pageFiles.optional(),
        entry: pageEntry,
        deps: pageDeps,
        permissions: pagePerms,
        publish: z.boolean().optional(),
        review: z
          .boolean()
          .default(true)
          .describe(
            "automatic review of the draft (default true, skipped on compile errors): desktop and mobile screenshots, axe-core violations and runtime errors",
          ),
      }),
    },
    async ({ id, changes, review, ...patch }) => {
      let out: Record<string, unknown>;
      let page: Awaited<ReturnType<typeof getPage>>;
      try {
        if (changes)
          await pageRow(pagesService.patchFiles(ctx, id, changes), id);
        await pageRow(pagesService.update(ctx, id, patch), id);
        page = await getPage(id, true);
        const { errors } = await compilePackage(page.files, page.entry);
        out = {
          page,
          errors: errors.map((e) =>
            e.line
              ? `${e.file ?? ""}:${e.line}:${e.col ?? 0} ${e.text}`
              : e.text,
          ),
        };
      } catch (e) {
        return run(() => Promise.reject(e));
      }
      if (!review || (out.errors as string[]).length)
        return run(async () => out);
      // Review: captures, axe violations, runtime errors (page.errors).
      const r = await reviewPage(pageJob(page.id, true));
      const pageErrors = await pagesService
        .errors(ctx, page.id, { draft: true })
        .catch(() => []);
      out.review = {
        a11y: r.a11y,
        pageErrors,
        renderErrors: r.errors,
        warnings: r.warnings,
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(out) },
          ...r.shots.flatMap((s) => [
            { type: "text" as const, text: `${s.viewport} · ${s.theme}` },
            {
              type: "image" as const,
              data: s.png.toString("base64"),
              mimeType: "image/png",
            },
          ]),
        ],
      };
    },
  );
  server.registerTool(
    "page.publish",
    {
      description:
        "Publishes a page's draft: it becomes the version seen by users. Without a draft, changes nothing.",
      inputSchema: z.object({ id: pageId }),
    },
    ({ id }) =>
      run(async () => {
        const row = await pagesService.publish(ctx, id);
        if (!row)
          throw notFound(
            "mcp.pageNotFound",
            "Page not found: {id}. See page.list.",
            { id },
          );
        return row;
      }),
  );
  server.registerTool(
    "page.discard",
    {
      description:
        "Discards a page's draft: it goes back to the published version.",
      inputSchema: z.object({ id: pageId }),
    },
    ({ id }) =>
      run(async () => {
        const row = await pagesService.discard(ctx, id);
        if (!row)
          throw notFound(
            "mcp.pageNotFound",
            "Page not found: {id}. See page.list.",
            { id },
          );
        return row;
      }),
  );
  server.registerTool(
    "page.restore",
    {
      description:
        "Restores an old version: creates a new published version with its files (any draft is discarded).",
      inputSchema: z.object({ id: pageId, version: z.number().int().min(1) }),
    },
    ({ id, version }) =>
      run(async () => {
        const row = await pagesService.restore(ctx, id, version);
        if (!row)
          throw notFound(
            "mcp.pageVersionNotFound",
            "Page or version not found: {id} v{version}. See page.versions.",
            { id, version },
          );
        return row;
      }),
  );
  server.registerTool(
    "page.delete",
    {
      description: "Deletes a page and its versions.",
      inputSchema: z.object({ id: pageId }),
    },
    ({ id }) => run(() => pagesService.remove(ctx, id)),
  );
}
