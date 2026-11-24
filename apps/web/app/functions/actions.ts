"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { functionsService } from "@runbase/core/functions";
import { actionError, type ActionError } from "@/lib/action-error";
import { getTenant } from "@/lib/tenant";

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const json = (v: FormDataEntryValue | null) => JSON.parse(String(v || "{}"));

// Functions: saving creates a version, so does restoring.
export async function saveFunction(f: FormData) {
  const { ctx } = await getTenant();
  const row = await functionsService.save(ctx, {
    name: String(f.get("name")),
    code: String(f.get("code")),
    inputSchema: json(f.get("inputSchema")),
    outputSchema: json(f.get("outputSchema")),
    permissions: {
      domains: list(f.get("domains")),
      secrets: list(f.get("secrets")),
    },
  });
  revalidatePath("/functions", "layout");
  redirect(`/functions/${row.name}`);
}

export async function restoreFunction(f: FormData) {
  const { ctx } = await getTenant();
  const name = String(f.get("name"));
  await functionsService.restore(ctx, name, Number(f.get("version")));
  revalidatePath(`/functions/${name}`);
}

export type TestResult = {
  output?: unknown;
  logs?: string;
  error?: ActionError;
};

// Test button: same service as the functions.test MCP tool.
export async function testFunction(
  _: TestResult | null,
  f: FormData,
): Promise<TestResult> {
  const { ctx } = await getTenant();
  try {
    return await functionsService.test(
      ctx,
      String(f.get("name")),
      json(f.get("input")),
      Number(f.get("version")) || undefined,
    );
  } catch (e) {
    return { error: actionError(e) };
  }
}
