-- Survival : durée en jours, fin programmée et vote d'arrêt anticipé.
ALTER TABLE "Tournament" ADD COLUMN "durationDays" INTEGER, ADD COLUMN "endsAt" TIMESTAMP(3);
CREATE INDEX "Tournament_status_endsAt_idx" ON "Tournament"("status", "endsAt");

CREATE TABLE "TournamentStopVote" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TournamentStopVote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TournamentStopVote_tournamentId_userId_key" ON "TournamentStopVote"("tournamentId", "userId");
ALTER TABLE "TournamentStopVote" ADD CONSTRAINT "TournamentStopVote_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentStopVote" ADD CONSTRAINT "TournamentStopVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
