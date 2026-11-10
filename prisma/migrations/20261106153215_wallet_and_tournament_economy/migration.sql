-- CreateEnum
CREATE TYPE "BalanceType" AS ENUM ('FREE_POINTS', 'REAL_WALLET');

-- CreateEnum
CREATE TYPE "BalanceTransactionType" AS ENUM ('MOCK_PURCHASE', 'TOURNAMENT_ENTRY', 'TOURNAMENT_PRIZE', 'TOURNAMENT_POINTS_ENTRY', 'TOURNAMENT_POINTS_PRIZE');

-- CreateEnum
CREATE TYPE "TournamentMatchStage" AS ENUM ('MAIN', 'THIRD_PLACE');

-- CreateEnum
CREATE TYPE "TournamentMatchStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'FINISHED');

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "entryPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "platformFee" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BalanceTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balanceType" "BalanceType" NOT NULL,
    "transactionType" "BalanceTransactionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "referenceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentParticipant" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "placement" INTEGER,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentMatch" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "stage" "TournamentMatchStage" NOT NULL DEFAULT 'MAIN',
    "round" INTEGER NOT NULL,
    "matchNumber" INTEGER NOT NULL,
    "playerWhiteId" TEXT,
    "playerBlackId" TEXT,
    "winnerId" TEXT,
    "loserId" TEXT,
    "status" "TournamentMatchStatus" NOT NULL DEFAULT 'WAITING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TournamentMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BalanceTransaction_userId_createdAt_idx" ON "BalanceTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceTransaction_userId_transactionType_referenceId_key" ON "BalanceTransaction"("userId", "transactionType", "referenceId");

-- CreateIndex
CREATE INDEX "TournamentParticipant_tournamentId_placement_idx" ON "TournamentParticipant"("tournamentId", "placement");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentParticipant_tournamentId_userId_key" ON "TournamentParticipant"("tournamentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentParticipant_tournamentId_seed_key" ON "TournamentParticipant"("tournamentId", "seed");

-- CreateIndex
CREATE INDEX "TournamentMatch_tournamentId_stage_round_status_idx" ON "TournamentMatch"("tournamentId", "stage", "round", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatch_tournamentId_stage_round_matchNumber_key" ON "TournamentMatch"("tournamentId", "stage", "round", "matchNumber");

-- AddForeignKey
ALTER TABLE "BalanceTransaction" ADD CONSTRAINT "BalanceTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_playerWhiteId_fkey" FOREIGN KEY ("playerWhiteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_playerBlackId_fkey" FOREIGN KEY ("playerBlackId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_loserId_fkey" FOREIGN KEY ("loserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
