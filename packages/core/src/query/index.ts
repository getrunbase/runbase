// User SQL queries. User SQL never runs on the
// owner connection: it goes through a dedicated pool (QUERY_DATABASE_URL) that
// connects with the runbase_query role (not owner, not superuser,
// member of no role, no privileges on tables). This role only reads the
// security_barrier views of the `query` schema (migration 0001_roles_rls_views), filtered
// on the workspace that the owner connection registered in query_sessions
// for the backend pid. Compatible with PgBouncer in transaction mode:
// everything happens in a single transaction (pid read, registered then removed before
// the end), the only moment the backend is guaranteed to us; a query that runs too long
// is canceled by SET LOCAL statement_timeout (QUERY_TIMEOUT_MS, 10 s by
// default), without cancellation by pid. Read-only transaction, row limit,
// rolled back at the end of the query. Exposed views:
//   records          : all records of the workspace (object = slug)
//   workflow_*       : workflow metrics
//   events           : workspace events (object = slug of the linked record)
//   "<object slug>"  : temporary view over records, one field per column (text)
import { appError } from "../errors/app-error";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { db, poolOptions } from "../db/client";
import { apiKeys, objects, querySessions, savedQueries } from "../db/schema";
import { withTenant, type TenantContext } from "../tenant";
import type { Field } from "../objects";
import { env } from "../env";
import { observePool } from "../telemetry";

export const MAX_ROWS = 1000;
const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
const SYSTEM_COLS = new Set(["id", "external_id", "created_at", "updated_at"]);
const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;

// Lazy pool; drizzle() aligns type parsing with `db`.
let pool: postgres.Sql | undefined;
function queryPool() {
  const url = env().QUERY_DATABASE_URL;
  // eslint-disable-next-line no-restricted-syntax -- deployment invariant
  if (!url) throw new Error("QUERY_DATABASE_URL missing");
  pool ??= drizzle(postgres(url, poolOptions(env().QUERY_PG_POOL_MAX))).$client;
  observePool("query", pool);
  return pool;
}

// Checks, on the query connection itself, that the hardening of migration
// 0001_roles_rls_views is effective (it requires a superuser and is otherwise only a
// warning): otherwise explicit refusal rather than an overly permissive role.
// Memoized once successful.
let hardened = false;
async function assertHardened(conn: postgres.ReservedSql) {
  if (hardened) return;
  const [row] = await conn<{ fns: string[]; activity: boolean }[]>`
    select coalesce(array_agg(p.proname::text order by p.proname), '{}') as fns,
      has_table_privilege('pg_catalog.pg_stat_activity', 'select') as activity
    from pg_proc p
    where (p.proname in ('pg_read_file', 'pg_read_binary_file', 'pg_ls_dir',
        'pg_stat_file', 'set_config', 'query_to_xml', 'pg_stat_get_activity')
      or left(p.proname, 3) = 'lo_' or left(p.proname, 6) = 'dblink')
      and has_function_privilege(p.oid, 'execute')`;
  if (row!.fns.length || row!.activity)
    throw appError(
      "query.roleNotRestricted",
      "SQL queries disabled: the runbase_query role is not restricted ({items}). " +
        "Run pnpm db:migrate again with a superuser account.",
      {
        items: [
          ...new Set(row!.fns),
          ...(row!.activity ? ["pg_stat_activity"] : []),
        ].join(", "),
      },
    );
  hardened = true;
}

// System columns keep their name; a field with the same name
// (e.g. external_id) is exposed as `data_<key>` to avoid the collision.
const fieldColumn = (key: string) =>
  SYSTEM_COLS.has(key) ? `data_${key}` : key;

// Views readable by query.sql: name, columns and types, without their
// SQL definition. System views of the `query` schema (identical for all
// workspaces, memoized), then one view per object (text columns).
export type SqlView = {
  name: string;
  columns: { name: string; type: string }[];
};
let systemViewsCache: Promise<SqlView[]> | undefined;
function systemViews() {
  systemViewsCache ??= db
    .execute<SqlView>(
      sql`select table_name as name,
        json_agg(json_build_object('name', column_name, 'type', data_type)
          order by ordinal_position) as columns
      from information_schema.columns where table_schema = 'query'
      group by table_name order by table_name`,
    )
    .then((r) => [...r])
    .catch((e) => {
      systemViewsCache = undefined;
      throw e;
    });
  return systemViewsCache;
}

