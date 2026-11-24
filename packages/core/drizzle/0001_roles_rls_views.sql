-- Hand-written SQL that drizzle-kit generate does not produce: roles,
-- functions and triggers, the `query` schema (views read by runbase_query), RLS and
-- policies, grants. Consolidated final state of the former migrations 0000-0059
-- (clean cut), not their history.

-- Roles (cluster-wide, hence the idempotent blocks).
-- app_tenant: role taken by withTenant (SET LOCAL ROLE), subject to RLS.
DO $$ BEGIN CREATE ROLE app_tenant NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
GRANT app_tenant TO CURRENT_USER;--> statement-breakpoint
-- readonly: former role of user SQL queries, with no privileges at all.
DO $$ BEGIN CREATE ROLE readonly NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
GRANT readonly TO CURRENT_USER;--> statement-breakpoint
-- runbase_query: connection used by user SQL queries. Neither owner nor
-- superuser, member of no role. LOGIN and password are set by
-- `pnpm db:migrate` from QUERY_DATABASE_URL (see src/db/migrate.ts).
DO $$ BEGIN CREATE ROLE runbase_query NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER ROLE runbase_query SET search_path = query;--> statement-breakpoint

-- Record count per workspace, maintained by statement-level
-- triggers (transition tables): inserts and deletes, cascades
-- and purges included. SECURITY DEFINER: writes outside RLS, whatever the role.
CREATE FUNCTION records_usage_ins() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO workspace_usage (workspace_id, organization_id, records)
    SELECT workspace_id, organization_id, count(*) FROM new_rows GROUP BY 1, 2
  ON CONFLICT (workspace_id) DO UPDATE SET records = workspace_usage.records + excluded.records;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION records_usage_del() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE workspace_usage u SET records = greatest(u.records - d.n, 0)
    FROM (SELECT workspace_id, count(*) AS n FROM old_rows GROUP BY 1) d
    WHERE u.workspace_id = d.workspace_id;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER records_usage_ins AFTER INSERT ON records REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION records_usage_ins();--> statement-breakpoint
CREATE TRIGGER records_usage_del AFTER DELETE ON records REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION records_usage_del();--> statement-breakpoint

-- query_sessions: workspace of each query connection, indexed by pid.
-- Written only by the owner connection: runbase_query has no privileges on it.
REVOKE ALL ON "query_sessions" FROM PUBLIC;--> statement-breakpoint
-- Views read by runbase_query. Owner: the migration role, so they
-- read tables runbase_query has no rights on. The workspace filter comes from
-- query_sessions for pg_backend_pid() (bound at creation, cannot be overridden),
-- security_barrier prevents leaking rows through a function.
CREATE SCHEMA IF NOT EXISTS query;--> statement-breakpoint
CREATE VIEW query.records WITH (security_barrier) AS
  SELECT r.id, o.slug AS object, r.external_id, r.data, r.created_at, r.updated_at
  FROM public.records r JOIN public.objects o ON o.id = r.object_id
  WHERE r.workspace_id = (SELECT workspace_id FROM public.query_sessions WHERE pid = pg_backend_pid());--> statement-breakpoint
CREATE VIEW query.events WITH (security_barrier) AS
  SELECT e.id, e.type, e.record_id, o.slug AS object, e.payload, e.source,
    e.occurred_at, e.created_at
  FROM public.events e
    LEFT JOIN public.records r ON r.id = e.record_id
    LEFT JOIN public.objects o ON o.id = r.object_id
  WHERE e.workspace_id = (SELECT workspace_id FROM public.query_sessions WHERE pid = pg_backend_pid());--> statement-breakpoint
CREATE VIEW query.workflow_runs_per_day WITH (security_barrier) AS
  SELECT w.name AS workflow, r.created_at::date AS day, count(*)::int AS runs
  FROM public.workflow_runs r JOIN public.workflows w ON w.id = r.workflow_id
  WHERE r.workspace_id = (SELECT workspace_id FROM public.query_sessions WHERE pid = pg_backend_pid())
  GROUP BY 1, 2;--> statement-breakpoint
