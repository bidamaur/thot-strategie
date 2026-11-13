import { Prisma } from "@/generated/prisma-client";
import { getRequestUser } from "@/lib/auth/session";
import { TournamentConfigService } from "@/lib/tournament/config";
import { NextResponse } from "next/server";

function isInputJsonValue(value: unknown): value is Prisma.InputJsonValue {
  if (value === null) return false;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((item) => item === null || isInputJsonValue(item));
  }
  if (typeof value === "object") {
    return Object.values(value).every(
      (item) => item === null || isInputJsonValue(item),
    );
  }
  return false;
}

export async function GET(request: Request) {
  const currentUser = await getRequestUser(request);
  if (!currentUser || !currentUser.isAdmin) {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  }

  try {
    await TournamentConfigService.initializeDefaultConfigs(currentUser.id);
    const configs = await TournamentConfigService.getAllConfigs();
    return NextResponse.json({ configs });
  } catch (error) {
    console.error("Erreur lors du chargement de la configuration :", error);
    return NextResponse.json(
      { error: "Impossible de charger la configuration." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const currentUser = await getRequestUser(request);
  if (!currentUser || !currentUser.isAdmin) {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const { key, value, description, isEditable } = body as Record<
    string,
    unknown
  >;

  if (!key || typeof key !== "string") {
    return NextResponse.json({ error: "Clé de configuration requise." }, { status: 400 });
  }
  if (!isInputJsonValue(value)) {
    return NextResponse.json(
      { error: "Valeur de configuration invalide." },
      { status: 400 },
    );
  }

  try {
    const config = await TournamentConfigService.setConfig(
      key,
      value,
      typeof description === "string" ? description : null,
      currentUser.id,
      typeof isEditable === "boolean" ? isEditable : true,
    );
    return NextResponse.json({ config }, { status: 201 });
  } catch (error: any) {
    if (error.name === "TournamentConfigError") {
      const status = error.code === "UNAUTHORIZED" ? 403 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Erreur lors de la configuration :", error);
    return NextResponse.json({ error: "Erreur interne." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const currentUser = await getRequestUser(request);
  if (!currentUser || !currentUser.isAdmin) {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key) {
    return NextResponse.json({ error: "Clé de configuration requise." }, { status: 400 });
  }

  try {
    await TournamentConfigService.deleteConfig(key, currentUser.id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.name === "TournamentConfigError") {
      const status = error.code === "UNAUTHORIZED" ? 403 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "Erreur interne." }, { status: 500 });
  }
}
