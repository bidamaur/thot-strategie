-- Score de session des affronts (lien de revanche) et essai quotidien du niveau 5 de l IA : migration additive.

ALTER TABLE "Match" ADD COLUMN "rematchOfId" TEXT;
CREATE INDEX "Match_rematchOfId_idx" ON "Match"("rematchOfId");
ALTER TABLE "Match" ADD CONSTRAINT "Match_rematchOfId_fkey" FOREIGN KEY ("rematchOfId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AiDailyTrial" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "adStartedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "gameType" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiDailyTrial_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiDailyTrial_userId_day_key" ON "AiDailyTrial"("userId", "day");
CREATE INDEX "AiDailyTrial_day_idx" ON "AiDailyTrial"("day");
ALTER TABLE "AiDailyTrial" ADD CONSTRAINT "AiDailyTrial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