CREATE VIEW query.workflow_error_rate WITH (security_barrier) AS
  SELECT w.name AS workflow, count(*)::int AS runs,
    count(*) FILTER (WHERE r.status = 'failed')::int AS failed,
    round(avg((r.status = 'failed')::int), 4)::float AS error_rate
  FROM public.workflow_runs r JOIN public.workflows w ON w.id = r.workflow_id
  WHERE r.workspace_id = (SELECT workspace_id FROM public.query_sessions WHERE pid = pg_backend_pid())
  GROUP BY 1;--> statement-breakpoint
CREATE VIEW query.workflow_branch_rate WITH (security_barrier) AS
  SELECT w.name AS workflow, s.step_id, s.branch, count(*)::int AS n,
    round(count(*)::numeric / sum(count(*)) OVER (PARTITION BY w.name, s.step_id), 4)::float AS rate
  FROM public.run_steps s JOIN public.workflow_runs r ON s.run_id = r.id
    JOIN public.workflows w ON w.id = r.workflow_id
  WHERE r.workspace_id = (SELECT workspace_id FROM public.query_sessions WHERE pid = pg_backend_pid())
    AND s.branch IS NOT NULL
  GROUP BY 1, 2, 3;--> statement-breakpoint
CREATE VIEW query.workflow_cost_monthly WITH (security_barrier) AS
  SELECT w.name AS workflow, to_char(s.created_at, 'YYYY-MM') AS month, sum(s.cost)::float AS cost_usd
  FROM public.run_steps s JOIN public.workflow_runs r ON s.run_id = r.id
    JOIN public.workflows w ON w.id = r.workflow_id
  WHERE r.workspace_id = (SELECT workspace_id FROM public.query_sessions WHERE pid = pg_backend_pid())
    AND s.cost IS NOT NULL
  GROUP BY 1, 2;--> statement-breakpoint
GRANT USAGE ON SCHEMA query TO runbase_query;--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA query TO runbase_query;--> statement-breakpoint

-- app_tenant privileges on business tables (auth and
-- platform tables stay reserved to the owner connection).
GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys, databases, deleted_records, errors, events,
  function_logs, idempotency_keys, memberships, object_views, objects, organizations, page_errors,
  pages, record_keys, records, run_outbox, run_steps, saved_queries, secrets, webhooks,
  workflow_runs, workflows, workspaces TO app_tenant;--> statement-breakpoint
-- Versions and functions: never modified, only added or deleted.
GRANT SELECT, INSERT, DELETE ON functions, page_versions, workflow_versions TO app_tenant;--> statement-breakpoint
-- Counter reads and locks (UPDATE … RETURNING); workspace keys never deleted.
GRANT SELECT, INSERT, UPDATE ON workspace_keys, workspace_usage TO app_tenant;--> statement-breakpoint
-- Audit log: append-only.
GRANT SELECT, INSERT ON audit_log TO app_tenant;--> statement-breakpoint
GRANT INSERT ON feedback TO app_tenant;--> statement-breakpoint

