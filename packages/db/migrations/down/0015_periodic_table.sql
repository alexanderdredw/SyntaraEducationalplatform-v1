-- Откат 0015_periodic_table (REQ-PTBL-01, REQ-PTBL-04): только добавленные столбцы и ограничения.
ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "topics_element_number";
DROP INDEX IF EXISTS "ux_topics_subject_element";
ALTER TABLE "topics" DROP COLUMN IF EXISTS "element_number";
ALTER TABLE "subjects" DROP CONSTRAINT IF EXISTS "subjects_blocks";
ALTER TABLE "subjects" DROP COLUMN IF EXISTS "blocks";
