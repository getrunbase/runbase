// Secrets vault: values encrypted with AES-256-GCM. Envelope
// encryption: one DEK per workspace (workspace_keys) encrypts its
// secrets, the DEK is encrypted by the master key (SECRETS_MASTER_KEY, 32
// bytes in base64, only in the environment; interface ready for a
// KMS). Values never leave the core: the API, MCP and front end only
// see the names; only the engine decrypts them (`decryptAll`).
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { db } from "../db/client";
import { secrets, workspaceKeys } from "../db/schema";
import { withTenant, type TenantContext, type Tx } from "../tenant";
import { resumeBudgetRuns } from "../runs/budget";
import {
  decryptWith,
  encryptWith,
  envMasterKey,
  newDek,
  type MasterKeyProvider,
} from "./crypto";

// Decrypted DEKs, by encrypted value (a rotation changes the cache key).
const dekCache = new Map<string, Buffer>();
async function unwrapDek(wrapped: string, provider: MasterKeyProvider) {
  let dek = dekCache.get(wrapped);
  if (!dek) {
    dek = await provider.unwrap(wrapped);
    if (dekCache.size > 1000) dekCache.clear();
    dekCache.set(wrapped, dek);
  }
  return dek;
}

// DEK of the context workspace, created with the first secret.
async function workspaceDek(tx: Tx, ctx: TenantContext) {
  const read = () =>
    tx
      .select({ w: workspaceKeys.dekEncrypted })
      .from(workspaceKeys)
      .where(eq(workspaceKeys.workspaceId, ctx.workspaceId));
  let [row] = await read();
  if (!row) {
    await tx
      .insert(workspaceKeys)
      .values({
        workspaceId: ctx.workspaceId,
        organizationId: ctx.organizationId,
        dekEncrypted: await envMasterKey.wrap(newDek()),
      })
      .onConflictDoNothing();
    [row] = await read();
  }
  return unwrapDek(row!.w, envMasterKey);
}

export const secretNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_]+$/, "name: [A-Za-z0-9_]");

export async function putSecret(
  tx: Tx,
  ctx: TenantContext,
  name: string,
  value: string,
) {
  const dek = await workspaceDek(tx, ctx);
  const v = { valueEncrypted: encryptWith(dek, value), updatedAt: new Date() };
  await tx
    .insert(secrets)
    .values({
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      name: secretNameSchema.parse(name),
      ...v,
    })
    .onConflictDoUpdate({
      target: [secrets.workspaceId, secrets.name],
      set: v,
    });
}

// Internal read (engine): name -> plain value.
export async function decryptAll(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(secrets)
      .where(eq(secrets.workspaceId, ctx.workspaceId));
    let dek: Promise<Buffer> | undefined;
    const get = () => (dek ??= workspaceDek(tx, ctx));
    const out: Record<string, string> = {};
    for (const r of rows)
      out[r.name] = decryptWith(await get(), r.valueEncrypted);
    return out;
  });
}

// Master key rotation: only the DEKs are re-encrypted (one
// row per workspace), secrets stay intact. All or nothing.
export async function rotateMasterKey(
  from: MasterKeyProvider,
  to: MasterKeyProvider,
) {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(workspaceKeys).for("update");
    for (const r of rows)
      await tx
        .update(workspaceKeys)
        .set({
          dekEncrypted: await to.wrap(await from.unwrap(r.dekEncrypted)),
          rotatedAt: new Date(),
        })
        .where(eq(workspaceKeys.workspaceId, r.workspaceId));
    return rows.length;
  });
}

// A single decrypted secret (incoming webhooks), or undefined.
export async function decryptSecret(ctx: TenantContext, name: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ v: secrets.valueEncrypted })
      .from(secrets)
      .where(
        and(eq(secrets.workspaceId, ctx.workspaceId), eq(secrets.name, name)),
      );
    return row ? decryptWith(await workspaceDek(tx, ctx), row.v) : undefined;
  });
}

// Replaces each secret value with *** (run logs).
export const redact = (text: string, values: Record<string, string>) =>
  Object.values(values)
    .filter(Boolean)
    .reduce((t, v) => t.split(v).join("***"), text);

const ref = (name: string) => ({ type: "secret", id: name });

export const secretsService = {
  // Names only, never values.
  list: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) =>
      tx
        .select({ name: secrets.name, updatedAt: secrets.updatedAt })
        .from(secrets)
        .where(eq(secrets.workspaceId, ctx.workspaceId))
        .orderBy(secrets.name),
    );
  },
  set: async (ctx: TenantContext, name: string, value: string) => {
    await requireScope(ctx, "admin");
    await withTenant(ctx, async (tx) => {
      await putSecret(tx, ctx, name, z.string().min(1).parse(value));
      await audit(tx, ctx, "secret.set", ref(name), { name });
    });
    // Own AI key added: runs paused on budget resume.
    if (name === "DEEPSEEK_API_KEY") {
      await resumeBudgetRuns(ctx);
    }
  },
  remove: async (ctx: TenantContext, name: string) => {
    await requireScope(ctx, "admin");
    await withTenant(ctx, async (tx) => {
      await tx
        .delete(secrets)
        .where(
          and(eq(secrets.workspaceId, ctx.workspaceId), eq(secrets.name, name)),
        );
      await audit(tx, ctx, "secret.remove", ref(name), { name });
    });
  },
};
