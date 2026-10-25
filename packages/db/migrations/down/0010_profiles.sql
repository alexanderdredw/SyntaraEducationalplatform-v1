-- Откат 0010_profiles (5.11): профили и картинки-аватары. users.display_name не трогается — имена остаются.
-- Объекты картинок в хранилище SQL не удаляет (ключи avatar/*) — их можно удалить вручную.
DROP TABLE IF EXISTS "user_profiles";
DROP FUNCTION IF EXISTS profile_visible(uuid);
DELETE FROM media_files WHERE kind = 'avatar';
-- Значение 'avatar' перечисления media_kind удаляется пересозданием типа (ALTER TYPE … DROP VALUE в PostgreSQL нет).
ALTER TYPE media_kind RENAME TO media_kind_0010;
CREATE TYPE media_kind AS ENUM ('cover', 'material', 'illustration', 'brand');
ALTER TABLE media_files ALTER COLUMN kind TYPE media_kind USING kind::text::media_kind;
DROP TYPE media_kind_0010;
