// MCP tools: functions and code components.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { TenantContext } from "@getrunbase/core/tenant";
import { notFound, requireConfirm } from "@getrunbase/core/errors";
import {
  functionInputSchema,
  functionsService,
} from "@getrunbase/core/functions";
import {
  editsSchema,
  componentsGuide,
  componentsService,
  EXAMPLES,
  formatCompileError,
  permissionsSchema,
} from "@getrunbase/core/components";
import { runtimeCsp, runtimeHtml, testHarness } from "@/lib/code-runtime";
import { componentCss } from "@/lib/component-css";
import { render } from "@getrunbase/core/render";
import { lintFunction } from "@getrunbase/core/lint";
import { run, must, runImage, viewports, themes, linted } from "./shared";

export function defineFunctionTools(server: McpServer, ctx: TenantContext) {
  // Functions
  const fnName = z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case, e.g. score-lead")
    .describe("Function name (kebab-case, e.g. score-lead)");
  const fnSdk =
    "Code: `export default async (input, { records, events, secrets, test }) => output`. Failure convention in a workflow (fn.* step): return `{ ok: false, error: \"message\" }` or throw: the step fails, is retried per its retry policy, then the run fails and the error appears in errors.list. `test`: true inside a test run (runs.start { test: true }, or a run inherited from one); records and events written by the function in a test run are marked test automatically. Declared secrets: `secrets` context key (and input.secrets if the input does not already have that field). Records SDK (permissions.records 'read': get, search; 'write': + upsert, update, transact, delete, merge): `await records.get(id)`, `records.search(object, {filter, limit, sort, after})` (object = slug or uuid; filter `{all: [{field, op, value}]}` or `{any: [...]}`, field = field key; returns `{ records: [{ id, data, ... }], hasMore, total, next }`, read values in `records[i].data`), `records.upsert({objectId: slug or uuid, data, match})` (returns {record, created}), `records.update(id, data)`, `records.transact(ops)`, `records.delete(id)` (trash), `records.merge(keepId, [ids])`; also as a global `records`. Events SDK (permissions.events 'read': `events.list({type, recordId, from, to, cursor, limit})`; 'write': + `events.push({type, recordId, payload, occurredAt, idempotencyKey})`). `permissions.domains`: hostnames or `'*'` = whole public internet (admin scope); private/loopback/link-local/cloud metadata IPs (RFC1918, 127/8, ::1, 169.254/16, 100.64/10, fc00::/7) are blocked after DNS resolution and on redirects. HTML: `parseHTML(html)` returns `{ document }` (linkedom: querySelectorAll, textContent, getAttribute) and `new DOMParser().parseFromString(html, 'text/html')`, as globals and `ctx.parseHTML`; no browser rendering, no npm imports. `limits`: { timeoutMs 1000-120000 (default 30000), memoryMb 32-512 (default 128) }. console.* = logs (64 KB max), visible in functions.test, functions.logs and runs.get.";

  server.registerTool(
    "functions.list",
    { description: "Lists the workspace functions (latest version)." },
    () => run(() => functionsService.list(ctx)),
  );
  server.registerTool(
    "functions.get",
    {
      description:
        "Reads a function by name: latest version, or a fixed version if `version` is given.",
      inputSchema: z.object({
        name: fnName,
        version: z.number().int().min(1).optional(),
      }),
    },
    ({ name, version }) => run(() => functionsService.get(ctx, name, version)),
  );
  server.registerTool(
    "functions.versions",
    {
      description: "Lists the (immutable) versions of a function.",
      inputSchema: z.object({ name: fnName }),
    },
    ({ name }) => run(() => functionsService.versions(ctx, name)),
  );
  server.registerTool(
    "functions.save",
    {
      description:
        "Creates a TypeScript function or, if the name exists, creates a new version of it (admin scope). Permissions: network domains, secrets, records, events. Returns `lint` warnings ({ code, path, message, hint }) when the function breaks workspace standards: fix them and save again. " +
        fnSdk,
      inputSchema: functionInputSchema,
    },
    (input) =>
      run(() =>
        linted(ctx, lintFunction(input), () =>
          functionsService.save(ctx, input),
        ),
      ),
  );
  server.registerTool(
    "functions.create",
    {
      description:
        "Creates a TypeScript function (admin scope), refused if the name exists. Then usable as block fn.<name>. " +
        fnSdk,
      inputSchema: functionInputSchema,
    },
    (input) =>
      run(() =>
        linted(ctx, lintFunction(input), () =>
          functionsService.create(ctx, input),
        ),
      ),
  );
  server.registerTool(
    "functions.update",
    {
      description:
        "Creates a new version of an existing function (admin scope). " + fnSdk,
      inputSchema: functionInputSchema,
    },
    (input) =>
      run(() =>
        linted(ctx, lintFunction(input), () =>
          functionsService.update(ctx, input),
        ),
      ),
  );
  server.registerTool(
    "functions.delete",
    {
      description:
        "Deletes a function and all its versions (admin scope). Irreversible: confirm: true required. Workflows that use it (fn.<name>) will fail.",
      inputSchema: z.object({ name: fnName, confirm: z.boolean().optional() }),
    },
    ({ name, confirm }) =>
      run(async () => {
        requireConfirm(
          confirm,
          "functions.deleteConfirm",
          "Deleting the function",
        );
        return must(
          functionsService.remove(ctx, name),
          "Function",
          name,
          "See functions.list.",
        );
      }),
  );
  server.registerTool(
    "functions.restore",
    {
      description:
        "Restores a previous version (creates a new version with its content).",
      inputSchema: z.object({
        name: fnName,
        version: z.number().int().min(1),
      }),
    },
    ({ name, version }) =>
      run(() =>
        must(
          functionsService.restore(ctx, name, version),
          "Function version",
          `${name}@${version}`,
          "See functions.versions for existing versions.",
        ),
      ),
  );
  server.registerTool(
    "functions.test",
    {
      description:
        "Really runs a function, outside any workflow: returns output and logs. Without dryRun, its writes (records, events) and network calls happen. dryRun: true: real reads, records/events writes simulated (not made) and listed in `writes` [{ method, args }]; network calls still go out. test: true runs it as test data: the `test` context key is true and records/events it writes are marked test (deleted by workspace.purge_test, and existing test records stay test).",
      inputSchema: z.object({
        name: fnName,
        input: z.record(z.string(), z.unknown()).default({}),
        version: z.number().int().min(1).optional(),
        dryRun: z.boolean().optional(),
        test: z.boolean().optional(),
      }),
    },
    ({ name, input, version, dryRun, test }) =>
      run(() =>
        functionsService.test(ctx, name, input, version, { dryRun, test }),
      ),
  );
  server.registerTool(
    "functions.logs",
    {
      description:
        "Logs of function executions (workflow, page, test), most recent first: console logs, error, duration, originating run and step. Filters: name, runId, source, errorsOnly. Returns { items, hasMore, nextCursor }.",
      inputSchema: z.object({
        name: fnName.optional(),
        runId: z.string().optional(),
        source: z.enum(["workflow", "page", "test"]).optional(),
        errorsOnly: z.boolean().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
    (f) => run(() => functionsService.logs(ctx, f)),
  );

  // Code components: TSX compiled (esbuild) and tested without being stored; a
  // component lives in a page's file package.
  server.registerTool(
    "page.test",
    {
      description: [
        "Compiles and renders a component. Without `screenshot`: renderToString (sandbox without network or effects) with a mock SDK serving `data` = {<object id>: rows[], records?: {<id>: record}, timeline?: {<recordId>: events[]}, objects?: {<id>: {name, fields}}, user?} (filter, q, sort, pagination, groupBy/aggregate applied in memory; page.examples provides full `data`); returns {errors, html, sdkCalls}, each SDK call outside permissions marked `denied`.",
        'With `screenshot`: real rendering in headless Chromium (iframe runtime, compiled CSS, effects run, no network) and returns one PNG image per viewport × theme, then {errors, console, sdkCalls}. `screenshot.data`: "mock" (default, serves `data`) or "live" (real workspace reads with the permissions; actions, workflows and writes simulated). Always look at the desktop AND mobile screenshots.',
      ].join("\n"),
      inputSchema: z.object({
        source: z
          .string()
          .optional()
          .describe("TSX to test (a single component); or pass `files`"),
        files: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'TSX package to test, same shape as page.create: {"index.tsx": "…", "components/card.tsx": "…"}; built with the same browser config as page.create',
          ),
        entry: z
          .string()
          .optional()
          .describe("entry file of `files` (default index.tsx)"),
        edits: editsSchema
          .optional()
          .describe("{old, new} replacements applied to `source`"),
        props: z.record(z.string(), z.unknown()).optional(),
        data: z.record(z.string(), z.unknown()).optional(),
        permissions: permissionsSchema.unwrap().optional(),
        screenshot: z
          .object({
            viewports,
            themes,
            data: z.enum(["mock", "live"]).default("mock"),
            interactions: z
              .array(
                z.union([
                  z.object({ click: z.string() }),
                  z.object({ type: z.string(), text: z.string() }),
                  z.object({ wait: z.union([z.number(), z.string()]) }),
                ]),
              )
              .max(20)
              .optional()
              .describe(
                'played before each screenshot: {click: "<selector>"}, {type: "<selector>", text}, {wait: ms | "<selector>"} (3 s max each)',
              ),
          })
          .optional(),
      }),
    },
    async ({ screenshot, ...input }) => {
      if (!screenshot)
        return run(async () =>
          componentsService.test(ctx, input, await testHarness()),
        );
      return runImage(async () => {
        const c = await componentsService.prepare(ctx, input);
        if (!c.bundle)
          return {
            shots: [],
            errors: c.errors.map(formatCompileError),
            console: [],
          };
        // Rendered by the renderer service; it serves the SDK calls itself.
        return render({
          kind: "component",
          ctx,
          html: await runtimeHtml(),
          csp: runtimeCsp(),
          bundle: c.bundle,
          css: await componentCss(c.sources),
          props: input.props ?? {},
          viewports: screenshot.viewports,
          themes: screenshot.themes,
          interactions: screenshot.interactions,
          data:
            screenshot.data === "live"
              ? { mode: "live", perms: c.perms }
              : { mode: "mock", data: input.data ?? {} },
        });
      });
    },
  );
  server.registerTool(
    "page.guide",
    {
      description:
        "Page guide, to read before writing a page: package structure (entry, files, relative imports), @getrunbase/sdk hooks, @getrunbase/kit blocks, permissions, strict design rules (spacing, hierarchy, empty/loading/error states, responsive, accessibility) and the @ui modules.",
    },
    () =>
      run(async () => ({
        guide: componentsGuide(
          readdirSync(join(process.cwd(), "components/ui"))
            .filter((f) => f.endsWith(".tsx"))
            .map((f) => f.slice(0, -4)),
        ),
      })),
  );
  server.registerTool(
    "page.examples",
    {
      description:
        "Reference page packages built on @getrunbase/kit (crm, kanban, dashboard). Without `name`: summarized list {name, description}, paginated (offset, limit). With `name`: the full example (files, entry, permissions, mock `data`), ready for page.create. Adapt object ids and field names to the workspace.",
      inputSchema: z.object({
        name: z.string().optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(20).default(10),
      }),
    },
    ({ name, offset, limit }) =>
      run(async () => {
        if (!name)
          return {
            total: EXAMPLES.length,
            items: EXAMPLES.slice(offset, offset + limit).map(
              ({ name, description }) => ({ name, description }),
            ),
          };
        const ex = EXAMPLES.find((e) => e.name === name);
        if (!ex)
          throw notFound(
            "mcp.exampleNotFound",
            "Unknown example: {name}. See page.examples.",
            { name },
          );
        return ex;
      }),
  );
}
