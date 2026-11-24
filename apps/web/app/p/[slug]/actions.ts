"use server";

import { revalidatePath } from "next/cache";
import { READ_METHODS } from "@getrunbase/core/components";
import { pagesService } from "@getrunbase/core/pages";
import { componentCss } from "@/lib/component-css";
import { z } from "zod";
import { actionError } from "@/lib/action-error";
import { id as idSchema, parseInput } from "@/lib/action-input";
import { assertShot, getTenant } from "@/lib/tenant";
import { pageUser } from "./user";

const pageId = idSchema;
const draftFlag = z.boolean();
// Telemetry: oversized text is cut, not refused.
const errorInput = z.object({
  message: z.coerce.string().transform((v) => v.slice(0, 10_000)),
  stack: z
    .unknown()
    .transform((v) => (typeof v === "string" ? v.slice(0, 50_000) : undefined)),
});

// Compiled package (published, or draft if `draft`) mounted in the iframe.
export async function pageBundle(id: string, draft = false) {
  parseInput(pageId, id);
  parseInput(draftFlag, draft);
  const { ctx, shot } = await getTenant({ shot: true });
  assertShot(shot, id);
  const { bundle, sources, objects } = await pagesService.bundle(ctx, id, {
    draft,
  });
  return { bundle, objects, css: await componentCss(sources) };
}

// SDK call relayed from the iframe; capture: reads only (the rest is
// simulated). Error returned as a value: Next hides thrown messages.
export async function callPage(id: string, call: unknown, draft = false) {
  parseInput(pageId, id);
  parseInput(draftFlag, draft);
  const { session, ctx, shot } = await getTenant({ shot: true });
  assertShot(shot, id);
  const method = (call as { method?: unknown } | null)?.method;
  if (shot && !READ_METHODS.includes(String(method)))
    return { ok: true as const, result: { simulated: true } };
  try {
    const result = await pagesService.call(ctx, id, call, {
      draft,
      user: pageUser(session.user),
    });
    return { ok: true as const, result };
  } catch (e) {
    return { ok: false as const, error: actionError(e) };
  }
}

// Iframe runtime error, read by the page.errors MCP tool.
// Also accepted during capture (page.screenshot): telemetry, not a mutation.
export async function reportPageError(
  id: string,
  error: { message: string; stack?: string },
  draft = false,
) {
  parseInput(pageId, id);
  parseInput(draftFlag, draft);
  const { message, stack } = parseInput(errorInput, error);
  const { ctx, shot } = await getTenant({ shot: true, pages: true });
  assertShot(shot, id);
  await pagesService.reportError(ctx, id, { draft, message, stack });
}

// Draft and history (builders: write scope checked by the core).
export async function publishPage(id: string) {
  parseInput(pageId, id);
  const { ctx } = await getTenant();
  await pagesService.publish(ctx, id);
  revalidatePath(`/p/${id}`);
}
export async function discardDraft(id: string) {
  parseInput(pageId, id);
  const { ctx } = await getTenant();
  await pagesService.discard(ctx, id);
  revalidatePath(`/p/${id}`);
}
export async function pageHistory(id: string) {
  parseInput(pageId, id);
  const { ctx } = await getTenant();
  return (await pagesService.versions(ctx, id)).map((v) => ({
    version: v.version,
    createdAt: v.createdAt,
  }));
}
export async function restorePage(id: string, version: number) {
  parseInput(pageId, id);
  parseInput(z.number().int().positive(), version);
  const { ctx } = await getTenant();
  await pagesService.restore(ctx, id, version);
  revalidatePath(`/p/${id}`);
}
