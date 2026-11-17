import { activeSanctions, CommunityError, requireActor } from "@/lib/community/core";
import { communityRoute, readJson, stringList } from "@/lib/community/http";
import { readPreferences, savePreferences } from "@/lib/community/notifications";
import { getOwnSettings, updateCommunityProfile } from "@/lib/community/profile";
import { prisma } from "@/lib/prisma";
import { getPrivileges } from "@/lib/premium/privileges";

/** Paramètres communautaires du joueur : présentation, confidentialité, notifications, privilèges. */
export async function GET(request: Request) {
  return communityRoute(request, async (user) => {
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: user!.id },
      select: { username: true, notificationPrefs: true, isAdmin: true, isPremium: true, premiumLevel: true, premiumExpiresAt: true },
    });
    const [settings, sanctions, { privileges, tier }] = await Promise.all([getOwnSettings(user!.id), activeSanctions(user!.id), getPrivileges(me)]);
    return {
      username: me.username,
      ...settings,
      notifications: readPreferences(me.notificationPrefs),
      restrictions: sanctions.map((s) => ({ type: s.type, expiresAt: s.expiresAt?.toISOString() ?? null })),
      premium: {
        tier: tier.name,
        privateRooms: privileges.privateRooms ?? 0,
        pinInOwnSpaces: privileges.pinInOwnSpaces ?? false,
        communityStats: privileges.communityStats ?? false,
        maxBulkInvites: privileges.maxBulkInvites ?? 5,
        clubCustomization: privileges.clubCustomization ?? false,
        profileThemes: privileges.profileThemes,
      },
    };
  });
}

export async function PATCH(request: Request) {
  return communityRoute(request, async (user) => {
    await requireActor(user!.id, "read");
    const body = await readJson(request);
    if (body.disabledNotifications !== undefined) {
      if (!Array.isArray(body.disabledNotifications)) throw new CommunityError("Préférences invalides.", 400);
      await savePreferences(user!.id, stringList(body.disabledNotifications, 50));
    }
    if (body.bio !== undefined || body.privacy !== undefined) {
      await updateCommunityProfile(user!.id, { bio: body.bio, privacy: body.privacy });
    }
    return { ok: true };
  });
}
