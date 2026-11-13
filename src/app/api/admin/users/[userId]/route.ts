import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const currentUser = await getRequestUser(request);
  if (!currentUser || !currentUser.isAdmin) {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  }

  const { userId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const fields = body as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if ("isAdmin" in fields) data.isAdmin = Boolean(fields.isAdmin);
  if ("isPremium" in fields) data.isPremium = Boolean(fields.isPremium);
  if ("premiumLevel" in fields) data.premiumLevel = Number(fields.premiumLevel);
  if ("pointsFree" in fields) data.pointsFree = Number(fields.pointsFree);
  if ("walletReal" in fields) data.walletReal = Number(fields.walletReal);
  if ("elo" in fields) data.elo = Number(fields.elo);
  if ("username" in fields) data.username = String(fields.username);
  if ("country" in fields) data.country = fields.country ?? null;
  if ("city" in fields) data.city = fields.city ?? null;
  if ("neighborhood" in fields) data.neighborhood = fields.neighborhood ?? null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour." }, { status: 400 });
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        isAdmin: true,
        isPremium: true,
        premiumLevel: true,
        pointsFree: true,
        walletReal: true,
        elo: true,
        country: true,
        city: true,
        neighborhood: true,
        avatar: true,
      },
    });

    return NextResponse.json({
      user: {
        ...user,
        walletReal: user.walletReal.toString(),
      },
    });
  } catch (error) {
    console.error("Erreur lors de la mise à jour utilisateur :", error);
    return NextResponse.json(
      { error: "Impossible de mettre à jour l'utilisateur." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const currentUser = await getRequestUser(request);
  if (!currentUser || !currentUser.isAdmin) {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  }

  const { userId } = await params;

  if (userId === currentUser.id) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas supprimer votre propre compte administrateur." },
      { status: 400 },
    );
  }

  try {
    await prisma.user.delete({ where: { id: userId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erreur lors de la suppression utilisateur :", error);
    return NextResponse.json(
      { error: "Impossible de supprimer l'utilisateur." },
      { status: 500 },
    );
  }
}
