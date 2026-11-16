-- Migration additive : séparation des portefeuilles, modes de jeu, clubs, audit.
-- Écrite à la main pour ne PAS toucher aux colonnes existantes (dérive historique de la base).

CREATE TYPE "MatchMode" AS ENUM ('CASUAL', 'RATED', 'MONEY');
CREATE TYPE "TournamentVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'CLUB');
CREATE TYPE "ClubRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'MONEY_STAKE_LOCKED';
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'MONEY_STAKE_WON';
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'MONEY_STAKE_LOST';
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'MONEY_STAKE_REFUNDED';
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'MONEY_COMMISSION';
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'ADMIN_ADJUSTMENT';
ALTER TYPE "BalanceType" ADD VALUE IF NOT EXISTS 'MONEY_LOCKED';
ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'ABORTED';

ALTER TABLE "User"
  ADD COLUMN "walletLocked" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "moneyVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "premiumExpiresAt" TIMESTAMP(3),
  ADD COLUMN "bio" VARCHAR(280);
-- Garde-fous : aucun solde ne peut devenir négatif, même en cas de bug applicatif.
ALTER TABLE "User" ADD CONSTRAINT "User_walletReal_nonneg" CHECK ("walletReal" >= 0) NOT VALID;
ALTER TABLE "User" ADD CONSTRAINT "User_walletLocked_nonneg" CHECK ("walletLocked" >= 0);

ALTER TABLE "Match"
  ADD COLUMN "mode" "MatchMode" NOT NULL DEFAULT 'CASUAL',
  ADD COLUMN "stakeAmount" DECIMAL(12,2),
  ADD COLUMN "stakeCommission" DECIMAL(12,2),
  ADD COLUMN "ratingPool" TEXT;
-- Les anciennes parties classées deviennent RATED.
UPDATE "Match" SET "mode" = 'RATED' WHERE "rated" = true;
CREATE INDEX "Match_mode_status_idx" ON "Match"("mode", "status");


CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "action" VARCHAR(80) NOT NULL,
  "entity" VARCHAR(80) NOT NULL,
  "entityId" VARCHAR(120),
  "before" JSONB,
  "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Club" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "slug" VARCHAR(70) NOT NULL,
  "description" VARCHAR(1000),
  "ownerId" TEXT NOT NULL,
  "country" VARCHAR(80),
  "city" VARCHAR(80),
  "accentColor" VARCHAR(9),
  "isPrivate" BOOLEAN NOT NULL DEFAULT false,
  "maxMembers" INTEGER NOT NULL DEFAULT 50,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Club_name_key" ON "Club"("name");
CREATE UNIQUE INDEX "Club_slug_key" ON "Club"("slug");
CREATE INDEX "Club_ownerId_idx" ON "Club"("ownerId");
CREATE INDEX "Club_country_city_idx" ON "Club"("country", "city");
ALTER TABLE "Club" ADD CONSTRAINT "Club_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ClubMember" (
  "id" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "ClubRole" NOT NULL DEFAULT 'MEMBER',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClubMember_clubId_userId_key" ON "ClubMember"("clubId", "userId");
CREATE INDEX "ClubMember_userId_idx" ON "ClubMember"("userId");
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Tournament"
  ADD COLUMN "visibility" "TournamentVisibility" NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN "clubId" TEXT,
  ADD COLUMN "description" VARCHAR(1000);
CREATE INDEX "Tournament_clubId_idx" ON "Tournament"("clubId");
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index de performance : historique de transactions par type de solde, classements par pool.
CREATE INDEX IF NOT EXISTS "BalanceTransaction_userId_balanceType_createdAt_idx" ON "BalanceTransaction"("userId", "balanceType", "createdAt");
