-- Откат 0016_atlas_module (REQ-ATL-01, REQ-ATL-03): сессии квиза атласа, событие atlas_quiz_finished, subjects.module.
-- События atlas_quiz_finished и их XP удаляются: прежнее ограничение типа события их не допускает.
DROP TABLE IF EXISTS "atlas_quiz_sessions";
DELETE FROM "xp_ledger" WHERE "source_event_id" IN (SELECT "id" FROM "learning_events" WHERE "type" = 'atlas_quiz_finished');
UPDATE "student_badges" SET "source_event_id" = NULL WHERE "source_event_id" IN (SELECT "id" FROM "learning_events" WHERE "type" = 'atlas_quiz_finished');
DELETE FROM "learning_events" WHERE "type" = 'atlas_quiz_finished';
ALTER TABLE "learning_events" DROP CONSTRAINT IF EXISTS "learning_events_type";
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_type" CHECK ("learning_events"."type" IN ('lesson_opened','quiz_finished','topic_mastered','ai_question'));
ALTER TABLE "subjects" DROP CONSTRAINT IF EXISTS "subjects_module";
ALTER TABLE "subjects" DROP COLUMN IF EXISTS "module";
