import {
  BalanceTransactionType,
  BalanceType,
  Prisma,
} from "@/generated/prisma-client";

/**
 * Portefeuille « points argent ».
 *
 * - `walletReal`   : solde disponible.
 * - `walletLocked` : solde bloqué (mises de parties en cours).
 * Chaque mouvement écrit une ligne `BalanceTransaction` dont la contrainte
 * unique (userId, transactionType, referenceId) rend l'opération idempotente :
 * rejouer un règlement lève P2002 au lieu de payer deux fois.
 *
 * Ces fonctions doivent être appelées DANS une transaction Prisma.
 */

export class MoneyWalletError extends Error {
  constructor(
    message: string,
    readonly code: "INSUFFICIENT_FUNDS" | "INVALID_AMOUNT" | "LOCK_MISSING",
  ) {
    super(message);
    this.name = "MoneyWalletError";
  }
}

type Tx = Prisma.TransactionClient;

function assertPositive(amount: Prisma.Decimal): void {
  if (!amount.isFinite() || amount.lte(0)) {
    throw new MoneyWalletError("Montant invalide.", "INVALID_AMOUNT");
  }
}

/** Bloque `amount` sur le solde disponible d'un joueur (débit conditionnel atomique). */
export async function lockStake(
  tx: Tx,
  input: { userId: string; amount: Prisma.Decimal; referenceId: string; description: string },
): Promise<void> {
  assertPositive(input.amount);
  const debit = await tx.user.updateMany({
    where: { id: input.userId, walletReal: { gte: input.amount } },
    data: {
      walletReal: { decrement: input.amount },
      walletLocked: { increment: input.amount },
    },
  });
  if (debit.count !== 1) {
    throw new MoneyWalletError("Solde de points argent insuffisant.", "INSUFFICIENT_FUNDS");
  }
  await tx.balanceTransaction.create({
    data: {
      userId: input.userId,
      balanceType: BalanceType.MONEY_LOCKED,
      transactionType: BalanceTransactionType.MONEY_STAKE_LOCKED,
      amount: input.amount.negated(),
      referenceId: input.referenceId,
      description: input.description,
    },
  });
}

async function releaseLock(tx: Tx, userId: string, amount: Prisma.Decimal): Promise<void> {
  const released = await tx.user.updateMany({
    where: { id: userId, walletLocked: { gte: amount } },
    data: { walletLocked: { decrement: amount } },
  });
  if (released.count !== 1) {
    throw new MoneyWalletError("Mise bloquée introuvable.", "LOCK_MISSING");
  }
}

/** Rend la mise bloquée au joueur (nulle, partie annulée, litige). */
export async function refundStake(
  tx: Tx,
  input: { userId: string; amount: Prisma.Decimal; referenceId: string; description: string },
): Promise<void> {
  assertPositive(input.amount);
  await tx.balanceTransaction.create({
    data: {
      userId: input.userId,
      balanceType: BalanceType.REAL_WALLET,
      transactionType: BalanceTransactionType.MONEY_STAKE_REFUNDED,
      amount: input.amount,
      referenceId: input.referenceId,
      description: input.description,
    },
  });
  await releaseLock(tx, input.userId, input.amount);
  await tx.user.update({
    where: { id: input.userId },
    data: { walletReal: { increment: input.amount } },
  });
}

export function computePayout(stake: Prisma.Decimal, commissionPercent: number) {
  const pot = stake.mul(2);
  const commission = pot
    .mul(new Prisma.Decimal(commissionPercent))
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { pot, commission, payout: pot.minus(commission) };
}

/**
 * Règle une partie rémunérée : le perdant perd sa mise bloquée, le gagnant
 * récupère sa mise + celle de l'adversaire, moins la commission plateforme.
 */
export async function settleStakeWin(
  tx: Tx,
  input: {
    winnerId: string;
    loserId: string;
    stake: Prisma.Decimal;
    commissionPercent: number;
    referenceId: string;
  },
): Promise<{ payout: Prisma.Decimal; commission: Prisma.Decimal }> {
  assertPositive(input.stake);
  const { commission, payout } = computePayout(input.stake, input.commissionPercent);

  await tx.balanceTransaction.create({
    data: {
      userId: input.loserId,
      balanceType: BalanceType.MONEY_LOCKED,
      transactionType: BalanceTransactionType.MONEY_STAKE_LOST,
      amount: input.stake.negated(),
      referenceId: input.referenceId,
      description: `Mise perdue (partie ${input.referenceId})`,
    },
  });
  await releaseLock(tx, input.loserId, input.stake);

  await tx.balanceTransaction.create({
    data: {
      userId: input.winnerId,
      balanceType: BalanceType.REAL_WALLET,
      transactionType: BalanceTransactionType.MONEY_STAKE_WON,
      amount: payout,
      referenceId: input.referenceId,
      description: `Gain de la partie ${input.referenceId}`,
    },
  });
  if (commission.gt(0)) {
    await tx.balanceTransaction.create({
      data: {
        userId: input.winnerId,
        balanceType: BalanceType.REAL_WALLET,
        transactionType: BalanceTransactionType.MONEY_COMMISSION,
        amount: commission.negated(),
        referenceId: input.referenceId,
        description: `Commission plateforme (partie ${input.referenceId})`,
      },
    });
  }
  await releaseLock(tx, input.winnerId, input.stake);
  await tx.user.update({
    where: { id: input.winnerId },
    data: { walletReal: { increment: payout } },
  });
  return { payout, commission };
}

/** Somme des mises bloquées aujourd'hui (limite de jeu responsable). */
export async function stakedToday(tx: Tx, userId: string): Promise<Prisma.Decimal> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const sum = await tx.balanceTransaction.aggregate({
    where: {
      userId,
      transactionType: BalanceTransactionType.MONEY_STAKE_LOCKED,
      createdAt: { gte: start },
    },
    _sum: { amount: true },
  });
  return (sum._sum.amount ?? new Prisma.Decimal(0)).abs();
}
