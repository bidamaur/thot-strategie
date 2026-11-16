import {
  isMockEconomyEnabled,
  mockEconomyDisabledResponse,
} from "@/lib/economy/mock-mode";
import {
  registerTournamentPlayer,
  TournamentEconomyError,
} from "@/lib/economy/tournaments";
import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings/service";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ tournamentId: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  const { tournamentId } = await params;
  const target = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { isPaid: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Tournoi introuvable." }, { status: 404 });
  }
  // Seuls les tournois payants dépendent du paiement (simulé en développement).
  if (target.isPaid) {
    if (!isMockEconomyEnabled()) return mockEconomyDisabledResponse();
    if (!(await getSetting("money.tournamentsEnabled"))) {
      return NextResponse.json(
        { error: "Les tournois payants sont momentanément fermés." },
        { status: 403 },
      );
    }
  }
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connectez-vous pour vous inscrire." }, { status: 401 });
  }

  try {
    const result = await registerTournamentPlayer(tournamentId, currentUser.id);
    return NextResponse.json({ registration: result }, { status: 201 });
  } catch (error) {
    if (error instanceof TournamentEconomyError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "INSUFFICIENT_FUNDS"
            ? 402
            : error.code === "ALREADY_JOINED" ||
                error.code === "NOT_OPEN" ||
                error.code === "FULL"
              ? 409
              : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Erreur lors de l’inscription au tournoi :", error);
    return NextResponse.json(
      { error: "Impossible de vous inscrire au tournoi." },
      { status: 500 },
    );
  }
}
