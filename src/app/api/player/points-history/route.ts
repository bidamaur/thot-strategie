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
    const [pointTransactions, betTransactions] = await Promise.all([
      prisma.balanceTransaction.findMany({
        where: {
          userId: currentUser.id,
          balanceType: "FREE_POINTS",
          transactionType: {
            in: ["GAME_POINTS_WON", "GAME_POINTS_LOST", "BET_PLACED", "BET_WON", "BET_LOST", "BET_REFUNDED"],
          },
        },
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

    return NextResponse.json({
      pointTransactions: pointTransactions.map((t) => ({
        ...t,
        amount: t.amount.toString(),
      })),
      betTransactions,
    });
  } catch (error) {
    console.error("Erreur lors du chargement de l'historique des points :", error);
    return NextResponse.json(
      { error: "Impossible de charger l'historique des points." },
      { status: 500 },
    );
  }
}
