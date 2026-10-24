CREATE TABLE "nav_seen" (
	"user_id" uuid NOT NULL,
	"section" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nav_seen_user_id_section_pk" PRIMARY KEY("user_id","section"),
	CONSTRAINT "nav_seen_section" CHECK ("nav_seen"."section" IN ('class','achievements'))
);
--> statement-breakpoint
ALTER TABLE "nav_seen" ADD CONSTRAINT "nav_seen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- REQ-NAV-14: RLS «только свои» — второй уровень защиты (как в 0002, 0007). Контекст: SET LOCAL app.user_id;
-- без контекста — без ограничения (основная защита — guards и сервисы).
ALTER TABLE nav_seen ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY nav_seen_own ON nav_seen TO app_user
  USING (app_user_context() IS NULL OR user_id = app_user_context())
  WITH CHECK (app_user_context() IS NULL OR user_id = app_user_context());
