ALTER TYPE "public"."media_kind" ADD VALUE 'avatar';--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"about" text,
	"position" text,
	"avatar_kind" text DEFAULT 'initials' NOT NULL,
	"avatar_preset" text,
	"avatar_media_id" uuid,
	"avatar_color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_first_name_len" CHECK (length("user_profiles"."first_name") BETWEEN 1 AND 40),
	CONSTRAINT "user_profiles_last_name_len" CHECK ("user_profiles"."last_name" IS NULL OR length("user_profiles"."last_name") <= 40),
	CONSTRAINT "user_profiles_about_len" CHECK ("user_profiles"."about" IS NULL OR length("user_profiles"."about") <= 300),
	CONSTRAINT "user_profiles_position_len" CHECK ("user_profiles"."position" IS NULL OR length("user_profiles"."position") <= 80),
	CONSTRAINT "user_profiles_avatar_kind" CHECK ("user_profiles"."avatar_kind" IN ('initials','preset','photo')),
	CONSTRAINT "user_profiles_preset_set" CHECK ("user_profiles"."avatar_kind" <> 'preset' OR "user_profiles"."avatar_preset" IS NOT NULL),
	CONSTRAINT "user_profiles_photo_set" CHECK ("user_profiles"."avatar_kind" <> 'photo' OR "user_profiles"."avatar_media_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_avatar_media_id_media_files_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- 5.11, AC-PRF-01: профиль для каждого существующего пользователя. Имя — display_name до первого пробела, фамилия —
-- остаток (пусто → NULL); длиннее 40 символов — первые 40 (users.display_name не меняется, данные не теряются).
-- Аватар — инициалы, цвет — случайный из 8 токенов (BR-PRF-02).
INSERT INTO user_profiles (user_id, first_name, last_name, avatar_kind, avatar_color)
SELECT u.id,
       left(split_part(n.name, ' ', 1), 40),
       nullif(left(btrim(substr(n.name, length(split_part(n.name, ' ', 1)) + 1)), 40), ''),
       'initials',
       (ARRAY['blue','violet','teal','green','amber','orange','pink','slate'])[1 + floor(random() * 8)::int]
FROM users u
CROSS JOIN LATERAL (SELECT regexp_replace(btrim(u.display_name), '\s+', ' ', 'g') AS name) n;
--> statement-breakpoint

-- 5.1: updated_at обновляется при каждом UPDATE (функция set_updated_at() — миграция 0002).
CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- BR-PRF-09: RLS — второй уровень защиты (как 0002/0007/0009). Владелец читает и меняет свой профиль; учитель читает
-- профили учеников своих классов и участников своих Battle; ученик — учителя своего класса и участников своих Battle.
-- Без контекста (SET LOCAL app.user_id) — без ограничения: основная защита — guards и сервисы.
CREATE FUNCTION profile_visible(uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public AS $$
  SELECT app_user_context() IS NULL
      OR uid = app_user_context()
      OR EXISTS (SELECT 1 FROM classes c JOIN class_memberships m ON m.class_id = c.id
                 WHERE m.status = 'active' AND c.archived_at IS NULL
                   AND ((c.teacher_id = app_user_context() AND m.student_id = uid)
                     OR (m.student_id = app_user_context() AND c.teacher_id = uid)))
      OR EXISTS (SELECT 1 FROM battle_sessions s JOIN battle_participants p ON p.session_id = s.id
                 WHERE s.host_id = app_user_context() AND p.student_id = uid)
      OR EXISTS (SELECT 1 FROM battle_participants me JOIN battle_participants p ON p.session_id = me.session_id
                 WHERE me.student_id = app_user_context() AND p.student_id = uid)
$$;
--> statement-breakpoint
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_profiles_visible ON user_profiles TO app_user
  USING (profile_visible(user_id))
  WITH CHECK (app_user_context() IS NULL OR user_id = app_user_context());
--> statement-breakpoint
CREATE POLICY user_profiles_read ON user_profiles FOR SELECT TO analytics_ro USING (true);
