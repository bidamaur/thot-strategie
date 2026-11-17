import { writeAuditLog } from "@/lib/audit";
import { actorPrivileges, CommunityError, requireActor } from "@/lib/community/core";
import { communityRoute } from "@/lib/community/http";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings/service";
import { deleteByUrl } from "@/lib/storage";
import { saveImage } from "@/lib/uploads";

interface Ctx {
  params: Promise<{ slug: string }>;
}

/** Personnalisation de la page de club (logo, couleur) : fondateur avec le privilège Premium, ou administrateur. */
export async function POST(request: Request, { params }: Ctx) {
  const { slug } = await params;
  return communityRoute(request, async (user) => {
    const actor = await requireActor(user!.id, "read");
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, ownerId: true, logo: true } });
    if (!club) throw new CommunityError("Club introuvable.", 404);
    if (club.ownerId !== actor.id && !actor.isAdmin) throw new CommunityError("Seul le fondateur personnalise le club.", 403);
    const privileges = await actorPrivileges(actor);
    if (!privileges.clubCustomization) throw new CommunityError("La personnalisation du club est un privilège Premium.", 403);

    const form = await request.formData().catch(() => null);
    const file = form?.get("logo");
    const accent = form?.get("accentColor");
    const data: { logo?: string; accentColor?: string } = {};
    if (file instanceof File && file.size > 0) {
      const maxKb = await getSetting("community.imageMaxKb");
      data.logo = await saveImage(file, { kind: "logo", prefix: club.id, maxBytes: maxKb * 1024 });
    }
    if (typeof accent === "string" && accent) {
      if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw new CommunityError("Couleur invalide.", 400);
      data.accentColor = accent;
    }
    if (!data.logo && !data.accentColor) throw new CommunityError("Rien à modifier.", 400);
    await prisma.$transaction(async (tx) => {
      await tx.club.update({ where: { id: club.id }, data });
      await writeAuditLog(tx, { actorId: actor.id, action: "CLUB_CUSTOMIZED", entity: "Club", entityId: club.id, after: data });
    });
    if (data.logo) await deleteByUrl(club.logo);
    return data;
  });
}
