import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma-client";
import { getRequestUser } from "@/lib/auth/session";
import { sanitizeBoardPrefs } from "@/lib/board-prefs";
import { prisma } from "@/lib/prisma";

const noStore = { "Cache-Control": "no-store" };

/** Préférences de plateau du joueur connecté. */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { boardPrefs: true } });
  return NextResponse.json({ prefs: sanitizeBoardPrefs(row?.boardPrefs) }, { headers: noStore });
}

/** Enregistre les préférences (valeurs inconnues ramenées aux valeurs par défaut). */
export async function PUT(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const prefs = sanitizeBoardPrefs((body as { prefs?: unknown }).prefs);
  await prisma.user.update({ where: { id: user.id }, data: { boardPrefs: prefs as unknown as Prisma.InputJsonValue } });
  return NextResponse.json({ prefs }, { headers: noStore });
}
