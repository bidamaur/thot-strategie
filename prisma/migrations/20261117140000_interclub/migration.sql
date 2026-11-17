-- Rencontres interclubs : ajouts uniquement.

-- CreateEnum
CREATE TYPE "ClubMatchStatus" AS ENUM ('PROPOSED', 'LINEUP', 'IN_PROGRESS', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ClubMatch" (
    "id" TEXT NOT NULL,
    "homeClubId" TEXT NOT NULL,
    "awayClubId" TEXT NOT NULL,
    "proposedById" TEXT NOT NULL,
    "boards" INTEGER NOT NULL,
    "gameType" "GameType" NOT NULL,
    "draughtsVariant" "DraughtsVariant",
    "timeControlMinutes" INTEGER,
    "mode" "MatchMode" NOT NULL DEFAULT 'CASUAL',
    "message" VARCHAR(300),
    "status" "ClubMatchStatus" NOT NULL DEFAULT 'PROPOSED',
    "homeScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "awayScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "winnerClubId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubMatchBoard" (
    "id" TEXT NOT NULL,
    "clubMatchId" TEXT NOT NULL,
    "board" INTEGER NOT NULL,
    "homePlayerId" TEXT,
    "awayPlayerId" TEXT,
    "homeIsWhite" BOOLEAN NOT NULL,
    "matchId" TEXT,
    "result" VARCHAR(5),

    CONSTRAINT "ClubMatchBoard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubMatch_homeClubId_status_idx" ON "ClubMatch"("homeClubId", "status");

-- CreateIndex
CREATE INDEX "ClubMatch_awayClubId_status_idx" ON "ClubMatch"("awayClubId", "status");

-- CreateIndex
CREATE INDEX "ClubMatch_status_expiresAt_idx" ON "ClubMatch"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClubMatchBoard_matchId_key" ON "ClubMatchBoard"("matchId");

-- CreateIndex
CREATE INDEX "ClubMatchBoard_homePlayerId_idx" ON "ClubMatchBoard"("homePlayerId");

-- CreateIndex
CREATE INDEX "ClubMatchBoard_awayPlayerId_idx" ON "ClubMatchBoard"("awayPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "ClubMatchBoard_clubMatchId_board_key" ON "ClubMatchBoard"("clubMatchId", "board");

-- AddForeignKey
ALTER TABLE "ClubMatch" ADD CONSTRAINT "ClubMatch_homeClubId_fkey" FOREIGN KEY ("homeClubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMatch" ADD CONSTRAINT "ClubMatch_awayClubId_fkey" FOREIGN KEY ("awayClubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMatch" ADD CONSTRAINT "ClubMatch_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMatchBoard" ADD CONSTRAINT "ClubMatchBoard_clubMatchId_fkey" FOREIGN KEY ("clubMatchId") REFERENCES "ClubMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMatchBoard" ADD CONSTRAINT "ClubMatchBoard_homePlayerId_fkey" FOREIGN KEY ("homePlayerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMatchBoard" ADD CONSTRAINT "ClubMatchBoard_awayPlayerId_fkey" FOREIGN KEY ("awayPlayerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMatchBoard" ADD CONSTRAINT "ClubMatchBoard_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ClubMatch" ADD CONSTRAINT "ClubMatch_distinct_clubs" CHECK ("homeClubId" <> "awayClubId");
ALTER TABLE "ClubMatch" ADD CONSTRAINT "ClubMatch_boards_range" CHECK ("boards" BETWEEN 1 AND 20);
