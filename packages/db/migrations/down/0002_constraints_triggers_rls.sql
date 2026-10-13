-- Откат 0002_constraints_triggers_rls.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM analytics_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE ON TABLES FROM app_user;
DROP POLICY IF EXISTS audit_log_read ON audit_log;
DROP POLICY IF EXISTS user_roles_read ON user_roles;
DROP POLICY IF EXISTS classes_read ON classes;
DROP POLICY IF EXISTS audit_log_school ON audit_log;
DROP POLICY IF EXISTS user_roles_school ON user_roles;
DROP POLICY IF EXISTS classes_school ON classes;
DROP FUNCTION IF EXISTS app_school_visible(uuid);
ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE classes DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM analytics_ro, app_user;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_user;
REVOKE CREATE ON SCHEMA public FROM migrator;
REVOKE USAGE ON SCHEMA public FROM app_user, analytics_ro, migrator;
DROP TRIGGER IF EXISTS trg_assignments_topic ON assignments;
DROP FUNCTION IF EXISTS check_assignment_topic();
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tgname, tgrelid::regclass AS tbl FROM pg_trigger WHERE tgname LIKE 'trg\_%\_updated\_at' LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.tbl);
  END LOOP;
END
$$;
DROP FUNCTION IF EXISTS set_updated_at();
ALTER TABLE topics DROP CONSTRAINT IF EXISTS topics_subject_position_key;
