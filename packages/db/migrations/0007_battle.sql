CREATE TYPE "public"."battle_phase" AS ENUM('lobby', 'question', 'reveal', 'leaderboard', 'finished');--> statement-breakpoint
CREATE TYPE "public"."battle_session_status" AS ENUM('lobby', 'in_progress', 'finished', 'cancelled');--> statement-breakpoint
CREATE TABLE "battle_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"question_index" integer NOT NULL,
	"option_position" integer NOT NULL,
	"is_correct" boolean NOT NULL,
	"response_ms" integer NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	"client_answer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_answers_participant_question" UNIQUE("participant_id","question_index"),
	CONSTRAINT "battle_answers_participant_client" UNIQUE("participant_id","client_answer_id"),
	CONSTRAINT "battle_answers_question_index" CHECK ("battle_answers"."question_index" >= 0),
	CONSTRAINT "battle_answers_option_position" CHECK ("battle_answers"."option_position" BETWEEN 1 AND 4),
	CONSTRAINT "battle_answers_response_ms" CHECK ("battle_answers"."response_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "battle_options" (
	"id" uuid PRIMARY KEY NOT NULL,
	"battle_question_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_options_question_position" UNIQUE("battle_question_id","position"),
	CONSTRAINT "battle_options_position" CHECK ("battle_options"."position" BETWEEN 1 AND 4),
	CONSTRAINT "battle_options_text_len" CHECK (length("battle_options"."text") BETWEEN 1 AND 150)
);
--> statement-breakpoint
CREATE TABLE "battle_participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"kicked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correct_count" integer,
	"answered_count" integer,
	"correct_time_ms" integer,
	"final_rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_participants_session_student" UNIQUE("session_id","student_id"),
	CONSTRAINT "battle_participants_name_len" CHECK (length("battle_participants"."display_name") <= 80)
);
--> statement-breakpoint
CREATE TABLE "battle_questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"battle_quiz_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" "question_type" NOT NULL,
	"text" text NOT NULL,
	"image_media_id" uuid,
	"time_limit_sec" integer DEFAULT 20 NOT NULL,
	"source_question_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_questions_type" CHECK ("battle_questions"."type" IN ('single_choice', 'true_false')),
	CONSTRAINT "battle_questions_text_len" CHECK (length("battle_questions"."text") BETWEEN 1 AND 300),
	CONSTRAINT "battle_questions_time_limit" CHECK ("battle_questions"."time_limit_sec" IN (5, 10, 20, 30, 60, 90))
);
--> statement-breakpoint
CREATE TABLE "battle_quizzes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"locale" "locale" NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_quizzes_title_len" CHECK (length("battle_quizzes"."title") BETWEEN 1 AND 120),
	CONSTRAINT "battle_quizzes_description_len" CHECK (length("battle_quizzes"."description") <= 500)
);
--> statement-breakpoint
CREATE TABLE "battle_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"battle_quiz_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"code" char(6) NOT NULL,
	"status" "battle_session_status" DEFAULT 'lobby' NOT NULL,
	"phase" "battle_phase" DEFAULT 'lobby' NOT NULL,
	"settings" jsonb NOT NULL,
	"questions_snapshot" jsonb NOT NULL,
	"current_index" integer,
	"question_started_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"state_version" integer DEFAULT 0 NOT NULL,
	"cancel_reason" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_sessions_code" CHECK ("battle_sessions"."code" ~ '^[A-Z]{3}[1-9]{3}$'),
	CONSTRAINT "battle_sessions_cancel_reason" CHECK ("battle_sessions"."cancel_reason" IN ('host', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "battle_answers" ADD CONSTRAINT "battle_answers_session_id_battle_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."battle_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_answers" ADD CONSTRAINT "battle_answers_participant_id_battle_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."battle_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_options" ADD CONSTRAINT "battle_options_battle_question_id_battle_questions_id_fk" FOREIGN KEY ("battle_question_id") REFERENCES "public"."battle_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_session_id_battle_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."battle_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_questions" ADD CONSTRAINT "battle_questions_battle_quiz_id_battle_quizzes_id_fk" FOREIGN KEY ("battle_quiz_id") REFERENCES "public"."battle_quizzes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_questions" ADD CONSTRAINT "battle_questions_image_media_id_media_files_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."media_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_questions" ADD CONSTRAINT "battle_questions_source_question_id_questions_id_fk" FOREIGN KEY ("source_question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_quizzes" ADD CONSTRAINT "battle_quizzes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_sessions" ADD CONSTRAINT "battle_sessions_battle_quiz_id_battle_quizzes_id_fk" FOREIGN KEY ("battle_quiz_id") REFERENCES "public"."battle_quizzes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_sessions" ADD CONSTRAINT "battle_sessions_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_sessions" ADD CONSTRAINT "battle_sessions_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_battle_answers_question" ON "battle_answers" USING btree ("session_id","question_index");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_battle_one_correct" ON "battle_options" USING btree ("battle_question_id") WHERE is_correct;--> statement-breakpoint
CREATE INDEX "ix_battle_quizzes_owner" ON "battle_quizzes" USING btree ("owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ux_battle_active_code" ON "battle_sessions" USING btree ("code") WHERE status IN ('lobby', 'in_progress');--> statement-breakpoint
CREATE INDEX "ix_battle_sessions_host" ON "battle_sessions" USING btree ("host_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_battle_sessions_class" ON "battle_sessions" USING btree ("class_id","created_at" DESC NULLS LAST);--> statement-breakpoint

-- 5.9: UNIQUE (battle_quiz_id, position) DEFERRABLE INITIALLY DEFERRED — перестановка вопросов в одной транзакции (API-BTL-09).
ALTER TABLE battle_questions ADD CONSTRAINT battle_questions_quiz_position_key
  UNIQUE (battle_quiz_id, position) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

-- 5.1: updated_at обновляется при каждом UPDATE (функция set_updated_at() — миграция 0002).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['battle_quizzes','battle_questions','battle_options','battle_sessions','battle_participants','battle_answers']
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- 5.8, BR-BTL-11: app_maintenance удаляет ответы ученика при обезличивании (чтение участников — для отбора).
GRANT SELECT, DELETE ON battle_answers TO app_maintenance;
--> statement-breakpoint
GRANT SELECT ON battle_participants TO app_maintenance;
--> statement-breakpoint

-- 5.9: RLS — второй уровень защиты (SHOULD), как в 0002. Контекст пользователя: SET LOCAL app.user_id = '<uuid>'.
-- Без контекста — без ограничения (основная защита — guards и сервисы, BR-BTL-12).
CREATE FUNCTION app_user_context() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint
-- SECURITY DEFINER: проверки читают таблицы без RLS, иначе политики сессий и участников ссылались бы друг на друга.
CREATE FUNCTION battle_quiz_visible(quiz_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public AS $$
  SELECT app_user_context() IS NULL
      OR EXISTS (SELECT 1 FROM battle_quizzes q WHERE q.id = quiz_id AND q.owner_id = app_user_context())
$$;
--> statement-breakpoint
CREATE FUNCTION battle_session_visible(sid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public AS $$
  SELECT app_user_context() IS NULL
      OR EXISTS (SELECT 1 FROM battle_sessions s WHERE s.id = sid AND s.host_id = app_user_context())
      OR EXISTS (SELECT 1 FROM battle_participants p WHERE p.session_id = sid AND p.student_id = app_user_context())
$$;
--> statement-breakpoint
CREATE FUNCTION battle_answer_visible(sid uuid, pid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public AS $$
  SELECT app_user_context() IS NULL
      OR EXISTS (SELECT 1 FROM battle_sessions s WHERE s.id = sid AND s.host_id = app_user_context())
      OR EXISTS (SELECT 1 FROM battle_participants p WHERE p.id = pid AND p.student_id = app_user_context())
$$;
--> statement-breakpoint
ALTER TABLE battle_quizzes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE battle_questions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE battle_options ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE battle_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE battle_participants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE battle_answers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY battle_quizzes_owner ON battle_quizzes TO app_user
  USING (battle_quiz_visible(id)) WITH CHECK (app_user_context() IS NULL OR owner_id = app_user_context());
--> statement-breakpoint
CREATE POLICY battle_questions_owner ON battle_questions TO app_user
  USING (battle_quiz_visible(battle_quiz_id)) WITH CHECK (battle_quiz_visible(battle_quiz_id));
--> statement-breakpoint
CREATE POLICY battle_options_owner ON battle_options TO app_user
  USING (battle_quiz_visible((SELECT q.battle_quiz_id FROM battle_questions q WHERE q.id = battle_question_id)))
  WITH CHECK (battle_quiz_visible((SELECT q.battle_quiz_id FROM battle_questions q WHERE q.id = battle_question_id)));
--> statement-breakpoint
CREATE POLICY battle_sessions_member ON battle_sessions TO app_user
  USING (battle_session_visible(id)) WITH CHECK (app_user_context() IS NULL OR host_id = app_user_context());
--> statement-breakpoint
CREATE POLICY battle_participants_member ON battle_participants TO app_user
  USING (battle_session_visible(session_id)) WITH CHECK (battle_session_visible(session_id));
--> statement-breakpoint
CREATE POLICY battle_answers_own ON battle_answers TO app_user
  USING (battle_answer_visible(session_id, participant_id))
  WITH CHECK (battle_answer_visible(session_id, participant_id));
--> statement-breakpoint
CREATE POLICY battle_answers_maintenance ON battle_answers TO app_maintenance USING (true);
--> statement-breakpoint
CREATE POLICY battle_participants_maintenance ON battle_participants FOR SELECT TO app_maintenance USING (true);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['battle_quizzes','battle_questions','battle_options','battle_sessions','battle_participants','battle_answers']
  LOOP
    EXECUTE format('CREATE POLICY %s_read ON %I FOR SELECT TO analytics_ro USING (true)', t, t);
  END LOOP;
END
$$;
