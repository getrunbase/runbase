// Writing an error into the error center. Separate from the service
// so that ingestion and the engine can import it without a cycle.
import { and, eq, sql } from "drizzle-orm";
import { errors } from "../db/schema";
import { cleanError, cleanStack, fingerprint, formatIssues } from "./clean";
import { withTenant, type TenantContext } from "../tenant";

export type NewError = Omit<
  typeof errors.$inferInsert,
  | "id"
  | "organizationId"
  | "workspaceId"
  | "status"
  | "createdAt"
  | "fingerprint"
>;

export async function recordError(ctx: TenantContext, e: NewError) {
  const message = formatIssues(e.message);
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .insert(errors)
      .values({
        ...e,
        // Without ANSI, sandbox or server paths, bounded, with fingerprint.
        // Zod issues as `field: message` lines.
        message: cleanError(message),
        stack: e.stack ? cleanStack(e.stack) : e.stack,
        fingerprint: fingerprint(message),
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
      })
      .returning(),
  );
  return row!;
}

// Event whose trigger fan-out failed (open error with its `eventId`): a
// resend must not be swallowed as a duplicate.
export async function hasFailedFanOut(ctx: TenantContext, eventId: string) {
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ id: errors.id })
      .from(errors)
      .where(
        and(
          eq(errors.workspaceId, ctx.workspaceId),
          eq(errors.status, "open"),
          eq(errors.source, "workflow"),
          sql`${errors.payload}->>'eventId' = ${eventId}`,
        ),
      )
      .limit(1),
  );
  return !!row;
}

// Closes the fan-out errors of an event for one workflow (mapping succeeded).
export async function resolveFanOutErrors(
  ctx: TenantContext,
  eventId: string,
  workflowId: string,
) {
  await withTenant(ctx, (tx) =>
    tx
      .update(errors)
      .set({ status: "resolved" })
      .where(
        and(
          eq(errors.workspaceId, ctx.workspaceId),
          eq(errors.status, "open"),
          eq(errors.source, "workflow"),
          sql`${errors.payload}->>'eventId' = ${eventId}`,
          sql`${errors.payload}->>'workflowId' = ${workflowId}`,
        ),
      ),
  );
}
