-- Hardening of the runbase_query role (migration 0001_roles_rls_views), replayed on each db:migrate
-- by a superuser: a migration run without superuser would have left only a
-- WARNING, and it would never be replayed.
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
END $$;
