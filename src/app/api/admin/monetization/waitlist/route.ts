import { NextResponse } from "next/server";
import { apiRoute, readJson } from "@/lib/monetization/http";
import { notifyWaitlist } from "@/lib/monetization/interest";

/** Prévient la liste d'attente (au lancement). Une seule notification par joueur. */
export async function POST(request: Request) {
  return apiRoute(
    request,
    async (admin) => {
      const body = await readJson(request);
      if (body.confirm !== true) return NextResponse.json({ error: "Confirmation requise." }, { status: 400 });
      return notifyWaitlist(admin!.id);
    },
    "admin",
  );
}