-- RLS.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['api_keys', 'audit_log', 'databases', 'deleted_records',
    'errors', 'events', 'feedback', 'function_logs', 'functions', 'idempotency_keys', 'memberships',
    'object_views', 'objects', 'organizations', 'page_errors', 'page_versions', 'pages',
    'record_keys', 'records', 'run_outbox', 'run_steps', 'saved_queries', 'secrets', 'webhooks',
    'workflow_runs', 'workflow_versions', 'workflows', 'workspace_keys', 'workspace_usage', 'workspaces']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;

  -- Isolation by organization (app.org_id, set by withTenant).
  FOREACH t IN ARRAY ARRAY['api_keys', 'audit_log', 'databases', 'deleted_records', 'errors', 'events',
    'function_logs', 'functions', 'idempotency_keys', 'memberships', 'object_views', 'objects',
    'page_errors', 'page_versions', 'pages', 'record_keys', 'records', 'run_outbox', 'run_steps',
    'saved_queries', 'secrets', 'webhooks', 'workflow_runs', 'workflow_versions', 'workflows',
    'workspace_keys', 'workspace_usage', 'workspaces']
  LOOP
    EXECUTE format($f$CREATE POLICY tenant_isolation ON %I TO app_tenant
      USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
      WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)$f$, t);
  END LOOP;

  -- API key limited to its workspaces (app.ws_ids, empty = unlimited) and
  -- isolation per workspace (app.workspace_id, empty = the whole organization).
  FOREACH t IN ARRAY ARRAY['audit_log', 'databases', 'deleted_records', 'errors', 'events', 'feedback',
    'function_logs', 'functions', 'idempotency_keys', 'object_views', 'objects', 'pages', 'records',
    'run_outbox', 'saved_queries', 'secrets', 'webhooks', 'workflow_runs', 'workflows',
    'workspace_keys', 'workspace_usage']
  LOOP
    EXECUTE format($f$CREATE POLICY key_workspaces ON %I AS RESTRICTIVE TO app_tenant
      USING (coalesce(current_setting('app.ws_ids', true), '') = ''
        OR workspace_id = ANY (string_to_array(current_setting('app.ws_ids', true), ',')::uuid[]))
      WITH CHECK (coalesce(current_setting('app.ws_ids', true), '') = ''
        OR workspace_id = ANY (string_to_array(current_setting('app.ws_ids', true), ',')::uuid[]))$f$, t);
    EXECUTE format($f$CREATE POLICY workspace_isolation ON %I AS RESTRICTIVE TO app_tenant
      USING (coalesce(current_setting('app.workspace_id', true), '') = ''
        OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (coalesce(current_setting('app.workspace_id', true), '') = ''
        OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$f$, t);
  END LOOP;

  -- API key limited to its objects (app.objects: slugs, empty = unlimited).
  FOREACH t IN ARRAY ARRAY['deleted_records', 'object_views', 'record_keys', 'records']
  LOOP
    EXECUTE format($f$CREATE POLICY key_objects ON %I AS RESTRICTIVE TO app_tenant
      USING (coalesce(current_setting('app.objects', true), '') = ''
        OR object_id IN (SELECT id FROM objects))
      WITH CHECK (coalesce(current_setting('app.objects', true), '') = ''
        OR object_id IN (SELECT id FROM objects))$f$, t);
  END LOOP;
END $$;--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations TO app_tenant
  USING (id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY key_workspaces ON workspaces AS RESTRICTIVE TO app_tenant
  USING (coalesce(current_setting('app.ws_ids', true), '') = ''
    OR id = ANY (string_to_array(current_setting('app.ws_ids', true), ',')::uuid[]))
  WITH CHECK (coalesce(current_setting('app.ws_ids', true), '') = ''
    OR id = ANY (string_to_array(current_setting('app.ws_ids', true), ',')::uuid[]));--> statement-breakpoint
CREATE POLICY key_objects ON objects AS RESTRICTIVE TO app_tenant
  USING (coalesce(current_setting('app.objects', true), '') = ''
    OR slug = ANY (string_to_array(current_setting('app.objects', true), ',')))
  WITH CHECK (coalesce(current_setting('app.objects', true), '') = ''
    OR slug = ANY (string_to_array(current_setting('app.objects', true), ',')));--> statement-breakpoint
-- Feedback: write-only for app_tenant.
CREATE POLICY tenant_insert ON feedback FOR INSERT TO app_tenant
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

-- Defense in depth: exfiltration or server-access functions revoked
-- from PUBLIC, set_config reserved to the owner and app_tenant (withTenant),
-- pg_stat_activity reserved to the owner. Requires a superuser (pg_catalog):
-- otherwise just a warning, and src/db/harden-query.sql replays it.
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
    WHERE p.pronamespace = 'pg_catalog'::regnamespace AND (
      p.proname IN ('query_to_xml', 'table_to_xml', 'cursor_to_xml', 'query_to_xml_and_xmlschema',
        'table_to_xml_and_xmlschema', 'cursor_to_xmlschema', 'query_to_xmlschema', 'table_to_xmlschema',
        'schema_to_xml', 'schema_to_xmlschema', 'schema_to_xml_and_xmlschema',
        'database_to_xml', 'database_to_xmlschema', 'database_to_xml_and_xmlschema',
        'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file', 'set_config')
      OR p.proname LIKE 'lo\_%' OR p.proname LIKE 'dblink%')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO app_tenant, %I', current_user);
  REVOKE SELECT ON pg_catalog.pg_stat_activity FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION pg_catalog.pg_stat_get_activity(integer) FROM PUBLIC;
  EXECUTE format('GRANT SELECT ON pg_catalog.pg_stat_activity TO %I', current_user);
  EXECUTE format('GRANT EXECUTE ON FUNCTION pg_catalog.pg_stat_get_activity(integer) TO %I', current_user);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'pg_catalog hardening skipped (superuser required)';
END $$;
