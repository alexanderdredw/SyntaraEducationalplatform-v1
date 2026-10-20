-- Откат 0007_battle: таблицы Battle (5.9), функции RLS и перечисления.
DROP TABLE IF EXISTS "battle_answers";
--> statement-breakpoint
DROP TABLE IF EXISTS "battle_participants";
--> statement-breakpoint
DROP TABLE IF EXISTS "battle_sessions";
--> statement-breakpoint
DROP TABLE IF EXISTS "battle_options";
--> statement-breakpoint
DROP TABLE IF EXISTS "battle_questions";
--> statement-breakpoint
DROP TABLE IF EXISTS "battle_quizzes";
--> statement-breakpoint
DROP FUNCTION IF EXISTS battle_answer_visible(uuid, uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS battle_session_visible(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS battle_quiz_visible(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS app_user_context();
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."battle_session_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."battle_phase";
