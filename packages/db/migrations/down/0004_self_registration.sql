-- Откат 0004_self_registration.
ALTER TABLE "users" DROP COLUMN IF EXISTS "must_change_password";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "email_verified_at";
