-- CreateEnum
CREATE TYPE "TournamentInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "MockPaymentPurpose" AS ENUM ('PREMIUM_MEMBERSHIP');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "city" VARCHAR(80),
ADD COLUMN     "country" VARCHAR(80),
ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "neighborhood" VARCHAR(80);

-- CreateTable
CREATE TABLE "TournamentInvitation" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "TournamentInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "TournamentInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "MockPaymentPurpose" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "referenceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TournamentInvitation_userId_status_idx" ON "TournamentInvitation"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentInvitation_tournamentId_userId_key" ON "TournamentInvitation"("tournamentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MockPayment_referenceId_key" ON "MockPayment"("referenceId");

-- CreateIndex
CREATE INDEX "MockPayment_userId_createdAt_idx" ON "MockPayment"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TournamentInvitation" ADD CONSTRAINT "TournamentInvitation_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentInvitation" ADD CONSTRAINT "TournamentInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockPayment" ADD CONSTRAINT "MockPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
