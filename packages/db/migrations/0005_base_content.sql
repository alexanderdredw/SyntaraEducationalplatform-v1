-- Базовая программа платформы (этап 8.6, решение владельца 2026-10-16): постоянные коды строк, созданных импортом
-- content/ (BR-CNT-04), и пометка перевода «на проверке» (BR-CNT-05). У контента учителей code = NULL.
ALTER TABLE "subjects" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "topic_sections" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "topic_translations" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "topic_sections" ADD CONSTRAINT "topic_sections_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_code_official" CHECK ("subjects"."code" IS NULL OR "subjects"."is_official");