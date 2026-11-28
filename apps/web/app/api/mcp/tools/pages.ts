// MCP tools: pages.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { TenantContext } from "@getrunbase/core/tenant";
import { appError, notFound } from "@getrunbase/core/errors";
import {
  compilePackage,
  formatCompileError,
  formatLintWarning,
  lintPackage,
} from "@getrunbase/core/components";
import {
  render,
  rendererHealth,
  reviewPage,
  type PageReview,
} from "@getrunbase/core/render";
import { appUrl, shotToken } from "@/lib/screenshot-token";
import { pagesService } from "@getrunbase/core/pages";
import { run, runImage } from "./shared";

// Plain statement returned when the renderer is down: the page was compiled
// but nobody looked at it.
export const RENDER_NOT_CHECKED =
  "render not checked: the rendering service is unavailable (platform outage, not an error in the page); only the server-side compile was checked";

// Publish gate: the draft compiles (enforced by the core on every publish)
// and was rendered without errors, unless `force`. Returns null when the
// draft may be published, otherwise the reason to refuse.
export function publishBlock(
  review: Pick<PageReview, "shots" | "errors"> & { pageErrors: unknown[] },
): string | null {
  if (!review.shots.length) return RENDER_NOT_CHECKED;
  const n = review.errors.length + review.pageErrors.length;
  return n ? `the draft renders with ${n} error(s)` : null;
}

