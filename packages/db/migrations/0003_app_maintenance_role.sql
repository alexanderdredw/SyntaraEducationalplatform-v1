-- 5.8: роль app_maintenance — только для фоновых задач worker (очистка по срокам PH-18, удаление файлов BR-FILE-03).
-- SELECT нужен для условий отбора, DELETE — для удаления. INSERT/UPDATE и DDL не выдаются; audit_log недоступен.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_maintenance') THEN
    CREATE ROLE app_maintenance NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_maintenance;
--> statement-breakpoint
GRANT SELECT, DELETE ON
  support_tickets, ticket_messages, ticket_status_history, ticket_reply_tokens, school_requests,
  ai_conversations, ai_messages,
  media_files, topic_materials,
  idempotency_keys, outbox_events, email_queue, auth_sessions
TO app_maintenance;
--> statement-breakpoint
-- Для каскадного отбора (например, файлы, на которые ещё ссылаются темы) — только чтение связанных таблиц.
GRANT SELECT ON topics, topic_sections, badges, users TO app_maintenance;
