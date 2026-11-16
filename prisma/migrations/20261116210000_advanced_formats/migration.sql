-- Formats avancés : groupes + phase finale, double élimination, Arena.
ALTER TYPE "TournamentMatchStage" ADD VALUE IF NOT EXISTS 'GROUP';
ALTER TYPE "TournamentMatchStage" ADD VALUE IF NOT EXISTS 'KNOCKOUT';
ALTER TYPE "TournamentMatchStage" ADD VALUE IF NOT EXISTS 'WINNERS';
ALTER TYPE "TournamentMatchStage" ADD VALUE IF NOT EXISTS 'LOSERS';
ALTER TYPE "TournamentMatchStage" ADD VALUE IF NOT EXISTS 'GRAND_FINAL';
ALTER TABLE "TournamentMatch" ADD COLUMN "groupNumber" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "durationMinutes" INTEGER;
ALTER TABLE "TournamentParticipant" ADD COLUMN "arenaWaitingSince" TIMESTAMP(3);
CREATE INDEX "TournamentParticipant_tournamentId_arenaWaitingSince_idx" ON "TournamentParticipant"("tournamentId", "arenaWaitingSince");
