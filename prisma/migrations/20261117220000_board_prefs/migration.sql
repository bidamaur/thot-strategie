-- Préférences de plateau : migration additive.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "boardPrefs" JSONB NOT NULL DEFAULT '{}';
