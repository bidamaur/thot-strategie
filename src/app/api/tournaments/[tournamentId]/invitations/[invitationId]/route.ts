import {
  respondToTournamentInvitation,
  TournamentEconomyError,
} from "@/lib/economy/tournaments";
import {
  isMockEconomyEnabled,
  mockEconomyDisabledResponse,
} from "@/lib/economy/mock-mode";
import { getRequestUser } from "@/lib/auth/session";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ tournamentId: string; invitationId: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!isMockEconomyEnabled()) return mockEconomyDisabledResponse();
  const { tournamentId, invitationId } = await params;
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connectez-vous pour répondre à l’invitation." }, { status: 401 });
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
    return NextResponse.json({ error: "Réponse invalide." }, { status: 400 });
  }
  const decision =
    "decision" in body && typeof body.decision === "string"
      ? body.decision
      : "";
  if (decision !== "accept" && decision !== "decline") {
    return NextResponse.json(
      { error: "Profil ou réponse à l’invitation invalide." },
      { status: 400 },
    );
  }

  try {
    const response = await respondToTournamentInvitation(
      tournamentId,
      invitationId,
      currentUser.id,
      decision === "accept",
    );
    return NextResponse.json({ response });
  } catch (error) {
    if (error instanceof TournamentEconomyError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "INSUFFICIENT_FUNDS"
            ? 402
            : error.code === "NOT_OPEN" ||
                error.code === "ALREADY_JOINED" ||
                error.code === "FULL"
              ? 409
              : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Erreur lors de la réponse à l’invitation :", error);
    return NextResponse.json(
      { error: "Impossible de répondre à l’invitation." },
      { status: 500 },
    );
  }
}
