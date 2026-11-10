import {
  BalanceTransactionType,
  BalanceType,
  Prisma,
  TournamentInvitationStatus,
  TournamentMatchStage,
  TournamentMatchStatus,
  TournamentScope,
  TournamentStatus,
} from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";

export class TournamentEconomyError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_INPUT"
      | "NOT_FOUND"
      | "PREMIUM_REQUIRED"
      | "NOT_OPEN"
      | "FULL"
      | "ALREADY_JOINED"
      | "INSUFFICIENT_FUNDS"
      | "INVALID_RESULT"
      | "NOT_SETTLEABLE",
  ) {
    super(message);
    this.name = "TournamentEconomyError";
  }
}

export interface CreateTournamentInput {
  creatorId: string;
  scope: TournamentScope;
  isPaid: boolean;
  entryFeeCfa: number;
  entryPoints: number;
  maxPlayers: number;
  invitedUserIds?: string[];
}

function assertCapacity(maxPlayers: number): void {
  if (
    !Number.isInteger(maxPlayers) ||
    maxPlayers < 4 ||
    maxPlayers > 64 ||
    (maxPlayers & (maxPlayers - 1)) !== 0
  ) {
    throw new TournamentEconomyError(
      "Le nombre de joueurs doit être 4, 8, 16, 32 ou 64.",
      "INVALID_INPUT",
    );
  }
}

function assertFee(value: number, label: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TournamentEconomyError(
      `${label} doit être un entier supérieur ou égal à ${minimum}.`,
      "INVALID_INPUT",
    );
  }
}

async function retrySerializable<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        (error.code !== "P2034" && error.code !== "P2002") ||
        attempt >= 2
      ) {
        throw error;
      }
    }
  }
}