type ObjectCols = { slug: string; fields: unknown };
async function sqlViews(objs: ObjectCols[]): Promise<SqlView[]> {
  const system = await systemViews();
  const text = (name: string) => ({ name, type: "text" });
  const ts = (name: string) => ({ name, type: "timestamp without time zone" });
  return [
    ...system,
    ...objs.map((o) => ({
      // Object with the same name as a system view: readable as pg_temp.<slug>.
      name: system.some((v) => v.name === o.slug)
        ? `pg_temp.${o.slug}`
        : o.slug,
      columns: [
        { name: "id", type: "uuid" },
        text("external_id"),
        ...(o.fields as Field[]).map((f) => text(fieldColumn(f.key))),
        ts("created_at"),
        ts("updated_at"),
      ],
    })),
  ];
}

const describeView = (v: SqlView) =>
  `${v.name}(${v.columns.map((c) => `${c.name} ${c.type}`).join(", ")})`;

// Enriched Postgres error (English): columns and types of the views cited by
// the query, cast advice for uuid = text. Only the names and types of the
// workspace views are cited, never their SQL.
async function sqlError(
  e: InstanceType<typeof postgres.PostgresError>,
  query: string,
  objs: ObjectCols[],
) {
  const views = await sqlViews(objs).catch(() => [] as SqlView[]);
  const words = new Set(
    (query.toLowerCase().match(/"[^"]+"|[a-z_][a-z0-9_.]*/g) ?? []).map((w) =>
      w.replaceAll('"', ""),
    ),
  );
  const cited = views.filter(
    (v) => words.has(v.name) || words.has(v.name.replace(/^pg_temp\./, "")),
  );
  const hints: string[] = [];
  if (e.code === "42883" && /\b(uuid = text|text = uuid)\b/.test(e.message))
    hints.push(
      "uuid and text cannot be compared directly: cast one side, e.g. record_id::text = 'value' or 'value'::uuid = record_id.",
    );
  if (e.code === "42703") hints.push("Unknown column: existing columns below.");
  if (cited.length)
    hints.push(...cited.map((v) => `Columns of ${describeView(v)}`));
  else hints.push(`Available views: ${views.map((v) => v.name).join(", ")}`);
  return appError("query.sqlError", "{message}\n{hint}", {
    message: e.message,
    hint: hints.join("\n"),
  });
}

// Result column names that appear more than once.
export function duplicateColumns(cols?: { name: string }[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const c of cols ?? []) (seen.has(c.name) ? dup : seen).add(c.name);
  return [...dup];
}

