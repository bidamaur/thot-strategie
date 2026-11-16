import {
  BalanceTransactionType,
  BalanceType,
  Prisma,
} from "@/generated/prisma-client";

export class InsufficientBetBalanceError extends Error {
  constructor() {
    super("Solde insuffisant pour bloquer les deux mises.");
    this.name = "InsufficientBetBalanceError";
  }
}

export async function escrowGameBet(
  transaction: Prisma.TransactionClient,
  input: {
    betId: string;
    matchId: string;
    playerIds: [string, string];
    amount: number;
  },
): Promise<Map<string, number>> {
  for (const userId of [...input.playerIds].sort()) {
    const debit = await transaction.user.updateMany({
      where: {
        id: userId,
        pointsFree: { gte: input.amount },
      },
      data: { pointsFree: { decrement: input.amount } },
    });
    if (debit.count !== 1) throw new InsufficientBetBalanceError();
  }

  await Promise.all(
    input.playerIds.map((userId) =>
      transaction.balanceTransaction.create({
        data: {
          userId,
          balanceType: BalanceType.FREE_POINTS,
          transactionType: BalanceTransactionType.BET_PLACED,
          amount: new Prisma.Decimal(-input.amount),
          referenceId: input.betId,
          description: `Mise bloquée sur la partie ${input.matchId}`,
        },
      }),
    ),
  );
  await transaction.gameBetTransaction.createMany({
    data: input.playerIds.map((userId) => ({
      betId: input.betId,
      userId,
      amount: -input.amount,
      type: "BET_PLACED",
    })),
  });

  const users = await transaction.user.findMany({
    where: { id: { in: input.playerIds } },
    select: { id: true, pointsFree: true },
  });
  return new Map(users.map((user) => [user.id, user.pointsFree]));
}
