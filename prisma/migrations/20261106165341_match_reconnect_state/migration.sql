-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "disconnectedAt" TIMESTAMP(3),
ADD COLUMN     "disconnectedPlayerId" TEXT;
