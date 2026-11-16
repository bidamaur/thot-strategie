import {
  BalanceTransactionType,
  BalanceType,
  BetStatus,
  MatchStatus,
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
import { withSerializableRetry } from "@/lib/db/retry";
import {
  computeStandings,
  roundRobinSchedule,
  swissPairings,
  swissRoundCount,
  type Pairing,
} from "@/lib/tournament/standings";

/** Formats en tableau à élimination (puissance de 2). */
const BRACKET_TYPES = new Set<TournamentType>([TournamentType.ELIMINATION, TournamentType.SURVIVAL_BANK]);
/** Formats à points, classés par score et départages. */
const STANDINGS_TYPES = new Set<TournamentType>([
  TournamentType.SWISS,
  TournamentType.ROUND_ROBIN,
  TournamentType.LEAGUE,
]);
/** Formats jouables de bout en bout. */
export const PLAYABLE_TOURNAMENT_TYPES = new Set<TournamentType>([...BRACKET_TYPES, ...STANDINGS_TYPES]);

export function isStandingsFormat(type: TournamentType): boolean {
  return STANDINGS_TYPES.has(type);
}

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

async function assertCapacity(maxPlayers: number, type: TournamentType): Promise<void> {
  if (!PLAYABLE_TOURNAMENT_TYPES.has(type)) {
    throw new TournamentEconomyError(
      "Ce format n’est pas encore disponible à l’organisation.",
      "INVALID_INPUT",
    );
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 3 || maxPlayers > 1024) {
    throw new TournamentEconomyError("Nombre de joueurs invalide.", "INVALID_INPUT");
  }
  // Le tableau à élimination directe exige une puissance de 2 ; les bornes
  // fines (min/max, privilèges Premium) sont vérifiées par TournamentEligibilityEngine.
  if (BRACKET_TYPES.has(type) && (maxPlayers & (maxPlayers - 1)) !== 0) {
    throw new TournamentEconomyError(
      "Ce format à élimination exige 4, 8, 16, 32 ou 64 joueurs.",
      "INVALID_INPUT",
    );
  }
  if (type === TournamentType.ROUND_ROBIN || type === TournamentType.LEAGUE) {
    const settings = await getSettings(["tournaments.roundRobinMaxPlayers"] as const);
    const max = settings["tournaments.roundRobinMaxPlayers"];
    if (maxPlayers > max) {
      throw new TournamentEconomyError(
        `Les formats toutes rondes et ligue sont limités à ${max} joueurs.`,
        "INVALID_INPUT",
      );
    }
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
  await assertCapacity(input.maxPlayers, input.type);
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

async function insertPairings(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  round: number,
  pairings: Pairing[],
): Promise<void> {
  const now = new Date();
  await transaction.tournamentMatch.createMany({
    data: pairings.map((pairing, index) => ({
      tournamentId,
      stage: TournamentMatchStage.MAIN,
      round,
      matchNumber: index + 1,
      playerWhiteId: pairing.whiteId,
      playerBlackId: pairing.blackId,
      // Un exempt est un point acquis : le match est clos d'office.
      ...(pairing.blackId === null
        ? { status: TournamentMatchStatus.FINISHED, winnerId: pairing.whiteId, completedAt: now }
        : { status: TournamentMatchStatus.WAITING }),
    })),
  });
}

async function createOpeningRound(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  participants: { userId: string; seed: number }[],
  type: TournamentType,
): Promise<void> {
  const sorted = [...participants].sort((a, b) => a.seed - b.seed);

  if (type === TournamentType.ROUND_ROBIN || type === TournamentType.LEAGUE) {
    // Calendrier complet généré d'emblée : les parties peuvent se jouer
    // dans n'importe quel ordre.
    const rounds = roundRobinSchedule(
      sorted.map((p) => p.userId),
      type === TournamentType.LEAGUE,
    );
    for (let r = 0; r < rounds.length; r += 1) {
      await insertPairings(transaction, tournamentId, r + 1, rounds[r]!);
    }
    return;
  }

  if (type === TournamentType.SWISS) {
    // Ronde 1 : moitié haute contre moitié basse des têtes de série.
    const half = Math.floor(sorted.length / 2);
    const pairings: Pairing[] = [];
    for (let i = 0; i < half; i += 1) {
      pairings.push(
        i % 2 === 0
          ? { whiteId: sorted[i]!.userId, blackId: sorted[i + half]!.userId }
          : { whiteId: sorted[i + half]!.userId, blackId: sorted[i]!.userId },
      );
    }
    if (sorted.length % 2 === 1) {
      pairings.push({ whiteId: sorted[sorted.length - 1]!.userId, blackId: null });
    }
    await insertPairings(transaction, tournamentId, 1, pairings);
    return;
  }

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

/** Classement courant d'un tournoi à points. */
export async function getTournamentStandings(
  client: Prisma.TransactionClient | typeof prisma,
  tournamentId: string,
) {
  const [participants, matches] = await Promise.all([
    client.tournamentParticipant.findMany({
      where: { tournamentId },
      select: { userId: true, seed: true },
    }),
    client.tournamentMatch.findMany({
      where: { tournamentId, stage: TournamentMatchStage.MAIN },
      select: { playerWhiteId: true, playerBlackId: true, winnerId: true, status: true },
    }),
  ]);
  return computeStandings(
    participants,
    matches
      .filter((m) => m.playerWhiteId)
      .map((m) => ({
        whiteId: m.playerWhiteId!,
        blackId: m.playerBlackId,
        winnerId: m.winnerId,
        finished: m.status === TournamentMatchStatus.FINISHED,
      })),
  );
}

/**
 * Fait avancer un tournoi à points après un résultat : ronde suisse suivante
 * quand la ronde courante est terminée, clôture quand tout est joué.
 */
async function advanceStandingsTournament(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  type: TournamentType,
  round: number,
): Promise<void> {
  const pending = await transaction.tournamentMatch.count({
    where: {
      tournamentId,
      stage: TournamentMatchStage.MAIN,
      status: { not: TournamentMatchStatus.FINISHED },
      ...(type === TournamentType.SWISS ? { round } : {}),
    },
  });
  if (pending > 0) return;

  if (type === TournamentType.SWISS) {
    const [participantCount, settings, tournament] = await Promise.all([
      transaction.tournamentParticipant.count({ where: { tournamentId } }),
      getSettings(["tournaments.swissRounds"] as const),
      transaction.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        select: { configSnapshot: true },
      }),
    ]);
    const frozen = (tournament.configSnapshot as { swissRounds?: number } | null)?.swissRounds;
    const totalRounds = swissRoundCount(participantCount, frozen ?? settings["tournaments.swissRounds"]);
    if (round < totalRounds) {
      const standings = await getTournamentStandings(transaction, tournamentId);
      await insertPairings(transaction, tournamentId, round + 1, swissPairings(standings));
      // Un exempt peut à lui seul compléter la ronde : rien d'autre à faire,
      // la ronde suivante attend les vraies parties.
      return;
    }
  }

  const standings = await getTournamentStandings(transaction, tournamentId);
  await closeTournament(
    transaction,
    tournamentId,
    standings.map((row) => ({ userId: row.userId, place: row.rank })),
  );
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
      "tournaments.swissRounds",
      "tournaments.prizeSplitPercent",
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
                swissRounds: rules["tournaments.swissRounds"],
                prizeSplitPercent: rules["tournaments.prizeSplitPercent"],
              },
            }
          : {}),
      },
    });
    await createOpeningRound(
      transaction,
      tournament.id,
      [...tournament.participants, { userId, seed }],
      tournament.type,
    );
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
  split: [number, number, number],
): [Prisma.Decimal, Prisma.Decimal, Prisma.Decimal] {
  const first = net.mul(split[0]).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const second = net.mul(split[1]).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return [first, second, net.minus(first).minus(second)];
}

