-- Откат 0012_opt_indexes (OPT-05, О4-6): удаляются только добавленные индексы; данные не затрагиваются.
DROP INDEX IF EXISTS "ix_auth_sessions_user";
DROP INDEX IF EXISTS "ix_classes_teacher";
DROP INDEX IF EXISTS "ix_topic_sections_topic";
DROP INDEX IF EXISTS "ix_assignments_topic";
DROP INDEX IF EXISTS "ix_questions_quiz";
DROP INDEX IF EXISTS "ix_submissions_student";
DROP INDEX IF EXISTS "ix_notifications_user";
DROP INDEX IF EXISTS "ix_outbox_pending";
