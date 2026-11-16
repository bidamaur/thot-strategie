import { getRequestUser } from "@/lib/auth/session";
import { ClubError, joinClub, leaveClub, removeMember, setMemberRole } from "@/lib/clubs/service";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  const { slug } = await params;
  const currentUser = await getRequestUser(request);
  const club = await prisma.club.findUnique({
    where: { slug },
    include: {
      owner: { select: { id: true, username: true } },
      members: {
        orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
        take: 500,
        include: { user: { select: { id: true, username: true, elo: true, avatar: true, country: true } } },
      },
      tournaments: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, name: true, status: true, type: true, maxPlayers: true, _count: { select: { participants: true } } },
      },
    },
  });
  if (!club) return NextResponse.json({ error: "Club introuvable." }, { status: 404 });
  const me = currentUser ? club.members.find((m) => m.userId === currentUser.id) : undefined;
  if (club.isPrivate && !me && !currentUser?.isAdmin) {
    return NextResponse.json({ error: "Ce club est privé." }, { status: 403 });
  }
  // Classement interne : membres triés par ELO.
  const ranking = [...club.members]
    .sort((a, b) => b.user.elo - a.user.elo)
    .map((m, index) => ({ position: index + 1, userId: m.userId, username: m.user.username, elo: m.user.elo }));
  return NextResponse.json({
    club: {
      ...club,
      members: club.members.map((m) => ({ role: m.role, joinedAt: m.joinedAt, user: m.user })),
    },
    ranking,
    myRole: me?.role ?? null,
  });
}

/** Actions : { action: "join" | "leave" | "setRole" | "remove", userId?, role? } */
export async function POST(request: Request, { params }: RouteContext) {
  const { slug } = await params;
  const currentUser = await getRequestUser(request);
  if (!currentUser) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  let body: { action?: unknown; userId?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  try {
    switch (body.action) {
      case "join":
        await joinClub(currentUser.id, slug);
        break;
      case "leave":
        await leaveClub(currentUser.id, slug);
        break;
      case "setRole":
        if (typeof body.userId !== "string" || (body.role !== "ADMIN" && body.role !== "MEMBER")) {
          return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
        }
        await setMemberRole(currentUser.id, slug, body.userId, body.role);
        break;
      case "remove":
        if (typeof body.userId !== "string") {
          return NextResponse.json({ error: "Membre requis." }, { status: 400 });
        }
        await removeMember(currentUser.id, slug, body.userId);
        break;
      default:
        return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ClubError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Erreur club :", error);
    return NextResponse.json({ error: "Action impossible." }, { status: 500 });
  }
}
