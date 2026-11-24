// TSX code components: compilation (esbuild), test in the sandbox and capture.
// They are no longer stored separately: a component is a file
// of a page package (packages/core/src/pages).
import { z } from "zod";
import { requireScope } from "../api-keys";
import { execFunction } from "../functions/sandbox";
import type { TenantContext } from "../tenant";
import { compileComponent, type CompileError } from "./compile";
import {
  denied,
  handleSdkCall,
  parseCall,
  permissionsSchema,
  READ_METHODS,
  type ComponentPermissions,
} from "./sdk";

export {
  compileComponent,
  compilePackage,
  MAX_BUNDLE,
  MAX_SOURCE,
  type ComponentDep,
} from "./compile";
export {
  denied,
  handleSdkCall,
  parseCall,
  permissionsSchema,
  READ_METHODS,
  sdkCallSchema,
  type ComponentPermissions,
} from "./sdk";
import { AppError, appError } from "../errors/app-error";
export { EXAMPLES } from "./examples";
export { componentsGuide } from "./guide";

export const componentName = z
  .string()
  .regex(/^[a-z0-9_.-]+$/, "name: [a-z0-9_.-]")
  .max(100);

export const editsSchema = z
  .array(z.object({ old: z.string().min(1), new: z.string() }))
  .min(1)
  .describe(
    "Patch: {old, new} replacements applied in order to the latest version's source (`old` must appear exactly once)",
  );
// Applies exact replacements; each `old` must be unique.
export function applyEdits(
  source: string,
  edits: { old: string; new: string }[],
) {
  return edits.reduce((src, e, i) => {
    const at = src.indexOf(e.old);
    if (at < 0)
      throw appError("pages.editOldNotFound", "edits[{index}]: `old` not found", {
        index: i,
      });
    if (src.indexOf(e.old, at + 1) >= 0)
      throw appError(
        "pages.editOldAmbiguous",
        "edits[{index}]: `old` appears more than once",
        { index: i },
      );
    return src.slice(0, at) + e.new + src.slice(at + e.old.length);
  }, source);
}

export class CompileFailed extends AppError {
  constructor(readonly errors: CompileError[]) {
    super(
      "components.compileFailed",
      `Compilation failed:\n${errors
        .map((e) => (e.line ? `${e.line}:${e.col ?? 0} ${e.text}` : e.text))
        .join("\n")}`,
    );
  }
}

// Tools provided by the app (the core knows neither Tailwind nor the theme).
export type ComponentTools = {
  css: (sources: string[]) => Promise<string>;
};

function markDenied(p: ComponentPermissions, calls: unknown[]) {
  return calls.map((call) => {
    try {
      const why = denied(p, parseCall(call));
      return why ? { call, denied: why } : { call };
    } catch (e) {
      return { call, denied: (e as Error).message };
    }
  });
}

export const componentsService = {
  // Compiles and renders (renderToString) in the Deno sandbox without permissions,
  // with a mock SDK serving `data`; `harness` = bundled test runtime
  // (provided by the app, which owns React and the @ui components).
  test: async (
    ctx: TenantContext,
    input: {
      source?: string;
      edits?: { old: string; new: string }[];
      props?: Record<string, unknown>;
      data?: Record<string, unknown>;
      permissions?: ComponentPermissions;
    },
    harness: string,
  ) => {
    const { bundle, errors, perms } = await componentsService.prepare(
      ctx,
      input,
    );
    if (!bundle) return { errors, html: "", sdkCalls: [] };
    const out = (
      await execFunction(
        { code: harness },
        { bundle, props: input.props ?? {}, data: input.data ?? {} },
        { timeoutMs: 15_000 },
      )
    ).output as { errors: CompileError[]; html: string; sdkCalls: unknown[] };
    return {
      errors: out.errors,
      html: out.html,
      sdkCalls: markDenied(perms, out.sdkCalls),
    };
  },
  // Compiles a component (saved or `source`) for test or capture:
  // bundle, sources (CSS) and effective permissions.
  prepare: async (
    ctx: TenantContext,
    input: {
      source?: string;
      edits?: { old: string; new: string }[];
      permissions?: ComponentPermissions;
    },
  ) => {
    await requireScope(ctx, "admin");
    let source = input.source;
    const perms =
      input.permissions && permissionsSchema.parse(input.permissions);
    if (!source) throw appError("pages.sourceRequired", "source required");
    if (input.edits) source = applyEdits(source, input.edits);
    const r = await compileComponent(source);
    const p = perms ?? permissionsSchema.parse(undefined);
    return r.bundle
      ? { bundle: r.bundle, sources: r.sources, errors: [], perms: p }
      : { bundle: undefined, sources: [], errors: r.errors, perms: p };
  },
  // SDK call of a capture on real data: permissioned reads
  // only; actions, workflows and writes always simulated.
  previewCall: async (
    ctx: TenantContext,
    perms: ComponentPermissions,
    raw: unknown,
  ) => {
    await requireScope(ctx, "read");
    const call = parseCall(raw);
    const why = denied(perms, call);
    if (why) throw appError("sdk.denied", "{reason}", { reason: why });
    if (!READ_METHODS.includes(call.method)) return { simulated: true };
    return handleSdkCall(ctx, perms, call, {
      user: "userId" in ctx.actor ? { id: ctx.actor.userId } : null,
    });
  },
};