function splitPointPrizePool(total: number, split: [number, number, number]): [number, number, number] {
  const first = Math.floor((total * split[0]) / 100);
  const second = Math.floor((total * split[1]) / 100);
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

  await closeTournament(transaction, tournamentId, [
    { userId: final.winnerId, place: 1 },
    { userId: final.loserId, place: 2 },
    { userId: bronze.winnerId, place: 3 },
    { userId: bronze.loserId, place: 4 },
  ]);
}

/**
 * Clôture commune à tous les formats : places, restitution des portefeuilles
 * Survival, prix (points ou argent) selon la répartition figée au lancement.
 */
async function closeTournament(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  placements: { userId: string; place: number }[],
): Promise<void> {
  const closed = await transaction.tournament.updateMany({
    where: { id: tournamentId, status: TournamentStatus.IN_PROGRESS },
    data: {
      status: TournamentStatus.COMPLETED,
      finishedAt: new Date(),
      winnerId: placements[0]?.userId ?? null,
    },
  });
  if (closed.count !== 1) return; // déjà clôturé : idempotence
  const tournament = await transaction.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: {
      isPaid: true,
      entryPoints: true,
      maxPlayers: true,
      totalPrizePool: true,
      type: true,
      configSnapshot: true,
    },
  });
  const frozenSplit = (tournament.configSnapshot as { prizeSplitPercent?: [number, number, number] } | null)
    ?.prizeSplitPercent;
  const split =
    frozenSplit ??
    (await getSettings(["tournaments.prizeSplitPercent"] as const))["tournaments.prizeSplitPercent"];

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
    const prizes = splitMoneyPrizePool(tournament.totalPrizePool, split);
    for (let index = 0; index < Math.min(3, placements.length); index += 1) {
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
    const prizes = splitPointPrizePool(total, split);
    for (let index = 0; index < Math.min(3, placements.length); index += 1) {
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

}

/**
 * Enregistre le résultat d'un match de tournoi. `winnerId = null` = nulle,
 * acceptée uniquement dans les formats à points. Appelé par le serveur de
 * jeu (partie en ligne terminée) ou par un arbitre.
 */
export async function recordValidatedTournamentResult(
  tournamentMatchId: string,
  winnerId: string | null,
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
        const standingsFormat = STANDINGS_TYPES.has(match.tournament.type);
        if (
          !match.playerWhiteId ||
          !match.playerBlackId ||
          (winnerId !== null && winnerId !== match.playerWhiteId && winnerId !== match.playerBlackId)
        ) {
          throw new TournamentEconomyError(
            "Le vainqueur doit être l’un des joueurs du match.",
            "INVALID_RESULT",
          );
        }
        if (winnerId === null && !standingsFormat) {
          throw new TournamentEconomyError(
            "Une élimination directe ne peut pas se terminer par une nulle : rejouez la partie.",
            "INVALID_RESULT",
          );
        }
        const loserId =
          winnerId === null
            ? null
            : winnerId === match.playerWhiteId
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

        if (standingsFormat) {
          await advanceStandingsTournament(
            transaction,
            match.tournamentId,
            match.tournament.type,
            match.round,
          );
          return;
        }

        if (match.tournament.survivalBankEnabled && winnerId !== null && loserId !== null) {
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

export class TournamentGameError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TournamentGameError";
  }
}

/**
 * Ouvre (ou retrouve) la partie en ligne d'un match de tournoi. Seuls les deux
 * joueurs du match peuvent la lancer ; le résultat sera reporté par le serveur.
 */
export async function startTournamentGame(tournamentMatchId: string, userId: string): Promise<{ matchId: string }> {
  const settings = await getSettings(["tournaments.gamesRated"] as const);
  try {
    return await withSerializableRetry(() => prisma.$transaction(
      async (tx) => {
        const tm = await tx.tournamentMatch.findUnique({
          where: { id: tournamentMatchId },
          include: {
            tournament: {
              select: { status: true, gameType: true, draughtsVariant: true, timeControlMinutes: true },
            },
            games: { where: { status: MatchStatus.IN_PROGRESS }, select: { id: true } },
          },
        });
        if (!tm) throw new TournamentGameError("Match de tournoi introuvable.", 404);
        if (userId !== tm.playerWhiteId && userId !== tm.playerBlackId) {
          throw new TournamentGameError("Seuls les joueurs de ce match peuvent lancer la partie.", 403);
        }
        if (!tm.playerWhiteId || !tm.playerBlackId) {
          throw new TournamentGameError("Ce match n’a pas encore ses deux joueurs.", 409);
        }
        if (tm.tournament.status !== TournamentStatus.IN_PROGRESS || tm.status === TournamentMatchStatus.FINISHED) {
          throw new TournamentGameError("Ce match est terminé ou le tournoi n’est pas en cours.", 409);
        }
        if (tm.games[0]) return { matchId: tm.games[0].id };

        const busy = await tx.match.findFirst({
          where: {
            status: MatchStatus.IN_PROGRESS,
            OR: [
              { playerWhiteId: { in: [tm.playerWhiteId, tm.playerBlackId] } },
              { playerBlackId: { in: [tm.playerWhiteId, tm.playerBlackId] } },
            ],
          },
          select: { id: true },
        });
        if (busy) {
          throw new TournamentGameError("Un des deux joueurs a déjà une partie en cours : terminez-la d’abord.", 409);
        }

        const rated = settings["tournaments.gamesRated"];
        const game = await tx.match.create({
          data: {
            playerWhiteId: tm.playerWhiteId,
            playerBlackId: tm.playerBlackId,
            gameType: tm.tournament.gameType,
            draughtsVariant: tm.tournament.gameType === "CHECKERS" ? tm.tournament.draughtsVariant : null,
            timeControlMinutes: tm.tournament.timeControlMinutes,
            mode: rated ? "RATED" : "CASUAL",
            rated,
            status: MatchStatus.IN_PROGRESS,
            movesHistory: [],
            tournamentMatchId: tm.id,
          },
          select: { id: true },
        });
        await tx.tournamentMatch.update({
          where: { id: tm.id },
          data: { status: TournamentMatchStatus.IN_PROGRESS },
        });
        return { matchId: game.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ));
  } catch (error) {
    // Lancement simultané par les deux joueurs : on renvoie la partie existante.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      const existing = await prisma.match.findFirst({
        where: { tournamentMatchId, status: MatchStatus.IN_PROGRESS },
        select: { id: true },
      });
      if (existing) return { matchId: existing.id };
    }
    throw error;
  }
}

