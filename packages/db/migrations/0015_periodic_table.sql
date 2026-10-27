-- REQ-PTBL-01, REQ-PTBL-04 (docs/CHEM_TZ.md 6.3): блоки страницы базового предмета (subjects.blocks) и номер
-- химического элемента урока (topics.element_number) для ячеек таблицы Менделеева. Откат — down/0015.
ALTER TABLE "subjects" ADD COLUMN "blocks" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "element_number" smallint;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_topics_subject_element" ON "topics" USING btree ("subject_id","element_number") WHERE element_number IS NOT NULL;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_blocks" CHECK ("subjects"."blocks" <@ ARRAY['periodic-table']::text[]);--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_element_number" CHECK ("topics"."element_number" BETWEEN 1 AND 118);