// Integration test: requires DATABASE_URL and SECRETS_MASTER_KEY.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { type TenantContext } from "../tenant";
import { workspaceSettings, workspacesService } from "../workspaces";
import { decryptAll, secretsService as secrets } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

async function owner(name: string): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values (${name}) returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, ${name}, ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

test("encrypted secrets: only names exposed, no plain text in a dump", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const a = await owner("SA");
  const b = await owner("SB");
  const plain = `sk-${crypto.randomUUID()}`;
  const viaSettings = `tok-${crypto.randomUUID()}`;

  await secrets.set(a, "API_KEY", plain);
  await workspacesService.setSettings(a, { secrets: { SLACK: viaSettings } });

  // Names only.
  const list = await secrets.list(a);
  assert.deepEqual(
    list.map((s) => s.name),
    ["API_KEY", "SLACK"],
  );
  assert.ok(!JSON.stringify(list).includes(plain));
  assert.ok(
    !JSON.stringify(await workspacesService.list(a)).includes(viaSettings),
  );

  // The engine decrypts them.
  assert.deepEqual((await workspaceSettings(a)).secrets, {
    API_KEY: plain,
    SLACK: viaSettings,
  });

  // Replacement, isolation, deletion.
  await secrets.set(a, "API_KEY", plain + "2");
  assert.equal((await decryptAll(a)).API_KEY, plain + "2");
  await secrets.set(a, "API_KEY", plain);
  assert.equal((await secrets.list(b)).length, 0);
  await assert.rejects(secrets.set(a, "bad name", "x"));

  // Criterion: a DB dump reveals no plain-text secret.
  // SQL dump (all tables, all rows): no dependency on
  // the pg_dump version.
  const tables = await sql<
    { t: string }[]
  >`select table_schema || '.' || table_name as t
    from information_schema.tables where table_type = 'BASE TABLE'
    and table_schema not in ('pg_catalog', 'information_schema')`;
  let dump = "";
  for (const { t } of tables)
    dump += (
      await sql.unsafe(
        `select coalesce(json_agg(x)::text, '') as d from ${t} x`,
      )
    )[0]!.d;
  assert.ok(dump.includes("API_KEY"));
  assert.ok(!dump.includes(plain));
  assert.ok(!dump.includes(viaSettings));

  await secrets.remove(a, "SLACK");
  assert.deepEqual(Object.keys(await decryptAll(a)), ["API_KEY"]);
});
