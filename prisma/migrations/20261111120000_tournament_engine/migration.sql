-- Create TournamentConfig table
CREATE TABLE "TournamentConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "isEditable" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TournamentConfig_key_key" ON "TournamentConfig"("key");
CREATE INDEX "TournamentConfig_updatedById_idx" ON "TournamentConfig"("updatedById");

-- Add new columns to Tournament table
ALTER TABLE "Tournament" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'ELIMINATION';
ALTER TABLE "Tournament" ADD COLUMN "gameType" TEXT NOT NULL DEFAULT 'CHECKERS';
ALTER TABLE "Tournament" ADD COLUMN "draughtsVariant" TEXT NOT NULL DEFAULT 'INTERNATIONAL';
ALTER TABLE "Tournament" ADD COLUMN "timeControlMinutes" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "minElo" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "maxElo" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "minPoints" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "maxPoints" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "initialCapital" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "minBet" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "maxBet" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "betMode" TEXT NOT NULL DEFAULT 'FIXED';
ALTER TABLE "Tournament" ADD COLUMN "survivalBankEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tournament" ADD COLUMN "rebuyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tournament" ADD COLUMN "rebuyCost" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "maxMatchesPerPlayer" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "Tournament" ADD COLUMN "finishedAt" TIMESTAMP(3);
ALTER TABLE "Tournament" ADD COLUMN "winnerId" TEXT;
ALTER TABLE "Tournament" ADD COLUMN "configSnapshot" JSONB;

CREATE INDEX "Tournament_type_idx" ON "Tournament"("type");
CREATE INDEX "Tournament_status_type_idx" ON "Tournament"("status", "type");

-- Add new columns to TournamentParticipant table
ALTER TABLE "TournamentParticipant" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "TournamentParticipant" ADD COLUMN "eliminatedAt" TIMESTAMP(3);

CREATE INDEX "TournamentParticipant_status_idx" ON "TournamentParticipant"("status");
CREATE INDEX "TournamentParticipant_tournamentId_status_idx" ON "TournamentParticipant"("tournamentId", "status");

-- Add new columns to TournamentMatch table
ALTER TABLE "TournamentMatch" ADD COLUMN "roundId" TEXT;
ALTER TABLE "TournamentMatch" ADD COLUMN "betAmount" INTEGER;
ALTER TABLE "TournamentMatch" ADD COLUMN "betStatus" TEXT;
ALTER TABLE "TournamentMatch" ADD COLUMN "betSettled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TournamentMatch" ADD COLUMN "whiteRemainingPieces" INTEGER;
ALTER TABLE "TournamentMatch" ADD COLUMN "blackRemainingPieces" INTEGER;

CREATE INDEX "TournamentMatch_roundId_idx" ON "TournamentMatch"("roundId");

-- Create TournamentWallet table
CREATE TABLE "TournamentWallet" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capital" INTEGER NOT NULL DEFAULT 0,
    "initialCapital" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "eliminatedAt" TIMESTAMP(3),
    "eliminationRound" INTEGER,
    "eliminationReason" TEXT,
    "totalBets" INTEGER NOT NULL DEFAULT 0,
    "totalWon" INTEGER NOT NULL DEFAULT 0,
    "totalLost" INTEGER NOT NULL DEFAULT 0,
    "matchesPlayed" INTEGER NOT NULL DEFAULT 0,
    "matchesWon" INTEGER NOT NULL DEFAULT 0,
    "matchesLost" INTEGER NOT NULL DEFAULT 0,
    "matchesDrawn" INTEGER NOT NULL DEFAULT 0,
    "winStreak" INTEGER NOT NULL DEFAULT 0,
    "bestWinStreak" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentWallet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TournamentWallet_tournamentId_userId_key" ON "TournamentWallet"("tournamentId", "userId");
CREATE INDEX "TournamentWallet_tournamentId_status_idx" ON "TournamentWallet"("tournamentId", "status");
CREATE INDEX "TournamentWallet_userId_idx" ON "TournamentWallet"("userId");

-- Create TournamentWalletTransaction table
CREATE TABLE "TournamentWalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "referenceId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentWalletTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TournamentWalletTransaction_walletId_idx" ON "TournamentWalletTransaction"("walletId");
CREATE INDEX "TournamentWalletTransaction_tournamentId_createdAt_idx" ON "TournamentWalletTransaction"("tournamentId", "createdAt");
CREATE INDEX "TournamentWalletTransaction_userId_createdAt_idx" ON "TournamentWalletTransaction"("userId", "createdAt");

-- Create TournamentBet table
CREATE TABLE "TournamentBet" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "counterAmount" INTEGER,
    "counterBy" TEXT,

    CONSTRAINT "TournamentBet_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TournamentBet_tournamentId_idx" ON "TournamentBet"("tournamentId");
CREATE INDEX "TournamentBet_matchId_idx" ON "TournamentBet"("matchId");
CREATE INDEX "TournamentBet_status_idx" ON "TournamentBet"("status");

-- Create TournamentRound table
CREATE TABLE "TournamentRound" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TournamentRound_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TournamentRound_tournamentId_roundNumber_key" ON "TournamentRound"("tournamentId", "roundNumber");
CREATE INDEX "TournamentRound_tournamentId_status_idx" ON "TournamentRound"("tournamentId", "status");

-- Add foreign keys
ALTER TABLE "TournamentConfig" ADD CONSTRAINT "TournamentConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL;

ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL;

ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE;
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE;
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "TournamentRound"("id") ON DELETE SET NULL;

ALTER TABLE "TournamentWallet" ADD CONSTRAINT "TournamentWallet_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE;
ALTER TABLE "TournamentWallet" ADD CONSTRAINT "TournamentWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

ALTER TABLE "TournamentWalletTransaction" ADD CONSTRAINT "TournamentWalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "TournamentWallet"("id") ON DELETE CASCADE;
ALTER TABLE "TournamentWalletTransaction" ADD CONSTRAINT "TournamentWalletTransaction_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE;
ALTER TABLE "TournamentWalletTransaction" ADD CONSTRAINT "TournamentWalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

ALTER TABLE "TournamentBet" ADD CONSTRAINT "TournamentBet_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE;
ALTER TABLE "TournamentBet" ADD CONSTRAINT "TournamentBet_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "TournamentWallet"("id") ON DELETE CASCADE;
ALTER TABLE "TournamentBet" ADD CONSTRAINT "TournamentBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

ALTER TABLE "TournamentRound" ADD CONSTRAINT "TournamentRound_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE;
