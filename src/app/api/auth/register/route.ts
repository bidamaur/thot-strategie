import { Prisma } from "@/generated/prisma-client";
import {
  createUserSession,
  hashPassword,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  toPublicProfile,
} from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,24}$/;
const PROFILE_SELECT = {
  id: true,
  username: true,
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
    return NextResponse.json({ error: "Données de profil invalides." }, { status: 400 });
  }

  const username =
    "username" in body && typeof body.username === "string"
      ? body.username.trim().toLowerCase()
      : "";
  const password =
    "password" in body && typeof body.password === "string" ? body.password : "";
  if (!USERNAME_PATTERN.test(username)) {
    return NextResponse.json(
      { error: "Le pseudo doit contenir 3 à 24 lettres, chiffres ou _." },
      { status: 400 },
    );
  }
  if (password.length < 8 || password.length > 128) {
    return NextResponse.json(
      { error: "Le mot de passe doit contenir entre 8 et 128 caractères." },
      { status: 400 },
    );
  }

  try {
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword(password) },
      select: PROFILE_SELECT,
    });
    const token = await createUserSession(user.id);
    const secure =
      new URL(request.url).protocol === "https:" ||
      request.headers.get("x-forwarded-proto") === "https";
    const response = NextResponse.json(
      { user: toPublicProfile(user) },
      { status: 201 },
    );
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });
    return response;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Ce pseudo est déjà utilisé." },
        { status: 409 },
      );
    }
    console.error("Erreur lors de la création du profil :", error);
    return NextResponse.json(
      { error: "Impossible de créer le profil." },
      { status: 500 },
    );
  }
}
