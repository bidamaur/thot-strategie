import { getRequestUser } from "@/lib/auth/session";
import {
  TournamentEconomyError,
  recordValidatedTournamentResult,
} from "@/lib/economy/tournaments";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ tournamentId: string; matchId: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json(
      { error: "Connectez-vous pour enregistrer un résultat." },
      { status: 401 },
    );
  }

  const { tournamentId, matchId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("winnerId" in body) ||
    (typeof body.winnerId !== "string" && body.winnerId !== null)
  ) {
    return NextResponse.json({ error: "Vainqueur requis (ou null pour une nulle)." }, { status: 400 });
  }
  const winnerId = body.winnerId as string | null;

  try {
    const match = await prisma.tournamentMatch.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        tournamentId: true,
        playerWhiteId: true,
        playerBlackId: true,
        tournament: { select: { creatorId: true } },
        games: { where: { status: "IN_PROGRESS" }, select: { id: true }, take: 1 },
      },
    });
    if (!match || match.tournamentId !== tournamentId) {
      return NextResponse.json({ error: "Match introuvable." }, { status: 404 });
    }
    const isPlayer = currentUser.id === match.playerWhiteId || currentUser.id === match.playerBlackId;
    // Arbitre : administrateur, ou organisateur qui ne joue pas ce match.
    const isArbiter =
      currentUser.isAdmin || (currentUser.id === match.tournament.creatorId && !isPlayer);
    if (!isArbiter && !isPlayer) {
      return NextResponse.json(
        { error: "Seuls les joueurs du match, l’organisateur ou un administrateur peuvent agir sur ce résultat." },
        { status: 403 },
      );
    }
    // Un joueur ne peut que reconnaître la victoire de son adversaire.
    if (!isArbiter && (winnerId === null || winnerId === currentUser.id)) {
      return NextResponse.json(
        { error: "Vous pouvez seulement concéder la victoire à votre adversaire. Contactez l’organisateur en cas de litige." },
        { status: 403 },
      );
    }
    if (winnerId !== null && winnerId !== match.playerWhiteId && winnerId !== match.playerBlackId) {
      return NextResponse.json({ error: "Le vainqueur doit être un joueur du match." }, { status: 400 });
    }
    if (match.games[0]) {
      return NextResponse.json(
        { error: "Une partie en ligne est en cours pour ce match : son résultat sera reporté automatiquement." },
        { status: 409 },
      );
    }

    await recordValidatedTournamentResult(matchId, winnerId);
    if (isArbiter) {
      await writeAuditLog(prisma, {
        actorId: currentUser.id,
        action: "TOURNAMENT_RESULT_ARBITRATED",
        entity: "TournamentMatch",
        entityId: matchId,
        after: { winnerId, tournamentId },
      });
    }

    const updatedMatch = await prisma.tournamentMatch.findUniqueOrThrow({
      where: { id: matchId },
    });
    return NextResponse.json({ match: updatedMatch });
  } catch (error) {
    if (error instanceof TournamentEconomyError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "INSUFFICIENT_FUNDS"
            ? 402
            : error.code === "NOT_OPEN" ||
                error.code === "NOT_SETTLEABLE" ||
                error.code === "ALREADY_JOINED"
              ? 409
              : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Erreur lors de l'enregistrement du résultat :", error);
    return NextResponse.json(
      { error: "Impossible d'enregistrer le résultat." },
      { status: 500 },
    );
  }
}
