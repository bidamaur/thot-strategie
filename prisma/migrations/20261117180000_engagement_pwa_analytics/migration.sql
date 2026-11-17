-- Engagement, PWA, mesure d'audience : migration additive.

-- AlterEnum
ALTER TYPE "BalanceTransactionType" ADD VALUE IF NOT EXISTS 'OBJECTIVE_REWARD';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "engagement" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(48) NOT NULL,
    "userId" TEXT,
    "anonId" VARCHAR(40),
    "device" VARCHAR(12),
    "standalone" BOOLEAN NOT NULL DEFAULT false,
    "experiment" VARCHAR(40),
    "variant" VARCHAR(16),
    "props" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_name_createdAt_idx" ON "AnalyticsEvent"("name", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_createdAt_idx" ON "AnalyticsEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_experiment_variant_idx" ON "AnalyticsEvent"("experiment", "variant");

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
