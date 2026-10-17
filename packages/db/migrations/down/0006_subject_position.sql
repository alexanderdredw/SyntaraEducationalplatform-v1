-- Откат 0006_subject_position.
ALTER TABLE "subjects" DROP CONSTRAINT IF EXISTS "subjects_position_official";
--> statement-breakpoint
ALTER TABLE "subjects" DROP COLUMN IF EXISTS "position";
