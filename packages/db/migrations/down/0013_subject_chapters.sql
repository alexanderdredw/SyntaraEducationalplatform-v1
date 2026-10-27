-- Откат 0013_subject_chapters (BR-CHAP-01…05): связь тем с главами и таблицы глав; темы и предметы не удаляются.
ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "topics_chapter_id_subject_chapters_id_fk";
ALTER TABLE "topics" DROP COLUMN IF EXISTS "chapter_id";
DROP TABLE IF EXISTS "subject_chapter_translations";
DROP TABLE IF EXISTS "subject_chapters";
