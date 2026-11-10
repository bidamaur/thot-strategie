import {
  BalanceTransactionType,
  BalanceType,
  Prisma,
} from "@/generated/prisma-client";
import { isMockEconomyEnabled, mockEconomyDisabledResponse } from "@/lib/economy/mock-mode";
import { getRequestUser } from "@/lib/auth/session";
import { MOCK_POINT_PACKS, type MockPointPackId } from "@/lib/economy/packs";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const PACK_IDS = new Set(Object.keys(MOCK_POINT_PACKS));
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  if (!isMockEconomyEnabled()) return mockEconomyDisabledResponse();
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }

  try {
    const transactions = await prisma.balanceTransaction.findMany({
      where: { userId: currentUser.id, balanceType: BalanceType.REAL_WALLET },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        transactionType: true,
        amount: true,
        description: true,
        referenceId: true,
        createdAt: true,
      },
    });
    return NextResponse.json({
      transactions: transactions.map((item) => ({
        ...item,
        amount: item.amount.toString(),
      })),
    });
  } catch (error) {
    console.error("Erreur lors de la lecture du portefeuille :", error);
    return NextResponse.json(
      { error: "Impossible de charger l’historique du portefeuille." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isMockEconomyEnabled()) return mockEconomyDisabledResponse();
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connectez-vous pour acheter un pack." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Le corps de la requête doit être un JSON valide." },
      { status: 400 },
    );
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Achat invalide." }, { status: 400 });
  }

  const { packId, idempotencyKey } = body as {
    packId?: unknown;
    idempotencyKey?: unknown;
  };
  if (
    typeof packId !== "string" ||
    !PACK_IDS.has(packId) ||
    typeof idempotencyKey !== "string" ||
    !UUID_PATTERN.test(idempotencyKey)
  ) {
    return NextResponse.json(
      { error: "Profil, pack ou identifiant d’achat invalide." },
      { status: 400 },
    );
  }

  const selectedPack = MOCK_POINT_PACKS[packId as MockPointPackId];
  try {
    const result = await prisma.$transaction(async (transaction) => {
      const previous = await transaction.balanceTransaction.findUnique({
        where: {
          userId_transactionType_referenceId: {
            userId: currentUser.id,
            transactionType: BalanceTransactionType.MOCK_PURCHASE,
            referenceId: idempotencyKey,
          },
        },
      });
      if (previous) {
        const user = await transaction.user.findUniqueOrThrow({
          where: { id: currentUser.id },
          select: { walletReal: true },
        });
        return { points: previous.amount.toNumber() / 100, wallet: user.walletReal, repeated: true };
      }

      const user = await transaction.user.update({
        where: { id: currentUser.id },
        data: {
          walletReal: { increment: new Prisma.Decimal(selectedPack.priceCfa) },
        },
        select: { walletReal: true },
      });
      await transaction.balanceTransaction.create({
        data: {
          userId: currentUser.id,
          balanceType: BalanceType.REAL_WALLET,
          transactionType: BalanceTransactionType.MOCK_PURCHASE,
          amount: new Prisma.Decimal(selectedPack.priceCfa),
          referenceId: idempotencyKey,
          description: `Achat simulé de ${selectedPack.points} points`,
        },
      });
      return {
        points: selectedPack.points,
        wallet: user.walletReal,
        repeated: false,
      };
    });
    return NextResponse.json({
      purchase: {
        points: result.points,
        walletReal: result.wallet.toString(),
        simulated: true,
        repeated: result.repeated,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const [previous, user] = await Promise.all([
        prisma.balanceTransaction.findUnique({
          where: {
            userId_transactionType_referenceId: {
              userId: currentUser.id,
              transactionType: BalanceTransactionType.MOCK_PURCHASE,
              referenceId: idempotencyKey,
            },
          },
        }),
        prisma.user.findUnique({
          where: { id: currentUser.id },
          select: { walletReal: true },
        }),
      ]);
      if (previous && user) {
        return NextResponse.json({
          purchase: {
            points: previous.amount.toNumber() / 100,
            walletReal: user.walletReal.toString(),
            simulated: true,
            repeated: true,
          },
        });
      }
    }

    console.error("Erreur lors de l’achat simulé :", error);
    return NextResponse.json(
      { error: "Impossible d’enregistrer l’achat simulé." },
      { status: 500 },
    );
  }
}