/**
 * Reporte dans le tournoi le résultat d'une partie en ligne terminée.
 * Idempotent : peut être rappelé (réconciliation) sans double comptage.
 * Une nulle en élimination directe remet le match en attente pour être rejoué.
 */
export async function reportTournamentGame(matchId: string): Promise<void> {
  const game = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      status: true,
      winnerId: true,
      tournamentMatchId: true,
      tournamentMatch: { select: { status: true, tournament: { select: { type: true } } } },
    },
  });
  if (!game?.tournamentMatchId || !game.tournamentMatch) return;
  if (game.status !== MatchStatus.FINISHED && game.status !== MatchStatus.ABANDONED) return;
  if (game.tournamentMatch.status === TournamentMatchStatus.FINISHED) return;

  if (game.winnerId === null && !STANDINGS_TYPES.has(game.tournamentMatch.tournament.type)) {
    await prisma.$transaction([
      prisma.match.update({ where: { id: matchId }, data: { tournamentMatchId: null } }),
      prisma.tournamentMatch.update({
        where: { id: game.tournamentMatchId },
        data: { status: TournamentMatchStatus.WAITING },
      }),
    ]);
    return;
  }
  try {
    await recordValidatedTournamentResult(game.tournamentMatchId, game.winnerId);
  } catch (error) {
    if (error instanceof TournamentEconomyError && error.code === "NOT_SETTLEABLE") return;
    throw error;
  }
}

/** Réconcilie les parties terminées dont le résultat n'a pas été reporté (reprise après incident). */
export async function reconcileTournamentGames(tournamentId: string): Promise<void> {
  const orphans = await prisma.match.findMany({
    where: {
      status: { in: [MatchStatus.FINISHED, MatchStatus.ABANDONED] },
      tournamentMatch: { tournamentId, status: { not: TournamentMatchStatus.FINISHED } },
    },
    select: { id: true },
    take: 50,
  });
  for (const orphan of orphans) {
    await reportTournamentGame(orphan.id).catch((error) =>
      console.error("Réconciliation du match de tournoi impossible :", error),
    );
  }
}
