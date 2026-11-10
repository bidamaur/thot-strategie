-- CreateTable
CREATE TABLE "AiGameReward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "gameType" "GameType" NOT NULL,
    "difficulty" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGameReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiGameReward_createdAt_idx" ON "AiGameReward"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiGameReward_userId_gameId_key" ON "AiGameReward"("userId", "gameId");

-- AddForeignKey
ALTER TABLE "AiGameReward" ADD CONSTRAINT "AiGameReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
