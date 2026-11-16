import {
  BalanceTransactionType,
  BalanceType,
  BetStatus,
  Prisma,
  TournamentInvitationStatus,
  TournamentMatchStage,
  TournamentMatchStatus,
  TournamentParticipantStatus,
  TournamentType,
  TournamentScope,
  TournamentStatus,
  TournamentWalletTransactionType,
} from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";

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
      | "NOT_ELIGIBLE"
      | "INVALID_RESULT"
      | "NOT_SETTLEABLE",
  ) {
    super(message);
    this.name = "TournamentEconomyError";
  }
}

export interface CreateTournamentInput {
  creatorId: string;
  name: string;
  type: TournamentType;
  scope: TournamentScope;
  gameType: "CHESS" | "CHECKERS";
  draughtsVariant: "ENGLISH" | "INTERNATIONAL";
  city?: string | null;
  region?: string | null;
  country?: string | null;
  continent?: string | null;
  isPaid: boolean;
  entryFeeCfa: number;
  entryPoints: number;
  maxPlayers: number;
  timeControlMinutes?: number;
  minElo?: number;
  maxElo?: number;
  minPoints?: number;
  maxPoints?: number;
  initialCapital?: number;
  minBet?: number;
  maxBet?: number;
  betMode: "FIXED" | "VARIABLE";
  rebuyEnabled: boolean;
  invitedUserIds?: string[];
  visibility?: "PUBLIC" | "PRIVATE" | "CLUB";
  clubId?: string | null;
  description?: string | null;
}

