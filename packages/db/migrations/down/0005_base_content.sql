-- Откат 0005_base_content.
ALTER TABLE "subjects" DROP CONSTRAINT IF EXISTS "subjects_code_official";
--> statement-breakpoint
ALTER TABLE "questions" DROP COLUMN IF EXISTS "code";
--> statement-breakpoint
ALTER TABLE "topics" DROP COLUMN IF EXISTS "code";
--> statement-breakpoint
ALTER TABLE "topic_translations" DROP COLUMN IF EXISTS "needs_review";
--> statement-breakpoint
ALTER TABLE "topic_sections" DROP COLUMN IF EXISTS "code";
--> statement-breakpoint
ALTER TABLE "subjects" DROP COLUMN IF EXISTS "code";
