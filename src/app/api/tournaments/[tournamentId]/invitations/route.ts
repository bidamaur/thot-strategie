import {
  inviteTournamentPlayers,
  TournamentEconomyError,
} from "@/lib/economy/tournaments";
import {
  isMockEconomyEnabled,
  mockEconomyDisabledResponse,
} from "@/lib/economy/mock-mode";
import { getRequestUser } from "@/lib/auth/session";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ tournamentId: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!isMockEconomyEnabled()) return mockEconomyDisabledResponse();
  const { tournamentId } = await params;
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connectez-vous pour inviter des joueurs." }, { status: 401 });
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
  const userIds =
    typeof body === "object" &&
    body !== null &&
    "userIds" in body &&
    Array.isArray(body.userIds) &&
    body.userIds.every((userId) => typeof userId === "string")
      ? body.userIds
      : [];
  if (userIds.length === 0 || userIds.length > 63) {
    return NextResponse.json(
      { error: "Organisateur et joueurs invités requis." },
      { status: 400 },
    );
  }

  try {
    const invited = await inviteTournamentPlayers(
      tournamentId,
      currentUser.id,
      userIds,
    );
    return NextResponse.json({ invited }, { status: 201 });
  } catch (error) {
    if (error instanceof TournamentEconomyError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "NOT_OPEN"
            ? 409
            : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Erreur lors de l’envoi des invitations :", error);
    return NextResponse.json(
      { error: "Impossible d’envoyer les invitations." },
      { status: 500 },
    );
  }
}
