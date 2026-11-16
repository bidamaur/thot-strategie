import { ClubRole, Prisma } from "@/generated/prisma-client";
import { writeAuditLog } from "@/lib/audit";
import { getPrivileges } from "@/lib/premium/privileges";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";

export class ClubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ClubError";
  }
}

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function createClub(
  userId: string,
  input: { name: string; description?: string | null; country?: string | null; city?: string | null; isPrivate?: boolean; accentColor?: string | null },
) {
  const name = input.name.trim();
  if (name.length < 3 || name.length > 60) {
    throw new ClubError("Le nom du club doit contenir entre 3 et 60 caractères.", 400);
  }
  const slug = slugify(name);
  if (slug.length < 3) throw new ClubError("Nom de club invalide.", 400);
  if (input.accentColor && !/^#[0-9a-fA-F]{6}$/.test(input.accentColor)) {
    throw new ClubError("Couleur invalide (format #RRGGBB).", 400);
  }

  const [settings, user] = await Promise.all([
    getSettings(["clubs.enabled", "clubs.minPointsToCreate", "clubs.defaultMaxMembers"] as const),
    prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true, isPremium: true, premiumLevel: true, premiumExpiresAt: true, pointsFree: true },
    }),
  ]);
  if (!user) throw new ClubError("Profil introuvable.", 404);
  if (!settings["clubs.enabled"]) throw new ClubError("La création de clubs est désactivée.", 403);

  const { privileges } = await getPrivileges(user);
  const minPoints = settings["clubs.minPointsToCreate"];
  const viaPremium = privileges.clubCreate;
  const viaPoints = minPoints > 0 && user.pointsFree >= minPoints;
  if (!viaPremium && !viaPoints) {
    throw new ClubError(
      minPoints > 0
        ? `Créer un club nécessite un abonnement Premium ou ${minPoints} points classiques.`
        : "Créer un club nécessite un abonnement Premium.",
      403,
    );
  }
  const maxOwned = viaPremium ? privileges.maxClubsOwned : 1;
  const owned = await prisma.club.count({ where: { ownerId: userId } });
  if (owned >= maxOwned) {
    throw new ClubError(`Vous possédez déjà ${owned} club(s) : limite atteinte pour votre niveau.`, 403);
  }
  const maxMembers = viaPremium ? privileges.maxClubMembers : settings["clubs.defaultMaxMembers"];

  try {
    return await prisma.$transaction(async (tx) => {
      const club = await tx.club.create({
        data: {
          name,
          slug,
          description: input.description?.trim().slice(0, 1000) || null,
          country: input.country?.trim().slice(0, 80) || null,
          city: input.city?.trim().slice(0, 80) || null,
          isPrivate: Boolean(input.isPrivate) && privileges.privateTournaments,
          accentColor: privileges.customTournamentBranding ? input.accentColor ?? null : null,
          maxMembers,
          ownerId: userId,
          members: { create: { userId, role: ClubRole.OWNER } },
        },
      });
      await writeAuditLog(tx, { actorId: userId, action: "CLUB_CREATED", entity: "Club", entityId: club.id, after: { name, slug } });
      return club;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ClubError("Ce nom de club est déjà pris.", 409);
    }
    throw error;
  }
}

export async function joinClub(userId: string, slug: string) {
  return prisma.$transaction(
    async (tx) => {
      const club = await tx.club.findUnique({
        where: { slug },
        select: { id: true, isPrivate: true, maxMembers: true, _count: { select: { members: true } } },
      });
      if (!club) throw new ClubError("Club introuvable.", 404);
      if (club.isPrivate) throw new ClubError("Ce club est privé : rejoignez-le sur invitation.", 403);
      if (club._count.members >= club.maxMembers) throw new ClubError("Le club est complet.", 409);
      try {
        await tx.clubMember.create({ data: { clubId: club.id, userId } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ClubError("Vous êtes déjà membre de ce club.", 409);
        }
        throw error;
      }
      return { clubId: club.id };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function leaveClub(userId: string, slug: string) {
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, ownerId: true } });
  if (!club) throw new ClubError("Club introuvable.", 404);
  if (club.ownerId === userId) {
    throw new ClubError("Le fondateur ne peut pas quitter son club (transférez-le d’abord).", 400);
  }
  const removed = await prisma.clubMember.deleteMany({ where: { clubId: club.id, userId } });
  if (removed.count === 0) throw new ClubError("Vous n’êtes pas membre de ce club.", 404);
}

export async function setMemberRole(actorId: string, slug: string, memberUserId: string, role: "ADMIN" | "MEMBER") {
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, ownerId: true } });
  if (!club) throw new ClubError("Club introuvable.", 404);
  if (club.ownerId !== actorId) throw new ClubError("Seul le fondateur peut gérer les rôles.", 403);
  if (memberUserId === club.ownerId) throw new ClubError("Le rôle du fondateur ne peut pas changer.", 400);
  const updated = await prisma.clubMember.updateMany({
    where: { clubId: club.id, userId: memberUserId },
    data: { role },
  });
  if (updated.count === 0) throw new ClubError("Membre introuvable.", 404);
}

export async function removeMember(actorId: string, slug: string, memberUserId: string) {
  const club = await prisma.club.findUnique({
    where: { slug },
    select: { id: true, ownerId: true, members: { where: { userId: actorId }, select: { role: true } } },
  });
  if (!club) throw new ClubError("Club introuvable.", 404);
  const actorRole = club.members[0]?.role;
  if (actorRole !== ClubRole.OWNER && actorRole !== ClubRole.ADMIN) {
    throw new ClubError("Action réservée aux responsables du club.", 403);
  }
  if (memberUserId === club.ownerId) throw new ClubError("Le fondateur ne peut pas être exclu.", 400);
  await prisma.clubMember.deleteMany({ where: { clubId: club.id, userId: memberUserId } });
}
