-- REQ-TST-04, BR-TST-01 (docs/TESTS_TZ.md): подсказка «50/50» в тесте темы — какие варианты убрал сервер
-- (attempt_hints: одна на вопрос, не больше трёх на попытку — сервис) и процент попытки для XP с весом 0,5 у верного
-- ответа с подсказкой (quiz_attempts.xp_percent; у прежних попыток — null, для XP берётся score_percent). Откат —
-- down/0017.
CREATE TABLE "attempt_hints" (
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"removed_option_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempt_hints_attempt_id_question_id_pk" PRIMARY KEY("attempt_id","question_id"),
	CONSTRAINT "attempt_hints_removed" CHECK (cardinality("attempt_hints"."removed_option_ids") = 2)
);
--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "xp_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "attempt_hints" ADD CONSTRAINT "attempt_hints_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_hints" ADD CONSTRAINT "attempt_hints_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;