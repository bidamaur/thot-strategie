-- Retour arrière manuel (à exécuter seulement si le module doit être retiré ; supprime les données communautaires).
DROP TABLE IF EXISTS "ClubInvitation", "CommunitySanction", "CommunityReport", "Notification", "FriendChallenge",
  "CommunityReaction", "CommunityComment", "CommunityPost", "CommunityRoomMember", "CommunityRoom", "UserBlock", "Friendship" CASCADE;
ALTER TABLE "TournamentInvitation" DROP COLUMN IF EXISTS "invitedById";
ALTER TABLE "Club" DROP COLUMN IF EXISTS "logo";
ALTER TABLE "User" DROP COLUMN IF EXISTS "lastSeenAt", DROP COLUMN IF EXISTS "notificationPrefs", DROP COLUMN IF EXISTS "privacySettings";
DROP TYPE IF EXISTS "FriendshipStatus", "CommunityRoomVisibility", "CommunityPostPermission", "CommunityRoomRole", "CommunityLinkType",
  "CommunityReactionType", "FriendChallengeStatus", "CommunityReportTarget", "CommunityReportStatus", "CommunitySanctionType";
