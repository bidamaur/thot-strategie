import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/session";
import { GameExitError } from "./service";

type SessionUser = NonNullable<Awaited<ReturnType<typeof getRequestUser>>>;

/** Exécute une action de sortie de partie pour le joueur connecté et convertit les erreurs métier. */
export async function exitRoute(request: Request, handler: (user: SessionUser) => Promise<unknown>) {
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
    const result = await handler(user);
    return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GameExitError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Sortie de partie impossible :", error);
    return NextResponse.json({ error: "Une erreur est survenue. Réessayez dans un instant." }, { status: 500 });
  }
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new GameExitError("Requête invalide.", 400);
  return body as Record<string, unknown>;
}
