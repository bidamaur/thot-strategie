import { MatchStatus } from "@/generated/prisma-client";
import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { connection, NextResponse } from "next/server";

const RECONNECT_GRACE_MS = 60_000;

export async function GET(request: Request) {
  try {
    await connection();
  } catch {
    // Ignore connection errors; the request can proceed without it.
  }
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
    }

    const match = await prisma.match.findFirst({
      where: {
        status: MatchStatus.IN_PROGRESS,
        OR: [{ playerWhiteId: user.id }, { playerBlackId: user.id }],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        gameType: true,
        disconnectedPlayerId: true,
        disconnectedAt: true,
        playerWhiteId: true,
        playerWhite: { select: { username: true } },
        playerBlackId: true,
        playerBlack: { select: { username: true } },
      },
    });

    if (!match || !match.playerBlackId || !match.playerBlack) {
      return NextResponse.json({ match: null });
    }

    const opponentIsWhite = match.playerWhiteId !== user.id;
    const opponentUsername = opponentIsWhite
      ? match.playerWhite.username
      : match.playerBlack.username;

    return NextResponse.json(
      {
        match: {
          matchId: match.id,
          gameType: match.gameType,
          opponentUsername,
          disconnectedAt: match.disconnectedAt?.toISOString() ?? null,
          opponentDisconnected: match.disconnectedPlayerId !== null &&
            match.disconnectedPlayerId !== user.id,
          gracePeriodMs: RECONNECT_GRACE_MS,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Erreur lors de la recherche d’une partie active :", error);
    return NextResponse.json(
      { error: "Impossible de rechercher votre partie en cours." },
      { status: 500 },
    );
  }
}
