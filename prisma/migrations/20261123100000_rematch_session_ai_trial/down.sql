-- Retour arrière (perte des liens de revanche et des essais quotidiens).
DROP TABLE IF EXISTS "AiDailyTrial";
ALTER TABLE "Match" DROP CONSTRAINT IF EXISTS "Match_rematchOfId_fkey";
DROP INDEX IF EXISTS "Match_rematchOfId_idx";
ALTER TABLE "Match" DROP COLUMN IF EXISTS "rematchOfId";
