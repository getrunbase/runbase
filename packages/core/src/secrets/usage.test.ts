// Secret usages: references by name, never a value.
// Integration: DATABASE_URL and SECRETS_MASTER_KEY required.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { pagesService } from "../pages";
import type { TenantContext } from "../tenant";
import { secretsService } from "./index";
import { secretRefs, secretUsageService } from "./usage";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

test("secretRefs: {{secret.X}} templates and secret field (HMAC)", () => {
  const refs = secretRefs({
    steps: [
      { input: { headers: { authorization: "Bearer {{ secret.API_KEY }}" } } },
      { input: { url: "{{secret.SLACK}}", secret: "HMAC_KEY" } },
      { input: { text: "{{trigger.name}} secret.NOPE" } },
    ],
  });
  assert.deepEqual([...refs].sort(), ["API_KEY", "HMAC_KEY", "SLACK"]);
});

async function owner(): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values ('U') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'W') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'U', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

test("usages: workflows, functions (latest version) and page AI configs", async () => {
  const ctx = await owner();
  const value = `sk-${crypto.randomUUID()}`;
  await secretsService.set(ctx, "API_KEY", value);
  const [wf] = await sql`insert into workflows (organization_id, workspace_id, name)
    values (${ctx.organizationId}, ${ctx.workspaceId}, 'Sync') returning id`;
  await sql`insert into workflow_versions (organization_id, workflow_id, version, definition)
    values (${ctx.organizationId}, ${wf!.id}, 1, ${sql.json({ steps: [{ input: { h: "{{secret.API_KEY}}" } }] })})`;
  const fn = (version: number, secrets: string[]) =>
    sql`insert into functions (organization_id, workspace_id, name, version, code, input_schema, output_schema, permissions)
      values (${ctx.organizationId}, ${ctx.workspaceId}, 'enrich', ${version}, 'x', '{}', '{}', ${sql.json({ domains: [], secrets })})`;
  await fn(1, ["OLD"]);
  await fn(2, ["API_KEY"]);
  // Page AI: explicit secret and preset default secret.
  await pagesService.create(ctx, {
    name: "Assistant",
    files: { "index.tsx": "export default function P() { return null; }" },
    permissions: {
      ai: {
        default: { provider: "openai", secret: "API_KEY" },
        summary: { provider: "anthropic" },
      },
    },
  });

  const all = await secretUsageService.all(ctx);
  assert.deepEqual(all.API_KEY!.map((u) => u.type).sort(), [
    "function",
    "page",
    "workflow",
  ]);
  assert.deepEqual(
    all.ANTHROPIC_API_KEY!.map((u) => u.type),
    ["page"],
  );
  assert.equal(all.OLD, undefined);
  assert.ok(!JSON.stringify(all).includes(value));
});
