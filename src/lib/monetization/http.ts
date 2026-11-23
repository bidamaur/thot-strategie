import { NextResponse } from "next/server";
import { AiAccessError } from "@/lib/ai-training/access";
import { AvailabilityError } from "@/lib/availability/service";
import { getRequestUser } from "@/lib/auth/session";
import { UploadError } from "@/lib/uploads";
import { PaymentError } from "./payments";

type SessionUser = NonNullable<Awaited<ReturnType<typeof getRequestUser>>>;

/** Gestionnaire d'API monétisation / disponibilités : session, droits, erreurs métier. */
export async function apiRoute(
  request: Request,
  handler: (user: SessionUser | null) => Promise<unknown>,
  auth: "required" | "optional" | "admin" = "required",
): Promise<NextResponse> {
  try {
    const user = await getRequestUser(request);
    if (auth !== "optional" && !user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
    if (auth === "admin" && !user?.isAdmin) return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
    const result = await handler(user);
    const response = result instanceof NextResponse ? result : NextResponse.json(result ?? { ok: true });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PaymentError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof AvailabilityError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof AiAccessError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof UploadError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("API monétisation :", error);
    return NextResponse.json({ error: "Opération impossible pour le moment." }, { status: 500 });
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function parseDate(value: string | null, endOfDay = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
}

export const ID = /^[a-z0-9]{8,40}$/i;
