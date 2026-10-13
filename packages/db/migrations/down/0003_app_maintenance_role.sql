-- Откат 0003_app_maintenance_role.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_maintenance;
REVOKE USAGE ON SCHEMA public FROM app_maintenance;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_maintenance') THEN
    BEGIN
      DROP ROLE app_maintenance;
    EXCEPTION WHEN dependent_objects_still_exist THEN
      RAISE NOTICE 'role app_maintenance is still used by another database, kept';
    END;
  END IF;
END
$$;
