// Integration test: query.sql behind PgBouncer in transaction
// mode. Requires DATABASE_URL, QUERY_DATABASE_URL and Docker (ephemeral PgBouncer
// container); skipped without Docker.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const docker = (...args: string[]) =>
  execFileSync("docker", args, { encoding: "utf8" }).trim();
let hasDocker = true;
try {
  docker("version", "--format", "{{.Server.Version}}");
} catch {
  hasDocker = false;
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

let container = "";
let mod: typeof import("./index");
let sql: import("postgres").Sql;

before(async () => {
  if (!hasDocker) return;
  const owner = new URL(process.env.DATABASE_URL!);
  const query = new URL(process.env.QUERY_DATABASE_URL!);
  const dbName = owner.pathname.slice(1);
  const dir = mkdtempSync(join(tmpdir(), "pgbouncer-"));
  // Deliberately small server pool: several transactions share
  // the same backend, and no named prepared statement is relayed.
  writeFileSync(
    join(dir, "pgbouncer.ini"),
    `[databases]
* = host=host.docker.internal port=${owner.port || 5432}
[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 5432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
default_pool_size = 2
max_prepared_statements = 0
ignore_startup_parameters = extra_float_digits,options
`,
  );
  const u = (x: URL) =>
    `"${decodeURIComponent(x.username)}" "${decodeURIComponent(x.password)}"`;
  writeFileSync(join(dir, "userlist.txt"), `${u(owner)}\n${u(query)}\n`);
  // The image runs as a non-root user: on Linux, mkdtemp's 0700 directory
  // is unreadable from the container and PgBouncer exits at startup.
  chmodSync(dir, 0o755);
  chmodSync(join(dir, "pgbouncer.ini"), 0o644);
  chmodSync(join(dir, "userlist.txt"), 0o644);
  const port = await freePort();
  container = docker(
    "run", "-d", "--rm",
    "--add-host", "host.docker.internal:host-gateway",
    "-p", `127.0.0.1:${port}:5432`,
    "-v", `${dir}:/etc/pgbouncer:ro`,
    "edoburu/pgbouncer:latest",
  );
  const via = (x: URL) => {
    const v = new URL(x);
    v.hostname = "127.0.0.1";
    v.port = String(port);
    v.pathname = `/${dbName}`;
    return v.toString();
  };
  process.env.DATABASE_URL = via(owner);
  process.env.QUERY_DATABASE_URL = via(query);
  process.env.PG_PREPARE = "false";
  process.env.QUERY_PG_POOL_MAX = "6";
  process.env.QUERY_TIMEOUT_MS = "500";
  const postgres = (await import("postgres")).default;
  sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  // Wait for PgBouncer to start.
  for (let i = 0; ; i++) {
    try {
      await sql`select 1`;
      break;
    } catch (e) {
      if (i > 50) throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  mod = await import("./index");
});

after(() => {
  if (container) docker("rm", "-f", container);
  setImmediate(() => process.exit(0));
});

async function seeded(name: string) {
  const { objectsService } = await import("../objects");
  const { recordsService } = await import("../records");
  const [org] =
    await sql`insert into organizations (name) values (${name}) returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, ${name}, ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const ctx = {
    organizationId: org!.id as string,
    workspaceId: ws!.id as string,
    actor: { userId: uid },
  };
  const obj = await objectsService.create(ctx, {
    slug: "contacts",
    name: "Contacts",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  await recordsService.upsert(ctx, {
    objectId: obj.id,
    externalId: "1",
    data: { name },
  });
  return ctx;
}

test("query.sql behind PgBouncer transaction mode: results and isolation", {
  skip: !hasDocker && "Docker unavailable",
}, async () => {
  const a = await seeded("BA");
  const b = await seeded("BB");
  // Concurrent queries over 2 shared backends: each workspace only sees
  // its rows, whatever backend it gets.
  const runs = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      mod.queryService.sql(i % 2 ? b : a, "select name from contacts"),
    ),
  );
  runs.forEach((r, i) =>
    assert.deepEqual(r.rows, [{ name: i % 2 ? "BB" : "BA" }]),
  );
  // Parameters (extended protocol, unprepared query).
  const p = await mod.queryService.sql(
    a,
    "select name from contacts where name = $1",
    ["BA"],
  );
  assert.deepEqual(p.rows, [{ name: "BA" }]);
  // No session left behind.
  const [left] = await sql`select count(*)::int as n from query_sessions
    where workspace_id in (${a.workspaceId}, ${b.workspaceId})`;
  assert.equal(left!.n, 0);
});

test("query.sql behind PgBouncer: slow query canceled by statement_timeout", {
  skip: !hasDocker && "Docker unavailable",
}, async () => {
  const a = await seeded("BT");
  await assert.rejects(
    mod.queryService.sql(a, "select pg_sleep(5)"),
    /statement timeout/,
  );
  // The backend is returned healthy: the next query goes through.
  const ok = await mod.queryService.sql(a, "select name from contacts");
  assert.deepEqual(ok.rows, [{ name: "BT" }]);
});
