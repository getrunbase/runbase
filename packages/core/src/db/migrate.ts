// Applies the ./drizzle migrations. Run by `pnpm db:migrate` and at startup in production.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../env";

const url = env().DATABASE_URL;
// eslint-disable-next-line no-restricted-syntax -- deployment invariant
if (!url) throw new Error("DATABASE_URL missing");

const sql = postgres(url, { max: 1 });
await migrate(drizzle(sql), {
  migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
});
// Index outside a transaction: CONCURRENTLY is not allowed in the
// migrate() transaction. An interrupted build leaves an invalid index:
// dropped then rebuilt.
const indexes: [string, string][] = [
  [
    "records_ws_obj_created_idx",
    "records (workspace_id, object_id, created_at)",
  ],
];
for (const [name, def] of indexes) {
  const [idx] = await sql<{ valid: boolean }[]>`
    select i.indisvalid as valid from pg_class c join pg_index i on i.indexrelid = c.oid
    where c.relname = ${name}`;
  if (idx && !idx.valid) await sql.unsafe(`drop index concurrently ${name}`);
  if (!idx?.valid)
    await sql.unsafe(
      `create index concurrently if not exists ${name} on ${def}`,
    );
}
// Role of user SQL queries (0001_roles_rls_views): LOGIN and
// password taken from QUERY_DATABASE_URL (user runbase_query).
const queryUrl = env().QUERY_DATABASE_URL;
if (queryUrl) {
  const u = new URL(queryUrl);
  if (u.username !== "runbase_query")
    // eslint-disable-next-line no-restricted-syntax -- deployment invariant
    throw new Error("QUERY_DATABASE_URL must use the runbase_query user");
  const pw = decodeURIComponent(u.password).replaceAll("'", "''");
  await sql.unsafe(`alter role runbase_query login password '${pw}'`);
}
// Hardening of the query role: replayed if superuser, otherwise db:migrate fails
// as long as the role is not restricted (instead of a forgotten WARNING).
const [suRow] = await sql<{ su: boolean }[]>`
  select rolsuper as su from pg_roles where rolname = current_user`;
if (suRow!.su)
  await sql.file(new URL("./harden-query.sql", import.meta.url).pathname);
const [openRow] = await sql<{ open: string[] }[]>`
  select coalesce(array_agg(distinct p.proname::text), '{}') as open from pg_proc p
  where (p.proname in ('pg_read_file', 'set_config', 'query_to_xml', 'pg_stat_get_activity')
    or p.proname like 'lo\\_%' or p.proname like 'dblink%')
    and has_function_privilege('runbase_query', p.oid, 'execute')`;
const open = openRow!.open;
if (open.length) {
  await sql.end();
  // eslint-disable-next-line no-restricted-syntax -- deployment invariant
  throw new Error(
    `runbase_query role not restricted (${open.join(", ")}): run pnpm db:migrate again with a superuser account.`,
  );
}
await sql.end();
console.log("Migrations applied");
