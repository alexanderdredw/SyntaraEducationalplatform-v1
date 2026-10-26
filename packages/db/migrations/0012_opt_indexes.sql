-- OPT-05 (О4-6, docs/OPTIMIZATION_REPORT.md 7.5): индексы «горячих» путей — частичный индекс опроса outbox и
-- внешние ключи без индекса. Только индексы: данные и ограничения целостности не меняются. Откат — down/0012.
CREATE INDEX "ix_auth_sessions_user" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_classes_teacher" ON "classes" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "ix_topic_sections_topic" ON "topic_sections" USING btree ("topic_id","position");--> statement-breakpoint
CREATE INDEX "ix_assignments_topic" ON "assignments" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "ix_questions_quiz" ON "questions" USING btree ("quiz_id","position");--> statement-breakpoint
CREATE INDEX "ix_submissions_student" ON "submissions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "ix_notifications_user" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_outbox_pending" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."processed_at" IS NULL;