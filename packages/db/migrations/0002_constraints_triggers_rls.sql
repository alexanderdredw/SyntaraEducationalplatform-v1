-- Ограничения и объекты, которые drizzle-kit не выражает (раздел 5 SPEC).

-- 5.4: UNIQUE (subject_id, position) DEFERRABLE INITIALLY DEFERRED — перестановка тем в одной транзакции.
ALTER TABLE topics ADD CONSTRAINT topics_subject_position_key
  UNIQUE (subject_id, position) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

-- 5.1: updated_at обновляется при каждом UPDATE.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- 5.5: тема задания принадлежит предмету задания (BR-ASG-01).
CREATE FUNCTION check_assignment_topic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM topics WHERE id = NEW.topic_id AND subject_id = NEW.subject_id) THEN
    RAISE EXCEPTION 'assignment topic % does not belong to subject %', NEW.topic_id, NEW.subject_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'check_assignment_topic';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_assignments_topic BEFORE INSERT OR UPDATE OF topic_id, subject_id ON assignments
  FOR EACH ROW EXECUTE FUNCTION check_assignment_topic();
--> statement-breakpoint

-- 5.8: права ролей.
-- app_user: SELECT/INSERT/UPDATE на рабочие таблицы; только INSERT в audit_log; без DDL и без DELETE.
GRANT USAGE ON SCHEMA public TO app_user, analytics_ro, migrator;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
--> statement-breakpoint
REVOKE SELECT, UPDATE, DELETE ON audit_log FROM app_user;
--> statement-breakpoint
-- migrator: DDL (используется только CI при миграции).
GRANT CREATE ON SCHEMA public TO migrator;
--> statement-breakpoint
-- analytics_ro: только чтение.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_ro;
--> statement-breakpoint

-- 5.1: RLS для таблиц со school_id — второй уровень защиты (SHOULD).
-- Контекст школы задаётся в транзакции: SET LOCAL app.school_id = '<uuid>'. Без контекста — без ограничения
-- по школе (основная защита — guards и проверки в сервисах, BR-ACL-*). Строки без школы видны всем.
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION app_school_visible(row_school uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.school_id', true), '') = ''
      OR row_school IS NULL
      OR row_school = current_setting('app.school_id', true)::uuid
$$;
--> statement-breakpoint
CREATE POLICY classes_school ON classes TO app_user
  USING (app_school_visible(school_id)) WITH CHECK (app_school_visible(school_id));
--> statement-breakpoint
CREATE POLICY user_roles_school ON user_roles TO app_user
  USING (app_school_visible(school_id)) WITH CHECK (app_school_visible(school_id));
--> statement-breakpoint
CREATE POLICY audit_log_school ON audit_log FOR INSERT TO app_user
  WITH CHECK (app_school_visible(school_id));
--> statement-breakpoint
CREATE POLICY classes_read ON classes FOR SELECT TO analytics_ro USING (true);
--> statement-breakpoint
CREATE POLICY user_roles_read ON user_roles FOR SELECT TO analytics_ro USING (true);
--> statement-breakpoint
CREATE POLICY audit_log_read ON audit_log FOR SELECT TO analytics_ro USING (true);
--> statement-breakpoint
-- Таблицы из будущих миграций получают те же права автоматически.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO app_user;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO analytics_ro;
