ALTER TYPE "TournamentScope" ADD VALUE IF NOT EXISTS 'REGION';
ALTER TYPE "TournamentScope" ADD VALUE IF NOT EXISTS 'INTERNATIONAL';

ALTER TABLE "Tournament"
ADD COLUMN "name" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "region" TEXT,
ADD COLUMN "country" TEXT,
ADD COLUMN "continent" TEXT;

UPDATE "Tournament" AS tournament
SET "name" = 'Tournoi de ' || creator."username"
FROM "User" AS creator
WHERE creator."id" = tournament."creatorId";

ALTER TABLE "Tournament"
ALTER COLUMN "name" SET DEFAULT 'Tournoi communautaire',
ALTER COLUMN "name" SET NOT NULL;
