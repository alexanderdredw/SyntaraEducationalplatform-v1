-- BR-SCI-01, REQ-SCI-04 (docs/SCIENTISTS_TZ.md): отметка «Изучено» ученика по разделам урока (учёные урока
-- «Учёные-химики»; общая форма — и для разделов других уроков). XP не начисляется. Откат — down/0018.
CREATE TABLE "section_progress" (
	"student_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"section_code" text NOT NULL,
	"studied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "section_progress_student_id_topic_id_section_code_pk" PRIMARY KEY("student_id","topic_id","section_code"),
	CONSTRAINT "section_progress_code" CHECK (char_length("section_progress"."section_code") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "section_progress" ADD CONSTRAINT "section_progress_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_progress" ADD CONSTRAINT "section_progress_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;