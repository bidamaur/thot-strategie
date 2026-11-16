import { BalanceType } from "@/generated/prisma-client";
import { getRequestUser } from "@/lib/auth/session";
import { getMoneyRules } from "@/lib/economy/money-matches";
import { prisma } from "@/lib/prisma";
import { loadRatingSettings } from "@/lib/rating/load-config";
import { CADENCE_LABELS, isProvisional, levelFor, VARIANT_LABELS, type Cadence, type RatingVariant } from "@/lib/rating/pools";
import { NextResponse } from "next/server";

/**
 * Vue consolidée des TROIS systèmes de points du joueur, strictement séparés :
 * points classiques, classements ALO/ELO, points argent.
 */
export async function GET(request: Request) {
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }

  try {
    const [user, ratings, classicTx, moneyTx, rules, ratingSettings] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: currentUser.id },
        select: { pointsFree: true, walletReal: true, walletLocked: true, moneyVerified: true, elo: true },
      }),
      prisma.playerRating.findMany({
        where: { userId: currentUser.id },
        orderBy: { gamesPlayed: "desc" },
      }),
      prisma.balanceTransaction.findMany({
        where: { userId: currentUser.id, balanceType: BalanceType.FREE_POINTS },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, transactionType: true, amount: true, description: true, createdAt: true },
      }),
      prisma.balanceTransaction.findMany({
        where: {
          userId: currentUser.id,
          balanceType: { in: [BalanceType.REAL_WALLET, BalanceType.MONEY_LOCKED] },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, transactionType: true, amount: true, description: true, createdAt: true, balanceType: true },
      }),
      getMoneyRules(),
      loadRatingSettings(),
    ]);

    return NextResponse.json({
      classic: {
        balance: user.pointsFree,
        transactions: classicTx.map((t) => ({ ...t, amount: t.amount.toNumber() })),
      },
      rating: {
        global: user.elo,
        provisionalGames: ratingSettings.config.provisionalGames,
        pools: ratings.map((r) => ({
          variant: r.variant,
          variantLabel: VARIANT_LABELS[r.variant as RatingVariant] ?? r.variant,
          cadence: r.timeControl,
          cadenceLabel: CADENCE_LABELS[r.timeControl as Cadence] ?? r.timeControl ?? "—",
          rating: r.eloRating,
          gamesPlayed: r.gamesPlayed,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
          provisional: isProvisional(r.gamesPlayed, ratingSettings.config.provisionalGames),
          level: levelFor(r.eloRating, ratingSettings.levels),
        })),
      },
      money: {
        enabled: rules.enabled,
        verified: user.moneyVerified,
        requireVerification: rules.requireVerification,
        available: user.walletReal.toString(),
        locked: user.walletLocked.toString(),
        transactions: moneyTx.map((t) => ({ ...t, amount: t.amount.toString() })),
      },
    });
  } catch (error) {
    console.error("Erreur lors du chargement du portefeuille :", error);
    return NextResponse.json({ error: "Impossible de charger vos soldes." }, { status: 500 });
  }
}
