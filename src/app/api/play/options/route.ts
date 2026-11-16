import { getRequestUser } from "@/lib/auth/session";
import { getMoneyRules } from "@/lib/economy/money-matches";
import { prisma } from "@/lib/prisma";
import { loadRatingSettings } from "@/lib/rating/load-config";
import { getSettings } from "@/lib/settings/service";
import { NextResponse } from "next/server";

/**
 * Options de recherche de partie pour le joueur connecté : modes ouverts,
 * cadences autorisées, mises proposées et éligibilité au mode rémunéré.
 * Les contrôles définitifs sont refaits côté serveur au moment de l'appariement.
 */
export async function GET(request: Request) {
  const currentUser = await getRequestUser(request);
  const [s, money, rating] = await Promise.all([
    getSettings([
      "matchmaking.casualEnabled",
      "matchmaking.ratedEnabled",
      "matchmaking.timeControlMin",
      "matchmaking.timeControlMax",
    ] as const),
    getMoneyRules(),
    loadRatingSettings(),
  ]);

  let moneyStatus: { eligible: boolean; reason: string | null; available: string } = {
    eligible: false,
    reason: money.enabled ? "Connexion requise." : "Mode rémunéré fermé.",
    available: "0",
  };
  let ratings: { variant: string; cadence: string | null; rating: number; gamesPlayed: number }[] = [];
  if (currentUser) {
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { walletReal: true, moneyVerified: true },
    });
    const reason = !money.enabled
      ? "Mode rémunéré fermé par l’administration."
      : money.requireVerification && !user?.moneyVerified
        ? "Compte non vérifié pour les parties rémunérées."
        : user && user.walletReal.lt(money.minStake)
          ? `Solde insuffisant (minimum ${money.minStake} FCFA).`
          : null;
    moneyStatus = {
      eligible: reason === null,
      reason,
      available: user?.walletReal.toString() ?? "0",
    };
    ratings = (
      await prisma.playerRating.findMany({
        where: { userId: currentUser.id },
        select: { variant: true, timeControl: true, eloRating: true, gamesPlayed: true },
      })
    ).map((r) => ({ variant: r.variant, cadence: r.timeControl, rating: r.eloRating, gamesPlayed: r.gamesPlayed }));
  }

  return NextResponse.json({
    modes: {
      CASUAL: s["matchmaking.casualEnabled"],
      RATED: s["matchmaking.ratedEnabled"],
      MONEY: money.enabled,
    },
    timeControl: { min: s["matchmaking.timeControlMin"], max: s["matchmaking.timeControlMax"] },
    cadences: rating.cadences,
    money: {
      minStake: money.minStake,
      maxStake: money.maxStake,
      presets: money.stakePresets,
      commissionPercent: money.commissionPercent,
      ...moneyStatus,
    },
    ratings,
  });
}
