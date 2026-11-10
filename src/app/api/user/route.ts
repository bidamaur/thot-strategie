import { Prisma } from "@/generated/prisma-client";
import {
  getRequestUser,
  toPublicProfile,
} from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,24}$/;
const DRAUGHTS_VARIANTS = new Set(["ENGLISH", "INTERNATIONAL"]);
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
  avatar: true,
} as const;

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const currentUser = await getRequestUser(request);
      if (!currentUser || currentUser.id !== id) {
        return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
      }
      return NextResponse.json({ user: toPublicProfile(currentUser) });
    }

    const users = await prisma.user.findMany({
      orderBy: { username: "asc" },
      take: 100,
      select: {
        id: true,
        username: true,
        isAdmin: true,
        isPremium: true,
        pointsFree: true,
        country: true,
        city: true,
        neighborhood: true,
      },
    });
    return NextResponse.json({ users });
  } catch (error) {
    console.error("Erreur lors de la lecture des profils :", error);
    return NextResponse.json(
      { error: "Impossible de charger les profils pour le moment." },
      { status: 500 },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    { error: "Utilisez /api/auth/register pour créer un compte." },
    { status: 410 },
  );
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Le corps de la requête doit être un JSON valide." },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }
  const fields = body as Record<string, unknown>;

  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }

  const data: {
    username?: string;
    draughtsVariant?: "ENGLISH" | "INTERNATIONAL";
  country?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  avatar?: string | null;
} = {};
  if ("username" in fields) {
    if (
      typeof fields.username !== "string" ||
      !USERNAME_PATTERN.test(fields.username.trim())
    ) {
      return NextResponse.json(
        { error: "Le pseudo doit contenir 3 à 24 lettres, chiffres ou _." },
        { status: 400 },
      );
    }
    data.username = fields.username.trim().toLowerCase();
  }
  if ("draughtsVariant" in fields) {
    if (
      typeof fields.draughtsVariant !== "string" ||
      !DRAUGHTS_VARIANTS.has(fields.draughtsVariant)
    ) {
      return NextResponse.json(
        { error: "Variante de dames invalide." },
        { status: 400 },
      );
    }
    data.draughtsVariant = fields.draughtsVariant as
      | "ENGLISH"
      | "INTERNATIONAL";
  }
  for (const key of ["country", "city", "neighborhood"] as const) {
    if (key in fields) {
      const value = fields[key];
      if (value !== null && typeof value !== "string") {
        return NextResponse.json(
          { error: `La valeur du champ ${key} est invalide.` },
          { status: 400 },
        );
      }
      if (typeof value === "string" && value.trim().length > 80) {
        return NextResponse.json(
          { error: `Le champ ${key} ne peut pas dépasser 80 caractères.` },
          { status: 400 },
        );
      }
      data[key] = typeof value === "string" ? value.trim() || null : value;
    }
  }
  if ("avatar" in fields) {
    const value = fields.avatar;
    if (value !== null && typeof value !== "string") {
      return NextResponse.json(
        { error: "La valeur du champ avatar est invalide." },
        { status: 400 },
      );
    }
    if (typeof value === "string" && value.length > 500) {
      return NextResponse.json(
        { error: "L'avatar ne peut pas dépasser 500 caractères." },
        { status: 400 },
      );
    }
    data.avatar = typeof value === "string" ? value || null : value;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Aucun paramètre de profil à mettre à jour." },
      { status: 400 },
    );
  }

  try {
    const user = await prisma.user.update({
      where: { id: currentUser.id },
      data,
      select: PROFILE_SELECT,
    });
    return NextResponse.json({ user: toPublicProfile(user) });
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
    console.error("Erreur lors de la mise à jour du profil :", error);
    return NextResponse.json(
      { error: "Impossible de sauvegarder le profil." },
      { status: 500 },
    );
  }
}
