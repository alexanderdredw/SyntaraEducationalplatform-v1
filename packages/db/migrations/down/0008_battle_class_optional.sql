-- Откат 0008_battle_class_optional. Данные не удаляются: если есть сессии без класса, откат прервётся
-- с ошибкой NOT NULL — такие сессии нужно обработать вручную.
ALTER TABLE "battle_sessions" ALTER COLUMN "class_id" SET NOT NULL;
