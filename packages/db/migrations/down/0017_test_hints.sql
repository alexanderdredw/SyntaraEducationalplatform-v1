-- Откат 0017_test_hints (REQ-TST-04, BR-TST-01): подсказки «50/50» теста темы и процент попытки для XP.
DROP TABLE IF EXISTS "attempt_hints";
ALTER TABLE "quiz_attempts" DROP COLUMN IF EXISTS "xp_percent";
