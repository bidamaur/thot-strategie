import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request): Promise<NextResponse> {
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);

  try {
    const [user, transactions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: currentUser.id },
        select: {
          id: true,
          username: true,
          pointsFree: true,
          walletReal: true,
          elo: true,
        },
      }),
      prisma.balanceTransaction.findMany({
        where: { userId: currentUser.id, balanceType: "FREE_POINTS" },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          transactionType: true,
          amount: true,
          description: true,
          referenceId: true,
          createdAt: true,
        },
      }),
      prisma.gameBetTransaction.findMany({
        where: { userId: currentUser.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          amount: true,
          type: true,
          createdAt: true,
        },
      }),
    ]);

    if (!user) {
      return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        pointsFree: user.pointsFree,
        walletReal: user.walletReal.toString(),
        elo: user.elo,
      },
      pointsTransactions: transactions.map((t) => ({
        ...t,
        amount: t.amount.toString(),
      })),
      betTransactions: transactions.filter((_, i) => i < limit).map(() => {}), // placeholder
      betTransactionsFull: (await prisma.gameBetTransaction.findMany({
        where: { userId: currentUser.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          amount: true,
          type: true,
          createdAt: true,
        },
      })),
    });
  } catch (error) {
    console.error("Erreur lors de la lecture des points :", error);
    return NextResponse.json(
      { error: "Impossible de charger les points." },
      { status: 500 },
    );
  }
}
