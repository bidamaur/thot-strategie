import { getRequestUser } from "@/lib/auth/session";
import { ClubError, createClub } from "@/lib/clubs/service";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const currentUser = await getRequestUser(request);
  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 60);
  const clubs = await prisma.club.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { city: { contains: q, mode: "insensitive" } },
            { country: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: [{ members: { _count: "desc" } }, { createdAt: "desc" }],
    take: 60,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      country: true,
      city: true,
      accentColor: true,
      isPrivate: true,
      maxMembers: true,
      owner: { select: { username: true } },
      _count: { select: { members: true, tournaments: true } },
    },
  });
  const myClubIds = currentUser
    ? new Set(
        (
          await prisma.clubMember.findMany({
            where: { userId: currentUser.id },
            select: { clubId: true },
          })
        ).map((m) => m.clubId),
      )
    : new Set<string>();
  return NextResponse.json({
    clubs: clubs.map((club) => ({ ...club, isMember: myClubIds.has(club.id) })),
  });
}

export async function POST(request: Request) {
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  const str = (value: unknown) => (typeof value === "string" ? value : null);
  try {
    const club = await createClub(currentUser.id, {
      name: str(body.name) ?? "",
      description: str(body.description),
      country: str(body.country),
      city: str(body.city),
      isPrivate: body.isPrivate === true,
      accentColor: str(body.accentColor),
    });
    return NextResponse.json({ club }, { status: 201 });
  } catch (error) {
    if (error instanceof ClubError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Erreur lors de la création du club :", error);
    return NextResponse.json({ error: "Impossible de créer le club." }, { status: 500 });
  }
}