export const queryService = {
  // SQL views of the workspace (workspace.describe).
  views: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    const objs = await withTenant(ctx, (tx) =>
      tx
        .select({ slug: objects.slug, fields: objects.fields })
        .from(objects)
        .where(eq(objects.workspaceId, ctx.workspaceId)),
    );
    return sqlViews(objs);
  },
  sql: async (ctx: TenantContext, query: string, params: unknown[] = []) => {
    await requireScope(ctx, "read");
    // Key limited to some objects: the query views cover the whole workspace.
    if ("apiKeyId" in ctx.actor) {
      const keyId = ctx.actor.apiKeyId;
      const [k] = await db
        .select({ objects: apiKeys.objects })
        .from(apiKeys)
        .where(eq(apiKeys.id, keyId));
      if (k?.objects)
        throw appError(
          "query.restrictedKey",
          "query.sql is unavailable for a key limited to some objects",
        );
    }
    const q = query.trim().replace(/;+\s*$/, "");
    // Access checked and objects read under RLS (app_tenant).
    const objs = await withTenant(ctx, (tx) =>
      tx
        .select({ slug: objects.slug, fields: objects.fields })
        .from(objects)
        .where(eq(objects.workspaceId, ctx.workspaceId)),
    );
    const views = objs.map((o) => {
      const cols = (o.fields as Field[])
        .map((f) => `, data->>${lit(f.key)} as ${ident(fieldColumn(f.key))}`)
        .join("");
      return `create temp view ${ident(o.slug)} as select id, external_id${cols},
        created_at, updated_at from query.records where object = ${lit(o.slug)}`;
    });
    const timeoutMs = env().QUERY_TIMEOUT_MS;
    const conn = await queryPool().reserve();
    try {
      await conn.unsafe("begin");
      let pid: number | undefined;
      try {
        // Read inside the transaction: behind PgBouncer (transaction mode), the
        // backend is reserved only between begin and rollback.
        const [row] = await conn<
          { pid: number }[]
        >`select pg_backend_pid() as pid`;
        pid = row!.pid;
        await assertHardened(conn);
        await db
          .insert(querySessions)
          .values({ pid, workspaceId: ctx.workspaceId })
          .onConflictDoUpdate({
            target: querySessions.pid,
            set: { workspaceId: ctx.workspaceId },
          });
        await conn.unsafe(`set local statement_timeout = ${timeoutMs}`);
        // query before pg_temp: an object named like a system view (e.g.
        // `records`) does not hide it; it stays readable as pg_temp.<slug>.
        await conn.unsafe("set local search_path = query, pg_temp");
        for (const v of views) await conn.unsafe(v);
        await conn.unsafe("set transaction read only");
        // Extended protocol: a single statement (no `; commit; ...`).
        const list = (await conn
          .unsafe(
            `select * from (${q}) as q limit ${MAX_ROWS + 1}`,
            params as never[],
            { simple: false },
          )
          .catch(async (e: unknown) => {
            throw e instanceof postgres.PostgresError
              ? await sqlError(e, q, objs)
              : e;
          })) as Record<string, unknown>[] & { columns?: { name: string }[] };
        // Two result columns with the same name (count(*) twice, a.id and
        // b.id): JS rows keep only the last one. Refused, with the names.
        const dup = duplicateColumns(list.columns);
        if (dup.length)
          throw appError(
            "query.duplicateColumns",
            "Duplicate result column names: {columns}. Give each column a unique alias (e.g. count(*) as total, a.id as a_id).",
            { columns: dup.join(", ") },
            { kind: "invalid_input" },
          );
        return {
          rows: [...list].slice(0, MAX_ROWS),
          truncated: list.length > MAX_ROWS,
        };
      } finally {
        // Session removed before the end of the transaction: afterwards, PgBouncer
        // can hand this backend (same pid) to another query.
        try {
          if (pid !== undefined)
            await db.delete(querySessions).where(eq(querySessions.pid, pid));
        } finally {
          // Rolled back: temporary views and settings disappear.
          await conn.unsafe("rollback");
        }
      }
    } finally {
      conn.release();
    }
  }, // Saved and named queries.
  saved: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) =>
      tx
        .select({ name: savedQueries.name, sql: savedQueries.sql })
        .from(savedQueries)
        .where(eq(savedQueries.workspaceId, ctx.workspaceId))
        .orderBy(savedQueries.name),
    );
  },
  save: async (ctx: TenantContext, name: string, query: string) => {
    await requireScope(ctx, "write");
    const v = {
      name: z.string().trim().min(1).parse(name),
      sql: z.string().trim().min(1).parse(query),
    };
    await withTenant(ctx, async (tx) => {
      await tx
        .insert(savedQueries)
        .values({
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          ...v,
        })
        .onConflictDoUpdate({
          target: [savedQueries.workspaceId, savedQueries.name],
          set: { sql: v.sql, updatedAt: new Date() },
        });
      await audit(tx, ctx, "query.save", { type: "query", id: v.name }, v);
    });
  },
  remove: async (ctx: TenantContext, name: string) => {
    await requireScope(ctx, "write");
    await withTenant(ctx, async (tx) => {
      await tx
        .delete(savedQueries)
        .where(
          and(
            eq(savedQueries.workspaceId, ctx.workspaceId),
            eq(savedQueries.name, name),
          ),
        );
      await audit(tx, ctx, "query.remove", { type: "query", id: name });
    });
  },
};
