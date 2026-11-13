import {
  createUserSession,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  toPublicProfile,
  verifyPassword,
} from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const USER_SELECT = {
  id: true,
  username: true,
  passwordHash: true,
  isAdmin: true,
  isPremium: true,
  pointsFree: true,
  walletReal: true,
  elo: true,
  draughtsVariant: true,
  country: true,
  city: true,
  neighborhood: true,
} as const;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Identifiants invalides." }, { status: 400 });
  }

  const username =
    "username" in body && typeof body.username === "string"
      ? body.username.trim().toLowerCase()
      : "";
  const password =
    "password" in body && typeof body.password === "string" ? body.password : "";
  if (!username || !password || password.length > 128) {
    return NextResponse.json(
      { error: "Saisissez votre pseudo et votre mot de passe." },
      { status: 400 },
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: { username },
      select: USER_SELECT,
    });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json(
        { error: "Pseudo ou mot de passe incorrect." },
        { status: 401 },
      );
    }

    const token = await createUserSession(user.id);
    const secure =
      new URL(request.url).protocol === "https:" ||
      request.headers.get("x-forwarded-proto") === "https";
    const response = NextResponse.json({ user: toPublicProfile(user) });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });
    return response;
  } catch (error) {
    console.error("Erreur lors de la connexion :", error);
    return NextResponse.json(
      { error: "Impossible de vous connecter pour le moment." },
      { status: 500 },
    );
  }
}
