-- REQ-GLOS-01…06 (docs/CHEM_TZ.md 6.2): глоссарий базового предмета — разделы и термины с переводами.
-- Другие таблицы не меняются. Откат — down/0014.
CREATE TABLE "glossary_section_translations" (
	"section_id" uuid,
	"locale" "locale",
	"title" text NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	CONSTRAINT "glossary_section_translations_section_id_locale_pk" PRIMARY KEY("section_id","locale"),
	CONSTRAINT "glossary_section_tr_title_len" CHECK (length("glossary_section_translations"."title") <= 150)
);
--> statement-breakpoint
CREATE TABLE "glossary_sections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_id" uuid NOT NULL,
	"code" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "glossary_sections_subject_code" UNIQUE("subject_id","code"),
	CONSTRAINT "glossary_sections_position" CHECK ("glossary_sections"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "glossary_term_translations" (
	"term_id" uuid,
	"locale" "locale",
	"term" text NOT NULL,
	"definition" text NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	CONSTRAINT "glossary_term_translations_term_id_locale_pk" PRIMARY KEY("term_id","locale"),
	CONSTRAINT "glossary_term_tr_term_len" CHECK (length("glossary_term_translations"."term") <= 150),
	CONSTRAINT "glossary_term_tr_definition_len" CHECK (length("glossary_term_translations"."definition") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "glossary_terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"section_id" uuid NOT NULL,
	"code" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "glossary_terms_section_code" UNIQUE("section_id","code")
);
--> statement-breakpoint
ALTER TABLE "glossary_section_translations" ADD CONSTRAINT "glossary_section_translations_section_id_glossary_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."glossary_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_sections" ADD CONSTRAINT "glossary_sections_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_term_translations" ADD CONSTRAINT "glossary_term_translations_term_id_glossary_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."glossary_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_section_id_glossary_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."glossary_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_glossary_terms_section" ON "glossary_terms" USING btree ("section_id","position");