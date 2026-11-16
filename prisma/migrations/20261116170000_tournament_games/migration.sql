-- Lien entre une partie en ligne et le match de tournoi qu'elle dispute.
ALTER TABLE "Match" ADD COLUMN "tournamentMatchId" TEXT;
CREATE UNIQUE INDEX "Match_tournamentMatchId_key" ON "Match"("tournamentMatchId");
ALTER TABLE "Match" ADD CONSTRAINT "Match_tournamentMatchId_fkey" FOREIGN KEY ("tournamentMatchId") REFERENCES "TournamentMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