function assertCapacity(maxPlayers: number): void {
  // Le tableau à élimination directe exige une puissance de 2 ; les bornes
  // fines (min/max, privilèges Premium) sont vérifiées par TournamentEligibilityEngine.
  if (
    !Number.isInteger(maxPlayers) ||
    maxPlayers < 2 ||
    maxPlayers > 1024 ||
    (maxPlayers & (maxPlayers - 1)) !== 0
  ) {
    throw new TournamentEconomyError(
      "Le nombre de joueurs doit être une puissance de 2 (4, 8, 16, 32, 64…).",
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
  if (input.type === TournamentType.SURVIVAL_BANK && input.isPaid) {
    throw new TournamentEconomyError(
      "Le mode Survival Bank utilise uniquement des points gratuits.",
      "INVALID_INPUT",
    );
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
  if (input.type === TournamentType.SURVIVAL_BANK) {
    const minBet = input.minBet ?? 1;
    const maxBet = input.maxBet ?? input.entryPoints;
    assertFee(minBet, "La mise minimale par match", 1);
    assertFee(maxBet, "La mise maximale par match", 1);
    if (minBet > maxBet || maxBet > input.entryPoints) {
      throw new TournamentEconomyError(
        "Les mises doivent respecter la limite minimale, la limite maximale et le capital d’entrée.",
        "INVALID_INPUT",
      );
    }
  }

  return retrySerializable(() =>
    prisma.$transaction(
      async (transaction) => {
        const creator = await transaction.user.findUnique({
          where: { id: input.creatorId },
          select: { isPremium: true, isAdmin: true },
        });
        if (!creator) {
          throw new TournamentEconomyError("Créateur introuvable.", "NOT_FOUND");
        }
        // Les droits de création (Premium, Survival ouvert à tous, formats,
        // portée, limites) sont vérifiés en amont par TournamentEligibilityEngine.

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

        const type = input.type;
        const survivalBankEnabled = type === TournamentType.SURVIVAL_BANK;
        const tournament = await transaction.tournament.create({
          data: {
            name: input.name,
            creatorId: input.creatorId,
            type,
            scope: input.scope,
            city: input.city,
            region: input.region,
            country: input.country,
            continent: input.continent,
            isPaid: input.isPaid,
            entryFee: new Prisma.Decimal(input.entryFeeCfa),
            entryPoints: input.entryPoints,
            maxPlayers: input.maxPlayers,
            gameType: input.gameType,
            draughtsVariant: input.draughtsVariant,
            timeControlMinutes: input.timeControlMinutes,
            minElo: input.minElo,
            maxElo: input.maxElo,
            minPoints: input.minPoints,
            maxPoints: input.maxPoints,
            initialCapital: survivalBankEnabled ? input.entryPoints : input.initialCapital,
            minBet: survivalBankEnabled ? (input.minBet ?? 1) : input.minBet,
            maxBet: survivalBankEnabled
              ? (input.maxBet ?? input.entryPoints)
              : input.maxBet,
            betMode: input.betMode,
            survivalBankEnabled,
            rebuyEnabled: input.rebuyEnabled,
            visibility: input.visibility ?? "PUBLIC",
            clubId: input.clubId ?? null,
            description: input.description ?? null,
            status: TournamentStatus.OPEN,
          },
        });

        await registerTournamentPlayerInTransaction(
          transaction,
          tournament.id,
          input.creatorId,
        );
        if (input.invitedUserIds?.length) {
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
      type: true,
      entryFee: true,
      entryPoints: true,
      maxPlayers: true,
      status: true,
      minElo: true,
      maxElo: true,
      minPoints: true,
      maxPoints: true,
      survivalBankEnabled: true,
      visibility: true,
      clubId: true,
      creatorId: true,
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
  if (tournament.visibility === "PRIVATE" && tournament.creatorId !== userId) {
    const invitation = await transaction.tournamentInvitation.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
      select: { status: true },
    });
    if (!invitation || invitation.status === TournamentInvitationStatus.DECLINED) {
      throw new TournamentEconomyError("Ce tournoi privé est réservé aux invités.", "NOT_ELIGIBLE");
    }
  }
  if (tournament.visibility === "CLUB" && tournament.clubId) {
    const member = await transaction.clubMember.findUnique({
      where: { clubId_userId: { clubId: tournament.clubId, userId } },
      select: { id: true },
    });
    if (!member) {
      throw new TournamentEconomyError("Ce tournoi est réservé aux membres du club.", "NOT_ELIGIBLE");
    }
  }

  const user = await transaction.user.findUnique({
    where: { id: userId },
    select: { id: true, pointsFree: true, walletReal: true, elo: true },
  });
  if (!user) {
    throw new TournamentEconomyError("Profil joueur introuvable.", "NOT_FOUND");
  }
  if (tournament.minElo !== null && user.elo < tournament.minElo) {
    throw new TournamentEconomyError(
      `Votre Elo (${user.elo}) est inférieur au minimum requis (${tournament.minElo}).`,
      "NOT_ELIGIBLE",
    );
  }
  if (tournament.maxElo !== null && user.elo > tournament.maxElo) {
    throw new TournamentEconomyError(
      `Votre Elo (${user.elo}) dépasse le maximum autorisé (${tournament.maxElo}).`,
      "NOT_ELIGIBLE",
    );
  }
  if (tournament.minPoints !== null && user.pointsFree < tournament.minPoints) {
    throw new TournamentEconomyError(
      `Il faut au moins ${tournament.minPoints} points gratuits pour participer.`,
      "NOT_ELIGIBLE",
    );
  }
  if (tournament.maxPoints !== null && user.pointsFree > tournament.maxPoints) {
    throw new TournamentEconomyError(
      `Le maximum autorisé est de ${tournament.maxPoints} points gratuits.`,
      "NOT_ELIGIBLE",
    );
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
  if (tournament.survivalBankEnabled) {
    const wallet = await transaction.tournamentWallet.create({
      data: {
        tournamentId,
        userId,
        capital: tournament.entryPoints,
        initialCapital: tournament.entryPoints,
        status: TournamentParticipantStatus.ACTIVE,
      },
    });
    await transaction.tournamentWalletTransaction.create({
      data: {
        walletId: wallet.id,
        tournamentId,
        userId,
        type: TournamentWalletTransactionType.DEPOSIT,
        amount: tournament.entryPoints,
        balanceAfter: tournament.entryPoints,
        referenceId: tournament.id,
        description: `Droit d’entrée placé dans le portefeuille du tournoi ${tournament.id}`,
      },
    });
  }
  const joinedCount = seed;
  if (joinedCount === tournament.maxPlayers) {
    const gross = tournament.entryFee.mul(tournament.maxPlayers);
    const rules = await getSettings([
      "platform_fee_percentage",
      "tournaments.freezeRulesOnStart",
      "survival_bank_rebuy_cost",
      "survival_bank_min_bet",
      "survival_bank_max_bet",
      "points.classic.winBase",
      "points.classic.pieceBonusCap",
    ] as const);
    const feePercent = rules["platform_fee_percentage"];
    const platformFee = tournament.isPaid
      ? gross.mul(new Prisma.Decimal(feePercent)).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : new Prisma.Decimal(0);
    await transaction.tournament.update({
      where: { id: tournament.id },
      data: {
        status: TournamentStatus.IN_PROGRESS,
        startedAt: new Date(),
        totalPrizePool: gross.minus(platformFee),
        platformFee,
        // Règles figées : toute modification ultérieure des paramètres
        // n'affecte pas un tournoi déjà lancé.
        ...(rules["tournaments.freezeRulesOnStart"]
          ? {
              configSnapshot: {
                frozenAt: new Date().toISOString(),
                platformFeePercent: feePercent,
                survivalRebuyCost: rules["survival_bank_rebuy_cost"],
                survivalMinBet: rules["survival_bank_min_bet"],
                survivalMaxBet: rules["survival_bank_max_bet"],
                pointsWinBase: rules["points.classic.winBase"],
                pointsPieceBonusCap: rules["points.classic.pieceBonusCap"],
              },
            }
          : {}),
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
      type: true,
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
      data: {
        placement: placement.place,
        status:
          placement.place === 1
            ? TournamentParticipantStatus.WON
            : TournamentParticipantStatus.ELIMINATED,
        eliminatedAt:
          placement.place === 1 ? null : new Date(),
      },
    });
  }

  if (tournament.type === TournamentType.SURVIVAL_BANK) {
    const wallets = await transaction.tournamentWallet.findMany({
      where: { tournamentId },
    });
    for (const wallet of wallets) {
      await transaction.tournamentWallet.update({
        where: { id: wallet.id },
        data: {
          ...(wallet.capital > 0 ? { capital: 0 } : {}),
          status:
            wallet.userId === placements[0]!.userId
              ? TournamentParticipantStatus.WON
              : TournamentParticipantStatus.ELIMINATED,
        },
      });
      if (wallet.capital <= 0) continue;
      const newPoints = await transaction.user.updateMany({
        where: { id: wallet.userId },
        data: { pointsFree: { increment: wallet.capital } },
      });
      if (newPoints.count !== 1) {
        throw new TournamentEconomyError(
          "Impossible de restituer le solde de tournoi au joueur.",
          "NOT_FOUND",
        );
      }
      await transaction.tournamentWalletTransaction.create({
        data: {
          walletId: wallet.id,
          tournamentId,
          userId: wallet.userId,
          type: TournamentWalletTransactionType.WITHDRAWAL,
          amount: -wallet.capital,
          balanceAfter: 0,
          referenceId: `tournament-finish:${tournamentId}`,
          description: `Restitution du solde restant à la fin du tournoi ${tournamentId}`,
        },
      });
    }
  } else if (tournament.isPaid) {
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
            betAmount: true,
            playerWhiteId: true,
            playerBlackId: true,
            status: true,
            tournament: {
              select: {
                status: true,
                maxPlayers: true,
                type: true,
                minBet: true,
                maxBet: true,
                survivalBankEnabled: true,
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

        if (match.tournament.survivalBankEnabled) {
          const wallets = await transaction.tournamentWallet.findMany({
            where: {
              tournamentId: match.tournamentId,
              userId: { in: [match.playerWhiteId, match.playerBlackId] },
            },
          });
          const whiteWallet = wallets.find(
            (wallet) => wallet.userId === match.playerWhiteId,
          );
          const blackWallet = wallets.find(
            (wallet) => wallet.userId === match.playerBlackId,
          );
          if (!whiteWallet || !blackWallet) {
            throw new TournamentEconomyError(
              "Portefeuille de tournoi introuvable pour un joueur.",
              "NOT_FOUND",
            );
          }

          const stake = match.betAmount ?? match.tournament.minBet ?? 0;
          if (match.tournament.maxBet !== null && stake > match.tournament.maxBet) {
            throw new TournamentEconomyError(
              "La mise du match dépasse le maximum autorisé par le tournoi.",
              "INVALID_INPUT",
            );
          }
          if (stake > 0) {
            const [whiteDebit, blackDebit] = await Promise.all([
              transaction.tournamentWallet.updateMany({
                where: {
                  id: whiteWallet.id,
                  status: TournamentParticipantStatus.ACTIVE,
                  capital: { gte: stake },
                },
                data: { capital: { decrement: stake } },
              }),
              transaction.tournamentWallet.updateMany({
                where: {
                  id: blackWallet.id,
                  status: TournamentParticipantStatus.ACTIVE,
                  capital: { gte: stake },
                },
                data: { capital: { decrement: stake } },
              }),
            ]);
            if (whiteDebit.count !== 1 || blackDebit.count !== 1) {
              throw new TournamentEconomyError(
                `Chaque joueur doit avoir au moins ${stake} points dans son portefeuille de tournoi pour jouer.`,
                "INSUFFICIENT_FUNDS",
              );
            }

            const winnerWallet =
              winnerId === whiteWallet.userId ? whiteWallet : blackWallet;
            const loserWallet =
              winnerId === whiteWallet.userId ? blackWallet : whiteWallet;
            const winnerBalance = winnerWallet.capital + stake;
            const loserBalance = loserWallet.capital - stake;
            await transaction.tournamentWallet.update({
              where: { id: winnerWallet.id },
              data: {
                capital: winnerBalance,
                totalWon: { increment: 1 },
                matchesPlayed: { increment: 1 },
                matchesWon: { increment: 1 },
                winStreak: { increment: 1 },
              },
            });
            await transaction.tournamentWallet.update({
              where: { id: loserWallet.id },
              data: {
                totalLost: { increment: 1 },
                matchesPlayed: { increment: 1 },
                matchesLost: { increment: 1 },
                winStreak: 0,
              },
            });
            await transaction.tournamentWalletTransaction.createMany({
              data: [
                {
                  walletId: whiteWallet.id,
                  tournamentId: match.tournamentId,
                  userId: whiteWallet.userId,
                  type: TournamentWalletTransactionType.BET_PLACED,
                  amount: -stake,
                  balanceAfter: whiteWallet.capital - stake,
                  referenceId: match.id,
                  description: `Mise du match ${match.id}`,
                },
                {
                  walletId: blackWallet.id,
                  tournamentId: match.tournamentId,
                  userId: blackWallet.userId,
                  type: TournamentWalletTransactionType.BET_PLACED,
                  amount: -stake,
                  balanceAfter: blackWallet.capital - stake,
                  referenceId: match.id,
                  description: `Mise du match ${match.id}`,
                },
                {
                  walletId: winnerWallet.id,
                  tournamentId: match.tournamentId,
                  userId: winnerWallet.userId,
                  type: TournamentWalletTransactionType.BET_WON,
                  amount: stake * 2,
                  balanceAfter: winnerBalance,
                  referenceId: match.id,
                  description: `Gain des mises du match ${match.id}`,
                },
                {
                  walletId: loserWallet.id,
                  tournamentId: match.tournamentId,
                  userId: loserWallet.userId,
                  type: TournamentWalletTransactionType.BET_LOST,
                  amount: -stake,
                  balanceAfter: loserBalance,
                  referenceId: match.id,
                  description: `Perte de la mise du match ${match.id}`,
                },
              ],
            });
            const now = new Date();
            await transaction.tournamentBet.createMany({
              data: [
                {
                  tournamentId: match.tournamentId,
                  matchId: match.id,
                  walletId: whiteWallet.id,
                  userId: whiteWallet.userId,
                  amount: stake,
                  status: BetStatus.SETTLED,
                  acceptedAt: now,
                  settledAt: now,
                },
                {
                  tournamentId: match.tournamentId,
                  matchId: match.id,
                  walletId: blackWallet.id,
                  userId: blackWallet.userId,
                  amount: stake,
                  status: BetStatus.SETTLED,
                  acceptedAt: now,
                  settledAt: now,
                },
              ],
            });
            const minimumStake = match.tournament.minBet ?? 0;
            if (loserBalance < minimumStake) {
              await transaction.tournamentWallet.update({
                where: { id: loserWallet.id },
                data: {
                  status: TournamentParticipantStatus.ELIMINATED,
                  eliminatedAt: new Date(),
                  eliminationReason: "Capital inférieur à la mise minimale",
                },
              });
              await transaction.tournamentParticipant.updateMany({
                where: { tournamentId: match.tournamentId, userId: loserId },
                data: {
                  status: TournamentParticipantStatus.ELIMINATED,
                  eliminatedAt: new Date(),
                },
              });
            }
          } else {
            await transaction.tournamentWallet.update({
              where: { id: (winnerId === whiteWallet.userId ? whiteWallet : blackWallet).id },
              data: {
                matchesPlayed: { increment: 1 },
                matchesWon: { increment: 1 },
                winStreak: { increment: 1 },
              },
            });
            await transaction.tournamentWallet.update({
              where: { id: (winnerId === whiteWallet.userId ? blackWallet : whiteWallet).id },
              data: {
                matchesPlayed: { increment: 1 },
                matchesLost: { increment: 1 },
                winStreak: 0,
              },
            });
          }
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
