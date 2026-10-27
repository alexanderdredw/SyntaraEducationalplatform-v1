-- BR-CHAP-01…05 (docs/CHEM_TZ.md 6.1): главы базового предмета — subject_chapters (+ переводы) и topics.chapter_id.
-- Предметы без глав и темы учителей не меняются (chapter_id = NULL). Откат — down/0013.
CREATE TABLE "subject_chapter_translations" (
	"chapter_id" uuid,
	"locale" "locale",
	"title" text NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	CONSTRAINT "subject_chapter_translations_chapter_id_locale_pk" PRIMARY KEY("chapter_id","locale"),
	CONSTRAINT "subject_chapter_tr_title_len" CHECK (length("subject_chapter_translations"."title") <= 150)
);
--> statement-breakpoint
CREATE TABLE "subject_chapters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_id" uuid NOT NULL,
	"code" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_chapters_subject_code" UNIQUE("subject_id","code"),
	CONSTRAINT "subject_chapters_position" CHECK ("subject_chapters"."position" >= 1)
);
--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "chapter_id" uuid;--> statement-breakpoint
ALTER TABLE "subject_chapter_translations" ADD CONSTRAINT "subject_chapter_translations_chapter_id_subject_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."subject_chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_chapters" ADD CONSTRAINT "subject_chapters_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_chapter_id_subject_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."subject_chapters"("id") ON DELETE no action ON UPDATE no action;