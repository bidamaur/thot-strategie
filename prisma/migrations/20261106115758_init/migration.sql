-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('CHESS', 'CHECKERS');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'FINISHED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "TournamentScope" AS ENUM ('NEIGHBORHOOD', 'CITY', 'COUNTRY', 'CONTINENT');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "pointsFree" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "walletReal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "elo" INTEGER NOT NULL DEFAULT 1200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "playerWhiteId" TEXT NOT NULL,
    "playerBlackId" TEXT,
    "gameType" "GameType" NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "stakeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "MatchStatus" NOT NULL DEFAULT 'WAITING',
    "winnerId" TEXT,
    "movesHistory" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "scope" "TournamentScope" NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "entryFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalPrizePool" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "maxPlayers" INTEGER NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Match_status_createdAt_idx" ON "Match"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Match_playerWhiteId_idx" ON "Match"("playerWhiteId");

-- CreateIndex
CREATE INDEX "Match_playerBlackId_idx" ON "Match"("playerBlackId");

-- CreateIndex
CREATE INDEX "Tournament_status_scope_idx" ON "Tournament"("status", "scope");

-- CreateIndex
CREATE INDEX "Tournament_creatorId_idx" ON "Tournament"("creatorId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_playerWhiteId_fkey" FOREIGN KEY ("playerWhiteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_playerBlackId_fkey" FOREIGN KEY ("playerBlackId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
