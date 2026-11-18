-- Demandes de sortie de partie : migration additive.

-- CreateTable
CREATE TABLE "GameExitRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "returnPath" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "GameExitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameExitRequest_targetId_status_idx" ON "GameExitRequest"("targetId", "status");

-- CreateIndex
CREATE INDEX "GameExitRequest_requesterId_createdAt_idx" ON "GameExitRequest"("requesterId", "createdAt");

-- AddForeignKey
ALTER TABLE "GameExitRequest" ADD CONSTRAINT "GameExitRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameExitRequest" ADD CONSTRAINT "GameExitRequest_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