export function definePageTools(server: McpServer, ctx: TenantContext) {
  // Pages: an agent builds a page only through MCP.
  const pageId = z.string().describe("Page id or name (see page.list)");
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
  const force = z
    .boolean()
    .optional()
    .describe(
      "publish even when the draft was not rendered (renderer down) or renders with errors; compile errors always refuse",
    );
  const filePath = z.string().describe("relative file path in the package");
  // Page id or name -> id (workflow resolver pattern).
  const ref = async (id: string) => {
    const found = await pagesService.resolveId(ctx, id);
    if (!found)
      throw notFound(
        "mcp.pageNotFound",
        "Page not found: {id}. See page.list.",
        { id },
      );
    return found;
  };
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
    const p = await pagesService.get(ctx, await ref(id), { draft });
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
  // Draft review: captures, axe violations, runtime errors reported during
  // this review only (older page.errors entries do not block a publish).
  const review = async (id: string) => {
    const since = Date.now();
    const r = await reviewPage(pageJob(id, true));
    const pageErrors = (
      await pagesService.errors(ctx, id, { draft: true }).catch(() => [])
    ).filter((e) => new Date(e.lastSeen).getTime() >= since);
    return { ...r, pageErrors };
  };
  // Rendered-or-force gate shared by page.publish and page.update.
  const gate = async (
    id: string,
    opts: { force?: boolean; reviewed?: Awaited<ReturnType<typeof review>> },
  ) => {
    if (opts.force) return;
    const r =
      opts.reviewed ??
      ((await rendererHealth()).available
        ? await review(id)
        : { shots: [], errors: [], pageErrors: [] });
    const why = publishBlock(r);
    if (why)
      throw appError(
        "pages.publishUnverified",
        "Not published: {reason}. The draft is kept. Check it with page.screenshot {draft: true} and page.errors {draft: true}, fix it with page.update, or pass force: true to publish anyway.",
        { reason: why },
        { kind: "conflict" },
      );
  };
  server.registerTool(
    "page.screenshot",
    {
      description: `PNG screenshot of a saved page as a user sees it (real workspace data, code components included), read-only: actions and workflows are not run. \`draft: true\` captures the draft (after page.update, before page.publish). Waits until every code component has finished rendering and loaders (skeletons) are gone (max 8 s). User account (OAuth) or API key. Returns the image then {errors, console}; errors include code component errors (also recorded in errors.list, source component). Use after page.create/update to check the rendering (desktop and mobile). When the rendering service is down, returns no image but {rendered: false, notice, compile: {ok, errors}}: the package was compiled, the render was not checked.`,
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
        const health = await rendererHealth();
        if (!health.available)
          return {
            shots: [],
            errors: [],
            console: [],
            rendered: false,
            notice: RENDER_NOT_CHECKED,
            compile: await pagesService.bundleStatus(page),
          };
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
        "Reads a page package (files, entry, deps, permissions): the published version seen by users, or the draft with `draft: true` (hasDraft = draft waiting for page.publish). `bundle` = {ok, errors} is the server-side compile status of that package (errors as file:line:col). A page never published returns not_found without `draft`: read it with `draft: true`.",
      inputSchema: z.object({ id: pageId, draft: z.boolean().optional() }),
    },
    ({ id, draft }) =>
      run(async () => {
        // The stored bundle is an internal artifact: replaced by its status.
        const page = await getPage(id, draft);
        return { ...page, bundle: await pagesService.bundleStatus(page) };
      }),
  );
  server.registerTool(
    "page.versions",
    {
      description: "Published versions of a page.",
      inputSchema: z.object({ id: pageId }),
    },
    ({ id }) => run(async () => pagesService.versions(ctx, await ref(id))),
  );
  server.registerTool(
    "page.errors",
    {
      description:
        "Recent browser runtime errors of a page (uncaught errors, unhandled rejections, React render errors, console.error), reported by the page iframe within seconds: the published version, or the draft with `draft: true`. Each error has message, location (file:line:col in the package source), stack, count (deduplicated) and lastSeen; errors expire after 24 h. Open the page first (page.screenshot) to collect them.",
      inputSchema: z.object({ id: pageId, draft: z.boolean().optional() }),
    },
    ({ id, draft }) =>
      run(async () => pagesService.errors(ctx, await ref(id), { draft })),
  );
  server.registerTool(
    "page.create",
    {
      description:
        "Creates a page from a TSX package (draft). Shared components are files of the package (e.g. components/card.tsx). Returns the page, `errors` (server-side compile errors, file:line:col) and `warnings` (static checks, file:line [rule]: arbitrary Tailwind values, palette classes, hard-coded select options, client-side grouping, `any` around SDK results, missing loading/empty/error states): fix them with page.update. `publish: true` publishes only when the package compiles; prefer page.screenshot {draft: true} then page.publish.",
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
    (input) =>
      run(async () => {
        const page = await pagesService.create(ctx, input);
        const { errors } = await pagesService.bundleStatus(page);
        return {
          ...page,
          errors,
          warnings: lintPackage(input.files).map(formatLintWarning),
        };
      }),
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
        "Updates a page. Name and icon apply immediately. `changes` is a file patch applied in order to the draft, all or nothing: {op: write, path, source} creates or replaces a file, {op: edit, path, old, new} replaces text matching once, {op: rename, from, to} (the entry follows), {op: delete, path} (not the entry). `files` replaces the whole package. Draft changes are invisible to users until page.publish. The package is recompiled: returns {page, errors, warnings} (compile errors and static-check warnings, file:line), then, unless `review: false` or compile errors, `review` = {a11y (axe violations), pageErrors (runtime errors), renderErrors, warnings} followed by desktop and mobile screenshots of the draft. `publish: true` publishes after the same gate as page.publish: no compile error, and the draft rendered without errors (or `force: true`); otherwise `published: false` and `publishBlocked` says why.",
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
        force,
        review: z
          .boolean()
          .default(true)
          .describe(
            "automatic review of the draft (default true, skipped on compile errors): desktop and mobile screenshots, axe-core violations and runtime errors",
          ),
      }),
    },
    async ({
      id: given,
      changes,
      review: wantReview,
      publish,
      force: forced,
      ...patch
    }) => {
      let out: Record<string, unknown>;
      let page: Awaited<ReturnType<typeof getPage>>;
      let id: string;
      try {
        id = await ref(given);
        if (changes)
          await pageRow(pagesService.patchFiles(ctx, id, changes), given);
        await pageRow(pagesService.update(ctx, id, patch), given);
        page = await getPage(id, true);
        const { errors } = await compilePackage(page.files, page.entry);
        out = {
          page,
          errors: errors.map(formatCompileError),
          warnings: lintPackage(page.files).map(formatLintWarning),
        };
      } catch (e) {
        return run(() => Promise.reject(e));
      }
      const compileFailed = (out.errors as string[]).length > 0;
      let reviewed: Awaited<ReturnType<typeof review>> | undefined;
      if (wantReview && !compileFailed) {
        reviewed = await review(page.id);
        out.review = {
          a11y: reviewed.a11y,
          pageErrors: reviewed.pageErrors,
          renderErrors: reviewed.errors,
          warnings: reviewed.warnings,
        };
        if (!reviewed.shots.length)
          (out.review as Record<string, unknown>).notice = RENDER_NOT_CHECKED;
      }
      if (publish) {
        if (compileFailed) {
          out.published = false;
          out.publishBlocked = "the draft does not compile: fix `errors`";
        } else
          try {
            await gate(page.id, { force: forced, reviewed });
            out.page = await pagesService.publish(ctx, page.id);
            out.published = true;
          } catch (e) {
            out.published = false;
            out.publishBlocked = (e as Error).message;
          }
      }
      if (!reviewed?.shots.length) return run(async () => out);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(out) },
          ...reviewed.shots.flatMap((s) => [
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
        "Publishes a page's draft: it becomes the version seen by users. Without a draft, changes nothing. Refused when the draft does not compile (always), or, without `force: true`, when the draft could not be rendered (rendering service down: the render was not checked) or renders with errors (render errors or page.errors reported during the check).",
      inputSchema: z.object({ id: pageId, force }),
    },
    ({ id: given, force: forced }) =>
      run(async () => {
        const id = await ref(given);
        const draft = await getPage(id, true);
        if (draft.hasDraft) {
          const status = await pagesService.bundleStatus(draft);
          if (!status.ok)
            throw appError(
              "pages.publishCompileFailed",
              "Not published: the draft does not compile: {errors}. Fix it with page.update.",
              { errors: status.errors.join("; ") },
              { kind: "invalid_input" },
            );
          await gate(id, { force: forced });
        }
        return pageRow(pagesService.publish(ctx, id), given);
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
      run(async () => pageRow(pagesService.discard(ctx, await ref(id)), id)),
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
        const row = await pagesService.restore(ctx, await ref(id), version);
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
    ({ id }) => run(async () => pagesService.remove(ctx, await ref(id))),
  );
}
