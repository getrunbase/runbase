# User SQL queries

`queryService.sql` runs the SQL entered in the console. It never goes through the owner connection.

## Isolation

- **Dedicated connection**: `QUERY_DATABASE_URL` pool, `runbase_query` user.
  This role is not an owner, not a superuser and not a member of another role:
  `session_user` is `runbase_query`, so `SET ROLE`, `RESET ROLE`,
  `set_config('role', ...)` or `SET SESSION AUTHORIZATION` cannot escape it.
  It has no privilege on the `public` tables.
- **Views of the `query` schema** (migration `0001_roles_rls_views`): `records` and the
  `workflow_*` metrics. They belong to the migration role and are
  `security_barrier`. Their workspace filter reads `query_sessions` for
  `pg_backend_pid()`: the owner connection writes the caller's workspace there
  for the pid of the reserved query connection, then clears it.
  `runbase_query` has no privilege on `query_sessions` and can neither change
  pid nor override the function (bound when the view is created).
- **Per-object views** (`"<slug>"`): temporary views created in the transaction,
  on the query connection, on top of `query.records`.
- **Transaction**: `read only`, `statement_timeout` 10 s, `MAX_ROWS` rows,
  rolled back at the end of the query. Extended protocol: a single statement.

## Defense in depth

The migration revokes `EXECUTE` from `PUBLIC` on `set_config` (granted back to `app_tenant`
and the migration role), the `*_to_xml*`, `lo_*` and `dblink*` functions,
`pg_read_file`, `pg_read_binary_file`, `pg_ls_dir` and `pg_stat_file`. These
`REVOKE`s require a superuser: otherwise the migration emits a warning and
isolation relies on the dedicated role and the views.

## Configuration

1. Set `QUERY_DATABASE_URL` (and `QUERY_DB_PASSWORD` for docker-compose).
2. Run `pnpm db:migrate`: the migration creates `runbase_query` as `NOLOGIN`,
   then the script grants it `LOGIN` and the password from the URL.
