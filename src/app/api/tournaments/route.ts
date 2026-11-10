import { TournamentScope } from "@/generated/prisma-client";
import {
  createTournament,
  TournamentEconomyError,
} from "@/lib/economy/tournaments";
import {
  isMockEconomyEnabled,
  mockEconomyDisabledResponse,
} from "@/lib/economy/mock-mode";
import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const SCOPES = new Set<TournamentScope>(Object.values(TournamentScope));

export async function GET(request: Request) {
  try {
    const currentUser = await getRequestUser(request);
    const tournaments = await prisma.tournament.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        creator: { select: { id: true, username: true } },
        _count: { select: { participants: true } },
        invitations: currentUser
          ? {
              where: { userId: currentUser.id },
              select: { id: true, userId: true, status: true },
            }
          : false,
      },
    });
    return NextResponse.json({
      tournaments: tournaments.map((tournament) => ({
        ...tournament,
        entryFee: tournament.entryFee.toString(),
        totalPrizePool: tournament.totalPrizePool.toString(),
        platformFee: tournament.platformFee.toString(),
      })),
    });
  } catch (error) {
    console.error("Erreur lors de la lecture des tournois :", error);
    return NextResponse.json(
      { error: "Impossible de charger les tournois." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isMockEconomyEnabled()) return mockEconomyDisabledResponse();
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connectez-vous pour créer un tournoi." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Le corps de la requête doit être un JSON valide." },
      { status: 400 },
    );
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Données de tournoi invalides." }, { status: 400 });
  }

  const { scope, isPaid, entryFeeCfa, entryPoints, maxPlayers } =
    body as Record<string, unknown>;
  const inviteUserIds =
    "inviteUserIds" in body &&
    Array.isArray(body.inviteUserIds) &&
    body.inviteUserIds.every((userId) => typeof userId === "string")
      ? body.inviteUserIds
      : undefined;
  if (
    typeof scope !== "string" ||
    !SCOPES.has(scope as TournamentScope) ||
    typeof isPaid !== "boolean" ||
    typeof entryFeeCfa !== "number" ||
    typeof entryPoints !== "number" ||
    typeof maxPlayers !== "number" ||
    ("inviteUserIds" in body && !inviteUserIds)
  ) {
    return NextResponse.json(
      { error: "Créateur, portée, catégorie, droit d’entrée et quota requis." },
      { status: 400 },
    );
  }

  try {
    const tournament = await createTournament({
      creatorId: currentUser.id,
      scope: scope as TournamentScope,
      isPaid,
      entryFeeCfa,
      entryPoints,
      maxPlayers,
      ...(inviteUserIds ? { invitedUserIds: inviteUserIds } : {}),
    });
    return NextResponse.json(
      {
        tournament: {
          ...tournament,
          entryFee: tournament.entryFee.toString(),
          totalPrizePool: tournament.totalPrizePool.toString(),
          platformFee: tournament.platformFee.toString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof TournamentEconomyError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "PREMIUM_REQUIRED"
            ? 403
            : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Erreur lors de la création du tournoi :", error);
    return NextResponse.json(
      { error: "Impossible de créer le tournoi." },
      { status: 500 },
    );
  }
}
