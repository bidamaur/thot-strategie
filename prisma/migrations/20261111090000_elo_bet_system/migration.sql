-- Add new values to existing enums (PostgreSQL ALTER TYPE ADD VALUE)
ALTER TYPE "BalanceType" ADD VALUE 'BET_ESCROW';
ALTER TYPE "BalanceTransactionType" ADD VALUE 'BET_PLACED';
ALTER TYPE "BalanceTransactionType" ADD VALUE 'BET_WON';
ALTER TYPE "BalanceTransactionType" ADD VALUE 'BET_LOST';
ALTER TYPE "BalanceTransactionType" ADD VALUE 'BET_REFUNDED';
ALTER TYPE "BalanceTransactionType" ADD VALUE 'GAME_POINTS_WON';
ALTER TYPE "BalanceTransactionType" ADD VALUE 'GAME_POINTS_LOST';
ALTER TYPE "BalanceTransactionType" ADD VALUE 'ELO_CHANGE';

-- Create new enums
CREATE TYPE "GameResult" AS ENUM ('WIN', 'LOSS', 'DRAW');
CREATE TYPE "BetStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'COUNTERED', 'EXPIRED', 'SETTLED', 'REFUNDED');
CREATE TYPE "RatingChangeReason" AS ENUM ('GAME_WIN', 'GAME_LOSS', 'GAME_DRAW', 'RESET', 'CORRECTION');

-- Rename existing columns on Match (preserve data)
ALTER TABLE "Match" RENAME COLUMN "isPaid" TO "betEnabled";
ALTER TABLE "Match" RENAME COLUMN "stakeAmount" TO "betAmount";

-- Change betAmount from Decimal to Integer (points, not CFA)
ALTER TABLE "Match" ALTER COLUMN "betAmount" TYPE INTEGER USING "betAmount"::INTEGER;

-- Add new columns to Match
ALTER TABLE "Match" ADD COLUMN "rated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Match" ADD COLUMN "betStatus" "BetStatus";
ALTER TABLE "Match" ADD COLUMN "betProposedById" TEXT;
ALTER TABLE "Match" ADD COLUMN "betAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Match" ADD COLUMN "betSettledAt" TIMESTAMP(3);
ALTER TABLE "Match" ADD COLUMN "result" "GameResult";
ALTER TABLE "Match" ADD COLUMN "eloDeltaWhite" INTEGER;
ALTER TABLE "Match" ADD COLUMN "eloDeltaBlack" INTEGER;
ALTER TABLE "Match" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add foreign key for betProposedById
ALTER TABLE "Match" ADD CONSTRAINT "Match_betProposedById_fkey" FOREIGN KEY ("betProposedById") REFERENCES "User"("id") ON DELETE SET NULL;

-- Add indexes on Match for new columns
CREATE INDEX "Match_rated_idx" ON "Match"("rated");
CREATE INDEX "Match_betStatus_idx" ON "Match"("betStatus");

-- Create PlayerRating table
CREATE TABLE "PlayerRating" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "timeControl" TEXT,
    "eloRating" INTEGER NOT NULL DEFAULT 1200,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "ratingDeviation" DOUBLE PRECISION NOT NULL DEFAULT 350.0,
    "lastRatingUpdate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerRating_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlayerRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "PlayerRating_userId_variant_timeControl_key" ON "PlayerRating"("userId", "variant", "timeControl");
CREATE INDEX "PlayerRating_variant_eloRating_idx" ON "PlayerRating"("variant", "eloRating");
CREATE INDEX "PlayerRating_userId_idx" ON "PlayerRating"("userId");

-- Create RatingHistory table
CREATE TABLE "RatingHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "timeControl" TEXT,
    "oldRating" INTEGER NOT NULL,
    "newRating" INTEGER NOT NULL,
    "change" INTEGER NOT NULL,
    "reason" "RatingChangeReason" NOT NULL,
    "matchId" TEXT,
    "opponentId" TEXT,
    "opponentRatingBefore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatingHistory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RatingHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
    CONSTRAINT "RatingHistory_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL
);

CREATE INDEX "RatingHistory_userId_createdAt_idx" ON "RatingHistory"("userId", "createdAt");
CREATE INDEX "RatingHistory_matchId_idx" ON "RatingHistory"("matchId");

-- Create GameBet table
CREATE TABLE "GameBet" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "proposerId" TEXT NOT NULL,
    "opponentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "BetStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "counterProposal" INTEGER,
    "counterProposedBy" TEXT,

    CONSTRAINT "GameBet_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GameBet_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE,
    CONSTRAINT "GameBet_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "User"("id") ON DELETE CASCADE,
    CONSTRAINT "GameBet_opponentId_fkey" FOREIGN KEY ("opponentId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "GameBet_matchId_key" ON "GameBet"("matchId");
CREATE INDEX "GameBet_status_idx" ON "GameBet"("status");
CREATE INDEX "GameBet_matchId_idx" ON "GameBet"("matchId");

-- Create GameBetTransaction table
CREATE TABLE "GameBetTransaction" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameBetTransaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GameBetTransaction_betId_fkey" FOREIGN KEY ("betId") REFERENCES "GameBet"("id") ON DELETE CASCADE,
    CONSTRAINT "GameBetTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "GameBetTransaction_betId_idx" ON "GameBetTransaction"("betId");
CREATE INDEX "GameBetTransaction_userId_createdAt_idx" ON "GameBetTransaction"("userId", "createdAt");

-- Create MatchResult table
CREATE TABLE "MatchResult" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "whiteResult" "GameResult" NOT NULL,
    "blackResult" "GameResult" NOT NULL,
    "whitePointsChange" INTEGER NOT NULL,
    "blackPointsChange" INTEGER NOT NULL,
    "whiteEloChange" INTEGER NOT NULL,
    "blackEloChange" INTEGER NOT NULL,
    "betSettled" BOOLEAN NOT NULL DEFAULT false,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchResult_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MatchResult_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "MatchResult_matchId_key" ON "MatchResult"("matchId");
CREATE INDEX "MatchResult_matchId_idx" ON "MatchResult"("matchId");
