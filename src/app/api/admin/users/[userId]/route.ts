import {
  BalanceTransactionType,
  BalanceType,
  Prisma,
} from "@/generated/prisma-client";
import { randomUUID } from "node:crypto";
import { writeAuditLog } from "@/lib/audit";
import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

const userSelect = {
  id: true,
  username: true,
  isAdmin: true,
  isPremium: true,
  premiumLevel: true,
  premiumExpiresAt: true,
  pointsFree: true,
  walletReal: true,
  walletLocked: true,
  moneyVerified: true,
  elo: true,
  country: true,
  city: true,
  neighborhood: true,
  avatar: true,
} as const;

function serialize(user: Prisma.UserGetPayload<{ select: typeof userSelect }>) {
  return {
    ...user,
    walletReal: user.walletReal.toString(),
    walletLocked: user.walletLocked.toString(),
    premiumExpiresAt: user.premiumExpiresAt?.toISOString() ?? null,
  };
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Modification d'un compte par un administrateur.
 * Les soldes ne sont jamais écrasés directement : l'écart avec la valeur
 * actuelle est enregistré comme un ajustement (ADMIN_ADJUSTMENT) dans le
 * grand livre, et chaque modification est tracée dans le journal d'audit.
 */
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
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const fields = body as Record<string, unknown>;

  if (userId === currentUser.id && "isAdmin" in fields && fields.isAdmin === false) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas retirer vos propres droits d’administration." },
      { status: 400 },
    );
  }

  const data: Prisma.UserUpdateInput = {};
  if ("isAdmin" in fields) data.isAdmin = Boolean(fields.isAdmin);
  if ("isPremium" in fields) data.isPremium = Boolean(fields.isPremium);
  if ("moneyVerified" in fields) data.moneyVerified = Boolean(fields.moneyVerified);
  if ("premiumLevel" in fields) {
    const level = finiteNumber(fields.premiumLevel);
    if (level === null || !Number.isInteger(level) || level < 0 || level > 10) {
      return NextResponse.json({ error: "Niveau Premium invalide." }, { status: 400 });
    }
    data.premiumLevel = level;
  }
  if ("premiumExpiresAt" in fields) {
    const raw = fields.premiumExpiresAt;
    const date = raw === null || raw === "" ? null : new Date(String(raw));
    if (date && Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: "Date d’expiration invalide." }, { status: 400 });
    }
    data.premiumExpiresAt = date;
  }
  if ("elo" in fields) {
    const elo = finiteNumber(fields.elo);
    if (elo === null || !Number.isInteger(elo) || elo < 0 || elo > 4000) {
      return NextResponse.json({ error: "ELO invalide." }, { status: 400 });
    }
    data.elo = elo;
  }
  if ("username" in fields) {
    const username = String(fields.username ?? "").trim();
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      return NextResponse.json({ error: "Pseudo invalide." }, { status: 400 });
    }
    data.username = username;
  }
  for (const key of ["country", "city", "neighborhood"] as const) {
    if (key in fields) {
      const value = fields[key];
      data[key] = typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null;
    }
  }

  const targetPoints = "pointsFree" in fields ? finiteNumber(fields.pointsFree) : undefined;
  const targetWallet = "walletReal" in fields ? finiteNumber(fields.walletReal) : undefined;
  if (targetPoints === null || (typeof targetPoints === "number" && targetPoints < 0)) {
    return NextResponse.json({ error: "Solde de points classiques invalide." }, { status: 400 });
  }
  if (targetWallet === null || (typeof targetWallet === "number" && targetWallet < 0)) {
    return NextResponse.json({ error: "Solde de points argent invalide." }, { status: 400 });
  }
  const reason =
    typeof fields.reason === "string" && fields.reason.trim()
      ? fields.reason.trim().slice(0, 200)
      : "Ajustement administrateur";

  if (Object.keys(data).length === 0 && targetPoints === undefined && targetWallet === undefined) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour." }, { status: 400 });
  }

  try {
    const user = await prisma.$transaction(
      async (tx) => {
        const before = await tx.user.findUnique({ where: { id: userId }, select: userSelect });
        if (!before) throw new Error("NOT_FOUND");
        const referenceId = `admin:${randomUUID()}`;

        if (typeof targetPoints === "number" && targetPoints !== before.pointsFree) {
          const delta = targetPoints - before.pointsFree;
          data.pointsFree = targetPoints;
          await tx.balanceTransaction.create({
            data: {
              userId,
              balanceType: BalanceType.FREE_POINTS,
              transactionType: BalanceTransactionType.ADMIN_ADJUSTMENT,
              amount: new Prisma.Decimal(delta),
              referenceId,
              description: `${reason} (par ${currentUser.username})`,
            },
          });
        }
        if (typeof targetWallet === "number" && !before.walletReal.equals(targetWallet)) {
          const delta = new Prisma.Decimal(targetWallet).minus(before.walletReal);
          data.walletReal = new Prisma.Decimal(targetWallet);
          await tx.balanceTransaction.create({
            data: {
              userId,
              balanceType: BalanceType.REAL_WALLET,
              transactionType: BalanceTransactionType.ADMIN_ADJUSTMENT,
              amount: delta,
              referenceId,
              description: `${reason} (par ${currentUser.username})`,
            },
          });
        }

        const after = await tx.user.update({ where: { id: userId }, data, select: userSelect });
        await writeAuditLog(tx, {
          actorId: currentUser.id,
          action: "USER_UPDATED",
          entity: "User",
          entityId: userId,
          before: serialize(before) as unknown as Prisma.InputJsonValue,
          after: { ...(serialize(after) as unknown as Record<string, Prisma.InputJsonValue>), reason },
        });
        return after;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return NextResponse.json({ user: serialize(user) });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Ce pseudo est déjà utilisé." }, { status: 409 });
    }
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
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, walletReal: true, walletLocked: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
    }
    // Protection financière : un compte avec des fonds ne peut pas être supprimé.
    if (target.walletReal.gt(0) || target.walletLocked.gt(0)) {
      return NextResponse.json(
        { error: "Ce compte détient des points argent : soldez-le avant suppression." },
        { status: 409 },
      );
    }
    await prisma.$transaction(async (tx) => {
      await writeAuditLog(tx, {
        actorId: currentUser.id,
        action: "USER_DELETED",
        entity: "User",
        entityId: userId,
        before: { username: target.username },
      });
      await tx.user.delete({ where: { id: userId } });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erreur lors de la suppression utilisateur :", error);
    return NextResponse.json(
      { error: "Impossible de supprimer l'utilisateur (parties ou tournois liés)." },
      { status: 500 },
    );
  }
}