export async function createTournament(input: CreateTournamentInput) {
  assertCapacity(input.maxPlayers);
  if (input.invitedUserIds !== undefined) {
    if (
      input.isPaid ||
      input.invitedUserIds.length > input.maxPlayers - 1 ||
      input.invitedUserIds.includes(input.creatorId) ||
      new Set(input.invitedUserIds).size !== input.invitedUserIds.length
    ) {
      throw new TournamentEconomyError(
        "Les invitations doivent être uniques, gratuites et respecter le quota.",
        "INVALID_INPUT",
      );
    }
  }
  if (input.isPaid) {
    assertFee(input.entryFeeCfa, "Le droit d’entrée en FCFA", 100);
    if (input.entryPoints !== 0) {
      throw new TournamentEconomyError(
        "Un tournoi rémunéré ne peut pas exiger de points gratuits.",
        "INVALID_INPUT",
      );
    }
  } else {
    assertFee(input.entryPoints, "Le droit d’entrée en points", 1);
    if (input.entryFeeCfa !== 0) {
      throw new TournamentEconomyError(
        "Un tournoi gratuit ne peut pas exiger de FCFA.",
        "INVALID_INPUT",
      );
    }
  }

  return retrySerializable(() =>
    prisma.$transaction(
      async (transaction) => {
        const creator = await transaction.user.findUnique({
          where: { id: input.creatorId },
          select: { isPremium: true },
        });
        if (!creator) {
          throw new TournamentEconomyError("Créateur introuvable.", "NOT_FOUND");
        }
        if (!creator.isPremium) {
          throw new TournamentEconomyError(
            "Seuls les membres Premium peuvent créer un tournoi.",
            "PREMIUM_REQUIRED",
          );
        }

        if (input.invitedUserIds) {
          const invitees = await transaction.user.findMany({
            where: { id: { in: input.invitedUserIds } },
            select: { id: true },
          });
          if (invitees.length !== input.invitedUserIds.length) {
            throw new TournamentEconomyError(
              "Un ou plusieurs profils invités sont introuvables.",
              "NOT_FOUND",
            );
          }
        }

        const tournament = await transaction.tournament.create({
          data: {
            creatorId: input.creatorId,
            scope: input.scope,
            isPaid: input.isPaid,
            entryFee: new Prisma.Decimal(input.entryFeeCfa),
            entryPoints: input.entryPoints,
            maxPlayers: input.maxPlayers,
            status: TournamentStatus.OPEN,
          },
        });

        if (input.invitedUserIds) {
          await registerTournamentPlayerInTransaction(
            transaction,
            tournament.id,
            input.creatorId,
          );
          await transaction.tournamentInvitation.createMany({
            data: input.invitedUserIds.map((userId) => ({
              tournamentId: tournament.id,
              userId,
            })),
          });
        }
        return tournament;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

async function createOpeningRound(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  participants: { userId: string; seed: number }[],
): Promise<void> {
  const sorted = [...participants].sort((a, b) => a.seed - b.seed);
  const half = sorted.length / 2;
  await transaction.tournamentMatch.createMany({
    data: Array.from({ length: half }, (_, index) => ({
      tournamentId,
      stage: TournamentMatchStage.MAIN,
      round: 1,
      matchNumber: index + 1,
      playerWhiteId: sorted[index]!.userId,
      playerBlackId: sorted[sorted.length - index - 1]!.userId,
      status: TournamentMatchStatus.WAITING,
    })),
  });
}

export async function registerTournamentPlayer(
  tournamentId: string,
  userId: string,
) {
  if (!tournamentId || !userId) {
    throw new TournamentEconomyError(
      "Identifiants du tournoi et du joueur requis.",
      "INVALID_INPUT",
    );
  }

  return retrySerializable(() =>
    prisma.$transaction(
      (transaction) =>
        registerTournamentPlayerInTransaction(transaction, tournamentId, userId),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

async function registerTournamentPlayerInTransaction(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  userId: string,
) {
  const tournament = await transaction.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      isPaid: true,
      entryFee: true,
      entryPoints: true,
      maxPlayers: true,
      status: true,
      participants: { select: { userId: true, seed: true } },
    },
  });
  if (!tournament) {
    throw new TournamentEconomyError("Tournoi introuvable.", "NOT_FOUND");
  }
  if (tournament.status !== TournamentStatus.OPEN) {
    throw new TournamentEconomyError(
      "Les inscriptions à ce tournoi sont fermées.",
      "NOT_OPEN",
    );
  }
  if (tournament.participants.some((participant) => participant.userId === userId)) {
    throw new TournamentEconomyError(
      "Vous êtes déjà inscrit à ce tournoi.",
      "ALREADY_JOINED",
    );
  }
  if (tournament.participants.length >= tournament.maxPlayers) {
    throw new TournamentEconomyError(
      "Le tournoi a atteint sa capacité maximale.",
      "FULL",
    );
  }

  const user = await transaction.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    throw new TournamentEconomyError("Profil joueur introuvable.", "NOT_FOUND");
  }

  if (tournament.isPaid) {
    const debit = await transaction.user.updateMany({
      where: {
        id: userId,
        walletReal: { gte: tournament.entryFee },
      },
      data: { walletReal: { decrement: tournament.entryFee } },
    });
    if (debit.count !== 1) {
      throw new TournamentEconomyError(
        "Solde FCFA insuffisant pour le droit d’entrée.",
        "INSUFFICIENT_FUNDS",
      );
    }
    await transaction.balanceTransaction.create({
      data: {
        userId,
        balanceType: BalanceType.REAL_WALLET,
        transactionType: BalanceTransactionType.TOURNAMENT_ENTRY,
        amount: tournament.entryFee.negated(),
        referenceId: tournament.id,
        description: `Droit d’entrée au tournoi ${tournament.id}`,
      },
    });
  } else {
    const debit = await transaction.user.updateMany({
      where: {
        id: userId,
        pointsFree: { gte: tournament.entryPoints },
      },
      data: { pointsFree: { decrement: tournament.entryPoints } },
    });
    if (debit.count !== 1) {
      throw new TournamentEconomyError(
        `Il faut au moins ${tournament.entryPoints} points gratuits pour s’inscrire.`,
        "INSUFFICIENT_FUNDS",
      );
    }
    await transaction.balanceTransaction.create({
      data: {
        userId,
        balanceType: BalanceType.FREE_POINTS,
        transactionType: BalanceTransactionType.TOURNAMENT_POINTS_ENTRY,
        amount: new Prisma.Decimal(-tournament.entryPoints),
        referenceId: tournament.id,
        description: `Droit d’entrée en points au tournoi ${tournament.id}`,
      },
    });
  }

  const seed = tournament.participants.length + 1;
  await transaction.tournamentParticipant.create({
    data: { tournamentId, userId, seed },
  });
  const joinedCount = seed;
  if (joinedCount === tournament.maxPlayers) {
    const gross = tournament.entryFee.mul(tournament.maxPlayers);
    const platformFee = tournament.isPaid
      ? gross.mul("0.10").toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : new Prisma.Decimal(0);
    await transaction.tournament.update({
      where: { id: tournament.id },
      data: {
        status: TournamentStatus.IN_PROGRESS,
        totalPrizePool: gross.minus(platformFee),
        platformFee,
      },
    });
    await createOpeningRound(transaction, tournament.id, [
      ...tournament.participants,
      { userId, seed },
    ]);
  }

  const updatedUser = await transaction.user.findUniqueOrThrow({
    where: { id: userId },
    select: { pointsFree: true, walletReal: true },
  });
  return {
    seed,
    tournamentStarted: joinedCount === tournament.maxPlayers,
    participants: joinedCount,
    pointsFree: updatedUser.pointsFree,
    walletReal: updatedUser.walletReal.toString(),
  };
}

export async function inviteTournamentPlayers(
  tournamentId: string,
  creatorId: string,
  userIds: string[],
): Promise<number> {
  if (!tournamentId || !creatorId || userIds.length === 0) {
    throw new TournamentEconomyError(
      "Tournoi, organisateur et joueurs invités requis.",
      "INVALID_INPUT",
    );
  }
  if (new Set(userIds).size !== userIds.length || userIds.includes(creatorId)) {
    throw new TournamentEconomyError(
      "La liste des invitations contient des doublons ou l’organisateur.",
      "INVALID_INPUT",
    );
  }

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { creatorId: true, status: true, isPaid: true, maxPlayers: true },
  });
  if (!tournament) {
    throw new TournamentEconomyError("Tournoi introuvable.", "NOT_FOUND");
  }
  if (tournament.creatorId !== creatorId) {
    throw new TournamentEconomyError(
      "Seul l’organisateur peut envoyer des invitations.",
      "INVALID_INPUT",
    );
  }
  if (tournament.status !== TournamentStatus.OPEN || tournament.isPaid) {
    throw new TournamentEconomyError(
      "Les invitations sont réservées aux tournois gratuits ouverts.",
      "NOT_OPEN",
    );
  }
  if (userIds.length + 1 > tournament.maxPlayers) {
    throw new TournamentEconomyError(
      "Le nombre d’invités dépasse les places disponibles.",
      "INVALID_INPUT",
    );
  }

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true },
  });
  if (users.length !== userIds.length) {
    throw new TournamentEconomyError(
      "Un ou plusieurs profils invités sont introuvables.",
      "NOT_FOUND",
    );
  }

  const result = await prisma.tournamentInvitation.createMany({
    data: userIds.map((userId) => ({ tournamentId, userId })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function respondToTournamentInvitation(
  tournamentId: string,
  invitationId: string,
  userId: string,
  accept: boolean,
) {
  if (!tournamentId || !invitationId || !userId) {
    throw new TournamentEconomyError(
      "Identifiants d’invitation incomplets.",
      "INVALID_INPUT",
    );
  }

  return retrySerializable(() =>
    prisma.$transaction(
      async (transaction) => {
        const invitation = await transaction.tournamentInvitation.findFirst({
          where: { id: invitationId, tournamentId, userId },
          select: { id: true, status: true },
        });
        if (!invitation) {
          throw new TournamentEconomyError(
            "Invitation introuvable pour ce profil.",
            "NOT_FOUND",
          );
        }
        if (invitation.status !== TournamentInvitationStatus.PENDING) {
          throw new TournamentEconomyError(
            "Cette invitation a déjà reçu une réponse.",
            "NOT_OPEN",
          );
        }

        const registration = accept
          ? await registerTournamentPlayerInTransaction(
              transaction,
              tournamentId,
              userId,
            )
          : null;
        await transaction.tournamentInvitation.update({
          where: { id: invitation.id },
          data: {
            status: accept
              ? TournamentInvitationStatus.ACCEPTED
              : TournamentInvitationStatus.DECLINED,
            respondedAt: new Date(),
          },
        });
        return { accepted: accept, registration };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

function splitMoneyPrizePool(
  net: Prisma.Decimal,
): [Prisma.Decimal, Prisma.Decimal, Prisma.Decimal] {
  const first = net.mul("0.50").toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const second = net
    .mul("0.30")
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return [first, second, net.minus(first).minus(second)];
}

function splitPointPrizePool(total: number): [number, number, number] {
  const first = Math.floor(total * 0.5);
  const second = Math.floor(total * 0.3);
  return [first, second, total - first - second];
}

async function finishTournament(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
): Promise<void> {
  const tournament = await transaction.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: {
      id: true,
      isPaid: true,
      entryPoints: true,
      maxPlayers: true,
      totalPrizePool: true,
      bracketMatches: {
        where: { stage: TournamentMatchStage.MAIN },
        orderBy: [{ round: "desc" }, { matchNumber: "asc" }],
        select: {
          round: true,
          matchNumber: true,
          playerWhiteId: true,
          playerBlackId: true,
          winnerId: true,
          loserId: true,
        },
      },
    },
  });
  const rounds = Math.log2(tournament.maxPlayers);
  const final = tournament.bracketMatches.find(
    (match) => match.round === rounds && match.matchNumber === 1,
  );
  const bronze = await transaction.tournamentMatch.findFirst({
    where: {
      tournamentId,
      stage: TournamentMatchStage.THIRD_PLACE,
    },
    select: { winnerId: true, loserId: true },
  });
  if (!final?.winnerId || !final.loserId || !bronze?.winnerId || !bronze.loserId) {
    return;
  }

  const placements = [
    { userId: final.winnerId, place: 1 },
    { userId: final.loserId, place: 2 },
    { userId: bronze.winnerId, place: 3 },
    { userId: bronze.loserId, place: 4 },
  ];
  for (const placement of placements) {
    await transaction.tournamentParticipant.update({
      where: {
        tournamentId_userId: {
          tournamentId,
          userId: placement.userId,
        },
      },
      data: { placement: placement.place },
    });
  }

  if (tournament.isPaid) {
    const prizes = splitMoneyPrizePool(tournament.totalPrizePool);
    for (let index = 0; index < 3; index += 1) {
      const prize = prizes[index]!;
      const userId = placements[index]!.userId;
      if (prize.isZero()) continue;
      await transaction.user.update({
        where: { id: userId },
        data: { walletReal: { increment: prize } },
      });
      await transaction.balanceTransaction.create({
        data: {
          userId,
          balanceType: BalanceType.REAL_WALLET,
          transactionType: BalanceTransactionType.TOURNAMENT_PRIZE,
          amount: prize,
          referenceId: `${tournamentId}:${index + 1}`,
          description: `Prix de la ${index + 1}${index === 0 ? "ère" : "e"} place au tournoi ${tournamentId}`,
        },
      });
    }
  } else {
    const total = tournament.entryPoints * tournament.maxPlayers;
    const prizes = splitPointPrizePool(total);
    for (let index = 0; index < 3; index += 1) {
      const prize = prizes[index]!;
      const userId = placements[index]!.userId;
      if (prize === 0) continue;
      await transaction.user.update({
        where: { id: userId },
        data: { pointsFree: { increment: prize } },
      });
      await transaction.balanceTransaction.create({
        data: {
          userId,
          balanceType: BalanceType.FREE_POINTS,
          transactionType: BalanceTransactionType.TOURNAMENT_POINTS_PRIZE,
          amount: new Prisma.Decimal(prize),
          referenceId: `${tournamentId}:${index + 1}`,
          description: `Prix virtuel de la ${index + 1}${index === 0 ? "ère" : "e"} place au tournoi ${tournamentId}`,
        },
      });
    }
  }

  await transaction.tournament.update({
    where: { id: tournamentId },
    data: { status: TournamentStatus.COMPLETED },
  });
}

export async function recordValidatedTournamentResult(
  tournamentMatchId: string,
  winnerId: string,
): Promise<void> {
  await retrySerializable(() =>
    prisma.$transaction(
      async (transaction) => {
        const match = await transaction.tournamentMatch.findUnique({
          where: { id: tournamentMatchId },
          select: {
            id: true,
            tournamentId: true,
            stage: true,
            round: true,
            matchNumber: true,
            playerWhiteId: true,
            playerBlackId: true,
            status: true,
            tournament: {
              select: {
                status: true,
                maxPlayers: true,
              },
            },
          },
        });
        if (!match) {
          throw new TournamentEconomyError(
            "Match de tournoi introuvable.",
            "NOT_FOUND",
          );
        }
        if (
          match.tournament.status !== TournamentStatus.IN_PROGRESS ||
          match.status === TournamentMatchStatus.FINISHED
        ) {
          throw new TournamentEconomyError(
            "Ce match est déjà terminé ou le tournoi n’est pas en cours.",
            "NOT_SETTLEABLE",
          );
        }
        if (
          !match.playerWhiteId ||
          !match.playerBlackId ||
          (winnerId !== match.playerWhiteId && winnerId !== match.playerBlackId)
        ) {
          throw new TournamentEconomyError(
            "Le vainqueur doit être l’un des joueurs du match.",
            "INVALID_RESULT",
          );
        }
        const loserId =
          winnerId === match.playerWhiteId
            ? match.playerBlackId
            : match.playerWhiteId;
        const claimed = await transaction.tournamentMatch.updateMany({
          where: {
            id: match.id,
            status: { not: TournamentMatchStatus.FINISHED },
          },
          data: {
            winnerId,
            loserId,
            status: TournamentMatchStatus.FINISHED,
            completedAt: new Date(),
          },
        });
        if (claimed.count !== 1) {
          throw new TournamentEconomyError(
            "Le résultat a déjà été enregistré.",
            "NOT_SETTLEABLE",
          );
        }

        if (match.stage === TournamentMatchStage.THIRD_PLACE) {
          await finishTournament(transaction, match.tournamentId);
          return;
        }

        const currentRoundMatches = await transaction.tournamentMatch.findMany({
          where: {
            tournamentId: match.tournamentId,
            stage: TournamentMatchStage.MAIN,
            round: match.round,
          },
          orderBy: { matchNumber: "asc" },
          select: {
            round: true,
            matchNumber: true,
            playerWhiteId: true,
            playerBlackId: true,
            winnerId: true,
            loserId: true,
            status: true,
          },
        });
        if (
          currentRoundMatches.some(
            (item) => item.status !== TournamentMatchStatus.FINISHED,
          )
        ) {
          return;
        }

        const eliminatedPlace =
          Math.floor(match.tournament.maxPlayers / 2 ** match.round) + 1;
        const losers = currentRoundMatches.flatMap((item) =>
          item.loserId ? [item.loserId] : [],
        );
        for (const loser of losers) {
          await transaction.tournamentParticipant.update({
            where: {
              tournamentId_userId: {
                tournamentId: match.tournamentId,
                userId: loser,
              },
            },
            data: { placement: eliminatedPlace },
          });
        }

        const finalRound = Math.log2(match.tournament.maxPlayers);
        const winners = currentRoundMatches.flatMap((item) =>
          item.winnerId ? [item.winnerId] : [],
        );
        if (match.round === finalRound) {
          await finishTournament(transaction, match.tournamentId);
          return;
        }
        if (match.round === finalRound - 1) {
          if (winners.length !== 2 || losers.length !== 2) {
            throw new TournamentEconomyError(
              "Les demi-finales ne permettent pas de générer la finale.",
              "INVALID_RESULT",
            );
          }
          await transaction.tournamentMatch.createMany({
            data: [
              {
                tournamentId: match.tournamentId,
                stage: TournamentMatchStage.MAIN,
                round: finalRound,
                matchNumber: 1,
                playerWhiteId: winners[0]!,
                playerBlackId: winners[1]!,
                status: TournamentMatchStatus.WAITING,
              },
              {
                tournamentId: match.tournamentId,
                stage: TournamentMatchStage.THIRD_PLACE,
                round: finalRound,
                matchNumber: 1,
                playerWhiteId: losers[0]!,
                playerBlackId: losers[1]!,
                status: TournamentMatchStatus.WAITING,
              },
            ],
          });
          return;
        }

        await transaction.tournamentMatch.createMany({
          data: Array.from({ length: winners.length / 2 }, (_, index) => ({
            tournamentId: match.tournamentId,
            stage: TournamentMatchStage.MAIN,
            round: match.round + 1,
            matchNumber: index + 1,
            playerWhiteId: winners[index * 2]!,
            playerBlackId: winners[index * 2 + 1]!,
            status: TournamentMatchStatus.WAITING,
          })),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
