-- Module communautaire : ajouts uniquement (aucune table ni colonne existante modifiée ou supprimée).

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommunityRoomVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "CommunityPostPermission" AS ENUM ('EVERYONE', 'MEMBERS', 'MODERATORS');

-- CreateEnum
CREATE TYPE "CommunityRoomRole" AS ENUM ('OWNER', 'MODERATOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "CommunityLinkType" AS ENUM ('TOURNAMENT', 'CLUB');

-- CreateEnum
CREATE TYPE "CommunityReactionType" AS ENUM ('LIKE', 'BRAVO', 'INTERESTING', 'CONGRATS');

-- CreateEnum
CREATE TYPE "FriendChallengeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CommunityReportTarget" AS ENUM ('POST', 'COMMENT', 'USER');

-- CreateEnum
CREATE TYPE "CommunityReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "CommunitySanctionType" AS ENUM ('WARNING', 'MUTE', 'SUSPENSION');

-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "logo" VARCHAR(300);

-- AlterTable
ALTER TABLE "TournamentInvitation" ADD COLUMN     "invitedById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "notificationPrefs" JSONB,
ADD COLUMN     "privacySettings" JSONB;

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "addresseeId" TEXT NOT NULL,
    "pairKey" VARCHAR(80) NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "requesterFavorite" BOOLEAN NOT NULL DEFAULT false,
    "addresseeFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityRoom" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300),
    "icon" VARCHAR(20),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "visibility" "CommunityRoomVisibility" NOT NULL DEFAULT 'PUBLIC',
    "postPermission" "CommunityPostPermission" NOT NULL DEFAULT 'EVERYONE',
    "commentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityRoomMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CommunityRoomRole" NOT NULL DEFAULT 'MEMBER',
    "follow" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityRoomMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityPost" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "roomId" TEXT,
    "clubId" TEXT,
    "title" VARCHAR(140),
    "body" TEXT NOT NULL,
    "imageUrl" VARCHAR(300),
    "linkType" "CommunityLinkType",
    "linkId" VARCHAR(40),
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "reactionCount" INTEGER NOT NULL DEFAULT 0,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" VARCHAR(2000) NOT NULL,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "reactionCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityReaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT,
    "commentId" TEXT,
    "type" "CommunityReactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FriendChallenge" (
    "id" TEXT NOT NULL,
    "challengerId" TEXT NOT NULL,
    "challengedId" TEXT NOT NULL,
    "gameType" "GameType" NOT NULL,
    "draughtsVariant" "DraughtsVariant",
    "timeControlMinutes" INTEGER,
    "mode" "MatchMode" NOT NULL DEFAULT 'CASUAL',
    "stakeAmount" INTEGER,
    "challengerColor" VARCHAR(6) NOT NULL DEFAULT 'random',
    "message" VARCHAR(200),
    "status" "FriendChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "matchId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "actorId" TEXT,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(300),
    "link" VARCHAR(300),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" "CommunityReportTarget" NOT NULL,
    "postId" TEXT,
    "commentId" TEXT,
    "targetUserId" TEXT,
    "reason" VARCHAR(40) NOT NULL,
    "details" VARCHAR(500),
    "status" "CommunityReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolution" VARCHAR(300),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunitySanction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CommunitySanctionType" NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "issuedById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunitySanction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubInvitation" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" "TournamentInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ClubInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_pairKey_key" ON "Friendship"("pairKey");

-- CreateIndex
CREATE INDEX "Friendship_requesterId_status_idx" ON "Friendship"("requesterId", "status");

-- CreateIndex
CREATE INDEX "Friendship_addresseeId_status_idx" ON "Friendship"("addresseeId", "status");

-- CreateIndex
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBlock_blockerId_blockedId_key" ON "UserBlock"("blockerId", "blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityRoom_slug_key" ON "CommunityRoom"("slug");

-- CreateIndex
CREATE INDEX "CommunityRoom_isActive_sortOrder_idx" ON "CommunityRoom"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "CommunityRoom_ownerId_idx" ON "CommunityRoom"("ownerId");

-- CreateIndex
CREATE INDEX "CommunityRoomMember_userId_idx" ON "CommunityRoomMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityRoomMember_roomId_userId_key" ON "CommunityRoomMember"("roomId", "userId");

-- CreateIndex
CREATE INDEX "CommunityPost_createdAt_idx" ON "CommunityPost"("createdAt");

-- CreateIndex
CREATE INDEX "CommunityPost_roomId_createdAt_idx" ON "CommunityPost"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityPost_clubId_createdAt_idx" ON "CommunityPost"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityPost_authorId_createdAt_idx" ON "CommunityPost"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityComment_postId_parentId_createdAt_idx" ON "CommunityComment"("postId", "parentId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityComment_authorId_createdAt_idx" ON "CommunityComment"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityReaction_postId_idx" ON "CommunityReaction"("postId");

-- CreateIndex
CREATE INDEX "CommunityReaction_commentId_idx" ON "CommunityReaction"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityReaction_userId_postId_key" ON "CommunityReaction"("userId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityReaction_userId_commentId_key" ON "CommunityReaction"("userId", "commentId");

-- CreateIndex
CREATE UNIQUE INDEX "FriendChallenge_matchId_key" ON "FriendChallenge"("matchId");

-- CreateIndex
CREATE INDEX "FriendChallenge_challengedId_status_idx" ON "FriendChallenge"("challengedId", "status");

-- CreateIndex
CREATE INDEX "FriendChallenge_challengerId_status_idx" ON "FriendChallenge"("challengerId", "status");

-- CreateIndex
CREATE INDEX "FriendChallenge_status_expiresAt_idx" ON "FriendChallenge"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "CommunityReport_status_createdAt_idx" ON "CommunityReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityReport_targetUserId_idx" ON "CommunityReport"("targetUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityReport_reporterId_postId_key" ON "CommunityReport"("reporterId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityReport_reporterId_commentId_key" ON "CommunityReport"("reporterId", "commentId");

-- CreateIndex
CREATE INDEX "CommunitySanction_userId_type_idx" ON "CommunitySanction"("userId", "type");

-- CreateIndex
CREATE INDEX "ClubInvitation_userId_status_idx" ON "ClubInvitation"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClubInvitation_clubId_userId_key" ON "ClubInvitation"("clubId", "userId");

-- AddForeignKey
ALTER TABLE "TournamentInvitation" ADD CONSTRAINT "TournamentInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityRoom" ADD CONSTRAINT "CommunityRoom_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityRoomMember" ADD CONSTRAINT "CommunityRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CommunityRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityRoomMember" ADD CONSTRAINT "CommunityRoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CommunityRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CommunityComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityReaction" ADD CONSTRAINT "CommunityReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityReaction" ADD CONSTRAINT "CommunityReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityReaction" ADD CONSTRAINT "CommunityReaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "CommunityComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendChallenge" ADD CONSTRAINT "FriendChallenge_challengerId_fkey" FOREIGN KEY ("challengerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendChallenge" ADD CONSTRAINT "FriendChallenge_challengedId_fkey" FOREIGN KEY ("challengedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendChallenge" ADD CONSTRAINT "FriendChallenge_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "CommunityComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunitySanction" ADD CONSTRAINT "CommunitySanction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunitySanction" ADD CONSTRAINT "CommunitySanction_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubInvitation" ADD CONSTRAINT "ClubInvitation_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubInvitation" ADD CONSTRAINT "ClubInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubInvitation" ADD CONSTRAINT "ClubInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Intégrité : pas de relation avec soi-même.
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_not_self" CHECK ("requesterId" <> "addresseeId");
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_not_self" CHECK ("blockerId" <> "blockedId");
ALTER TABLE "FriendChallenge" ADD CONSTRAINT "FriendChallenge_not_self" CHECK ("challengerId" <> "challengedId");
ALTER TABLE "FriendChallenge" ADD CONSTRAINT "FriendChallenge_stake_positive" CHECK ("stakeAmount" IS NULL OR "stakeAmount" > 0);
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_counters" CHECK ("commentCount" >= 0 AND "reactionCount" >= 0);
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_counters" CHECK ("reactionCount" >= 0 AND "replyCount" >= 0);
ALTER TABLE "CommunityReaction" ADD CONSTRAINT "CommunityReaction_one_target" CHECK (("postId" IS NULL) <> ("commentId" IS NULL));

-- Salons initiaux (servent aussi de catégories de publication ; modifiables dans l'administration).
INSERT INTO "CommunityRoom" ("id", "slug", "name", "description", "icon", "sortOrder", "updatedAt") VALUES
  ('room_general',   'general',    'Général',                 'Présentations, discussions libres et vie de la plateforme.', 'chat', 10, CURRENT_TIMESTAMP),
  ('room_echecs',    'echecs',     'Échecs',                  'Ouvertures, parties commentées, problèmes.',                  'chess', 20, CURRENT_TIMESTAMP),
  ('room_dames',     'dames',      'Dames',                   'Dames internationales et anglaises : coups, finales, combinaisons.', 'draughts', 30, CURRENT_TIMESTAMP),
  ('room_defis',     'defis',      'Défis',                   'Cherchez un adversaire, lancez un défi.',                     'swords', 40, CURRENT_TIMESTAMP),
  ('room_tournois',  'tournois',   'Tournois',                'Annonces et retours sur les tournois.',                       'trophy', 50, CURRENT_TIMESTAMP),
  ('room_clubs',     'clubs',      'Clubs',                   'Recrutement, rencontres interclubs.',                         'shield', 60, CURRENT_TIMESTAMP),
  ('room_conseils',  'conseils',   'Conseils et stratégies',  'Apprendre et progresser ensemble.',                           'target', 70, CURRENT_TIMESTAMP),
  ('room_actus',     'actualites', 'Actualités',              'Nouvelles de la plateforme et du monde des échecs et des dames.', 'news', 80, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
UPDATE "CommunityRoom" SET "postPermission" = 'MODERATORS' WHERE "slug" = 'actualites';
