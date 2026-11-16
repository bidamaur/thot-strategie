import { MatchMode, MatchStatus, Prisma } from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";
import { lockStake, MoneyWalletError, stakedToday } from "./money-wallet";
import { isUniqueViolation } from "@/lib/db/retry";

/**
 * Règles d'accès au mode rémunéré, vérifiées côté serveur uniquement.
 * Le joueur doit avoir choisi explicitement ce mode et ce montant dans la
 * recherche de partie : la possession de points argent n'implique jamais
 * une partie rémunérée.
 */

export class MoneyEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyEligibilityError";
  }
}

export async function getMoneyRules() {
  const s = await getSettings([
    "money.enabled",
    "money.requireVerification",
    "money.minStake",
    "money.maxStake",
    "money.stakePresets",
    "money.commissionPercent",
    "money.dailyStakeLimit",
    "money.maxGamesVsSameOpponentPerDay",
    "money.affectsRating",
  ] as const);
  return {
    enabled: s["money.enabled"],
    requireVerification: s["money.requireVerification"],
    minStake: s["money.minStake"],
    maxStake: s["money.maxStake"],
    stakePresets: s["money.stakePresets"].filter(
      (v) => v >= s["money.minStake"] && v <= s["money.maxStake"],
    ),
    commissionPercent: s["money.commissionPercent"],
    dailyStakeLimit: s["money.dailyStakeLimit"],
    maxGamesVsSameOpponentPerDay: s["money.maxGamesVsSameOpponentPerDay"],
    affectsRating: s["money.affectsRating"],
  };
}

/** Pré-contrôle à l'entrée dans la file (sans bloquer de fonds). */
export async function assertCanQueueForMoney(userId: string, stake: number): Promise<void> {
  const rules = await getMoneyRules();
  if (!rules.enabled) {
    throw new MoneyEligibilityError("Les parties rémunérées ne sont pas ouvertes actuellement.");
  }
  if (!Number.isInteger(stake) || stake < rules.minStake || stake > rules.maxStake) {
    throw new MoneyEligibilityError(
      `La mise doit être comprise entre ${rules.minStake} et ${rules.maxStake} FCFA.`,
    );
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { walletReal: true, moneyVerified: true },
  });
  if (!user) throw new MoneyEligibilityError("Profil introuvable.");
  if (rules.requireVerification && !user.moneyVerified) {
    throw new MoneyEligibilityError(
      "Votre compte doit être vérifié pour accéder aux parties rémunérées.",
    );
  }
  if (user.walletReal.lt(stake)) {
    throw new MoneyEligibilityError("Solde de points argent insuffisant pour cette mise.");
  }
  if (rules.dailyStakeLimit > 0) {
    const already = await stakedToday(prisma, userId);
    if (already.plus(stake).gt(rules.dailyStakeLimit)) {
      throw new MoneyEligibilityError(
        `Limite quotidienne de mises atteinte (${rules.dailyStakeLimit} FCFA).`,
      );
    }
  }
}

/**
 * Bloque les deux mises au moment de la création de la partie, dans la même
 * transaction que la partie. Si un des contrôles échoue, rien n'est débité.
 */
export async function lockMoneyMatchStakes(
  tx: Prisma.TransactionClient,
  input: { matchId: string; playerIds: [string, string]; stake: number },
): Promise<void> {
  const rules = await getMoneyRules();
  if (!rules.enabled) throw new MoneyEligibilityError("Mode rémunéré désactivé.");
  const stake = new Prisma.Decimal(input.stake);

  if (rules.maxGamesVsSameOpponentPerDay > 0) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [a, b] = input.playerIds;
    const count = await tx.match.count({
      where: {
        mode: MatchMode.MONEY,
        createdAt: { gte: start },
        id: { not: input.matchId },
        status: { not: MatchStatus.ABORTED },
        OR: [
          { playerWhiteId: a, playerBlackId: b },
          { playerWhiteId: b, playerBlackId: a },
        ],
      },
    });
    if (count >= rules.maxGamesVsSameOpponentPerDay) {
      throw new MoneyEligibilityError(
        "Nombre maximal de parties rémunérées contre ce joueur atteint aujourd'hui.",
      );
    }
  }

  const users = await tx.user.findMany({
    where: { id: { in: input.playerIds } },
    select: { id: true, moneyVerified: true },
  });
  if (users.length !== 2) throw new MoneyEligibilityError("Joueur introuvable.");
  if (rules.requireVerification && users.some((u) => !u.moneyVerified)) {
    throw new MoneyEligibilityError("Un des joueurs n'est pas vérifié pour le mode rémunéré.");
  }

  // Ordre déterministe pour éviter les interblocages entre transactions concurrentes.
  for (const userId of [...input.playerIds].sort()) {
    if (rules.dailyStakeLimit > 0) {
      const already = await stakedToday(tx, userId);
      if (already.plus(stake).gt(rules.dailyStakeLimit)) {
        throw new MoneyEligibilityError("Limite quotidienne de mises atteinte.");
      }
    }
    try {
      await lockStake(tx, {
        userId,
        amount: stake,
        referenceId: input.matchId,
        description: `Mise bloquée pour la partie ${input.matchId}`,
      });
    } catch (error) {
      if (error instanceof MoneyWalletError) {
        throw new MoneyEligibilityError("Solde de points argent insuffisant pour un des joueurs.");
      }
      if (isUniqueViolation(error)) {
        throw new MoneyEligibilityError("Les mises de cette partie sont déjà bloquées.");
      }
      throw error;
    }
  }
}
