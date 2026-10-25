-- Откат 0011_profile_v2 (docs/PROFILE_TZ_2.md): таблица known_devices; раздел nav_seen 'profile_completeness'
-- (его отметки удаляются, остальные отметки разделов «Мой класс» и «Достижения» не трогаются).
DROP TABLE IF EXISTS "known_devices";
DELETE FROM nav_seen WHERE section = 'profile_completeness';
ALTER TABLE "nav_seen" DROP CONSTRAINT "nav_seen_section";
ALTER TABLE "nav_seen" ADD CONSTRAINT "nav_seen_section" CHECK ("nav_seen"."section" IN ('class','achievements'));
