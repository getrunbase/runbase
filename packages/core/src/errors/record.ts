// Writing an error into the error center. Separate from the service
// so that ingestion and the engine can import it without a cycle.
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
