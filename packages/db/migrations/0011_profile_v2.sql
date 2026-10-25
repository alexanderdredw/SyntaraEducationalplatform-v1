CREATE TABLE "known_devices" (
	"user_id" uuid NOT NULL,
	"device_hash" "bytea" NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "known_devices_user_id_device_hash_pk" PRIMARY KEY("user_id","device_hash")
);
--> statement-breakpoint
ALTER TABLE "nav_seen" DROP CONSTRAINT "nav_seen_section";--> statement-breakpoint
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_seen" ADD CONSTRAINT "nav_seen_section" CHECK ("nav_seen"."section" IN ('class','achievements','profile_completeness'));--> statement-breakpoint

-- BR-PRF-20: RLS «только свои» (как 0009/0010). Контекст — SET LOCAL app.user_id; без контекста — без ограничения.
ALTER TABLE known_devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY known_devices_own ON known_devices TO app_user
  USING (app_user_context() IS NULL OR user_id = app_user_context())
  WITH CHECK (app_user_context() IS NULL OR user_id = app_user_context());
