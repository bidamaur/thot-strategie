import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/session";
import { UploadError } from "@/lib/uploads";
import { CommunityError } from "./core";

type SessionUser = NonNullable<Awaited<ReturnType<typeof getRequestUser>>>;

/** Exécute un gestionnaire d'API communautaire et convertit les erreurs métier en réponses JSON. */
export async function communityRoute(
  request: Request,
  handler: (user: SessionUser | null) => Promise<unknown>,
  options: { auth?: "required" | "optional" | "admin" } = {},
): Promise<NextResponse> {
  const mode = options.auth ?? "required";
  try {
    const user = await getRequestUser(request);
    if (mode !== "optional" && !user) {
      return NextResponse.json({ error: "Connectez-vous pour accéder à la communauté." }, { status: 401 });
    }
    if (mode === "admin" && !user?.isAdmin) {
      return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
    }
    const result = await handler(user);
    return result instanceof NextResponse ? result : NextResponse.json(result ?? { ok: true });
  } catch (error) {
    if (error instanceof CommunityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Erreur API communauté :", error);
    return NextResponse.json({ error: "Une erreur est survenue. Réessayez dans un instant." }, { status: 500 });
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // corps absent ou invalide
  }
  throw new CommunityError("Requête invalide.", 400);
}

export function stringList(value: unknown, max = 200): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length <= 60).slice(0, max) : [];
}
