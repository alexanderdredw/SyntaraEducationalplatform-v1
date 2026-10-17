-- Порядок базовых предметов в каталоге задаётся в content/<раздел>/<предмет>/subject.yaml (решение владельца 2026-10-17).
-- У предметов учителей position = NULL; разделы каталога уже имеют catalog_sections.position (5.4).
ALTER TABLE "subjects" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_position_official" CHECK ("subjects"."position" IS NULL OR ("subjects"."is_official" AND "subjects"."position" >= 1));