-- CreateEnum
CREATE TYPE "DraughtsVariant" AS ENUM ('ENGLISH', 'INTERNATIONAL');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "draughtsVariant" "DraughtsVariant" NOT NULL DEFAULT 'INTERNATIONAL';
