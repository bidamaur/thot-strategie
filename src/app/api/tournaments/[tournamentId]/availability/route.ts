import { NextResponse } from "next/server";
import { tournamentAvailability } from "@/lib/availability/service";
import { apiRoute, ID } from "@/lib/monetization/http";

/** Synthèse des disponibilités des participants (nombres uniquement), dans le fuseau du lecteur. */
export async function GET(request: Request, { params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params;
  return apiRoute(request, async (user) => {
    if (!ID.test(tournamentId)) return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 });
    const tz = new URL(request.url).searchParams.get("tz");
    return tournamentAvailability(tournamentId, { id: user!.id, isAdmin: user!.isAdmin }, tz);
  });
}
