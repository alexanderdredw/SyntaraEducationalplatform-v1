-- Q-BTL-01 (решение владельца 2026-10-20): Battle не зависит от классов — класс сессии необязателен.
-- Данные не удаляются: у прошедших сессий class_id сохраняется.
ALTER TABLE "battle_sessions" ALTER COLUMN "class_id" DROP NOT NULL;
