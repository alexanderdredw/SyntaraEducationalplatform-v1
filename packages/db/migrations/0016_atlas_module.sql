-- REQ-ATL-01, REQ-ATL-03 (docs/CHEM_TZ_2.md): модуль базового предмета (subjects.module = 'atlas-chemistry',
-- «Mendeleev Atlas»), сессии квиза «Проверь знания» и игры «Кто этот учёный?» (atlas_quiz_sessions) и событие
-- atlas_quiz_finished (XP — BR-XP-05, серия — BR-ST-02). Откат — down/0016.
CREATE TABLE "atlas_quiz_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"state" jsonb NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"xp_awarded" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "atlas_quiz_kind" CHECK ("atlas_quiz_sessions"."kind" IN ('elements','scientists')),
	CONSTRAINT "atlas_quiz_status" CHECK ("atlas_quiz_sessions"."status" IN ('in_progress','finished')),
	CONSTRAINT "atlas_quiz_counts" CHECK ("atlas_quiz_sessions"."correct_count" BETWEEN 0 AND "atlas_quiz_sessions"."total" AND "atlas_quiz_sessions"."xp_awarded" >= 0)
);
--> statement-breakpoint
ALTER TABLE "learning_events" DROP CONSTRAINT "learning_events_type";--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "module" text;--> statement-breakpoint
ALTER TABLE "atlas_quiz_sessions" ADD CONSTRAINT "atlas_quiz_sessions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atlas_quiz_sessions" ADD CONSTRAINT "atlas_quiz_sessions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_atlas_quiz_student_time" ON "atlas_quiz_sessions" USING btree ("student_id","created_at");--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_module" CHECK ("subjects"."module" IS NULL OR ("subjects"."is_official" AND "subjects"."module" IN ('atlas-chemistry')));--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_type" CHECK ("learning_events"."type" IN ('lesson_opened','quiz_finished','topic_mastered','ai_question','atlas_quiz_finished'));--> statement-breakpoint
CREATE TRIGGER trg_atlas_quiz_sessions_updated_at BEFORE UPDATE ON atlas_quiz_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- RLS «только свои» — второй уровень защиты (как в 0009): контекст SET LOCAL app.user_id; без контекста — без
-- ограничения (основная защита — guards и сервисы).
ALTER TABLE atlas_quiz_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY atlas_quiz_sessions_own ON atlas_quiz_sessions TO app_user
  USING (app_user_context() IS NULL OR student_id = app_user_context())
  WITH CHECK (app_user_context() IS NULL OR student_id = app_user_context());
--> statement-breakpoint
CREATE POLICY atlas_quiz_sessions_read ON atlas_quiz_sessions FOR SELECT TO analytics_ro USING (true);
