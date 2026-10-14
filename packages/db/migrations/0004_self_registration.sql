-- Самостоятельная регистрация ученика (решение владельца 2026-10-14): подтверждение email (API-AUTH-06)
-- и временный пароль от учителя (API-T-27). Школы, введённые вручную, — schools.status = 'unverified' (столбец уже есть).
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;