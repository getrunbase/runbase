// Writing an error into the error center. Separate from the service
// so that ingestion and the engine can import it without a cycle.
import { errors } from "../db/schema";
import { cleanError, fingerprint, truncateStack } from "./clean";
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
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .insert(errors)
      .values({
        ...e,
        // Without ANSI or sandbox paths, bounded, with fingerprint.
        message: cleanError(e.message),
        stack: e.stack ? truncateStack(e.stack) : e.stack,
        fingerprint: fingerprint(e.message),
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
      })
      .returning(),
  );
  return row!;
}
