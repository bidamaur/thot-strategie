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
  arenaStandings,
  doubleElimShape,
  groupLayout,
  isPowerOfTwo,
  knockoutFromGroups,
  losersRoundSources,
  pairAdjacent,
  pairMixed,
  pickArenaOpponent,
  snakeGroups,
} from "@/lib/tournament/advanced-formats";
import {
  survivalPairings,
  survivalPayout,
  survivalRanking,
} from "@/lib/tournament/survival-rounds";
import {
  computeStandings,
  roundRobinSchedule,
  swissPairings,
  swissRoundCount,
  type Pairing,
} from "@/lib/tournament/standings";

/** Formats en tableau à élimination (puissance de 2). */
const BRACKET_TYPES = new Set<TournamentType>([TournamentType.ELIMINATION]);
/** Formats à points, classés par score et départages. */
const STANDINGS_TYPES = new Set<TournamentType>([
  TournamentType.SWISS,
  TournamentType.ROUND_ROBIN,
  TournamentType.LEAGUE,
]);
/** Formats jouables de bout en bout. */
export const PLAYABLE_TOURNAMENT_TYPES = new Set<TournamentType>([
  ...BRACKET_TYPES,
  ...STANDINGS_TYPES,
  TournamentType.SURVIVAL_BANK,
  TournamentType.GROUPS_ELIMINATION,
  TournamentType.DOUBLE_ELIMINATION,
  TournamentType.ARENA,
]);
/** Formats pouvant démarrer avant d'être complets (sur décision de l'organisateur). */
const EARLY_START_TYPES = new Set<TournamentType>([
  TournamentType.SWISS,
  TournamentType.ROUND_ROBIN,
  TournamentType.LEAGUE,
  TournamentType.SURVIVAL_BANK,
  TournamentType.ARENA,
]);

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
  /** Survival : durée en jours avant arrêt automatique. */
  durationDays?: number;
  /** Arena : durée en minutes. */
  durationMinutes?: number;
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
  if (type === TournamentType.DOUBLE_ELIMINATION && !isPowerOfTwo(maxPlayers)) {
    throw new TournamentEconomyError(
      "La double élimination exige 4, 8, 16, 32 ou 64 joueurs.",
      "INVALID_INPUT",
    );
  }
  if (type === TournamentType.GROUPS_ELIMINATION) {
    const g = await getSettings(["tournaments.groupSize", "tournaments.groupQualifiers"] as const);
    const layout = groupLayout(maxPlayers, g["tournaments.groupSize"], g["tournaments.groupQualifiers"]);
    if ("error" in layout) throw new TournamentEconomyError(layout.error, "INVALID_INPUT");
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
  if (input.invitedUserIds?.length) {
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
  const survivalSettings = await getSettings([
    "survival.moneyEntryEnabled",
    "survival.defaultDurationDays",
    "survival.maxDurationDays",
  ] as const);
  if (input.type === TournamentType.SURVIVAL_BANK && input.isPaid && !survivalSettings["survival.moneyEntryEnabled"]) {
    throw new TournamentEconomyError(
      "Le Survival en points argent est désactivé par l’administration.",
      "INVALID_INPUT",
    );
  }
  let durationMinutes: number | null = null;
  if (input.type === TournamentType.ARENA) {
    const a = await getSettings(["tournaments.arenaDefaultMinutes", "tournaments.arenaMaxMinutes"] as const);
    durationMinutes = input.durationMinutes ?? a["tournaments.arenaDefaultMinutes"];
    if (!Number.isInteger(durationMinutes) || durationMinutes < 10 || durationMinutes > a["tournaments.arenaMaxMinutes"]) {
      throw new TournamentEconomyError(
        `La durée d’une Arena doit être comprise entre 10 et ${a["tournaments.arenaMaxMinutes"]} minutes.`,
        "INVALID_INPUT",
      );
    }
  }
  const durationDays =
    input.type === TournamentType.SURVIVAL_BANK
      ? input.durationDays ?? survivalSettings["survival.defaultDurationDays"]
      : null;
  if (
    durationDays !== null &&
    (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > survivalSettings["survival.maxDurationDays"])
  ) {
    throw new TournamentEconomyError(
      `La durée doit être comprise entre 1 et ${survivalSettings["survival.maxDurationDays"]} jours.`,
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
  // Capital de départ d'un Survival = la mise d'inscription (points ou FCFA).
  const survivalCapital = input.isPaid ? input.entryFeeCfa : input.entryPoints;
  if (input.type === TournamentType.SURVIVAL_BANK) {
    const minBet = input.minBet ?? 1;
    const maxBet = input.maxBet ?? survivalCapital;
    assertFee(minBet, "La mise minimale par match", 1);
    assertFee(maxBet, "La mise maximale par match", 1);
    if (minBet > maxBet || maxBet > survivalCapital) {
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
            initialCapital: survivalBankEnabled ? survivalCapital : input.initialCapital,
            minBet: survivalBankEnabled ? (input.minBet ?? 1) : input.minBet,
            maxBet: survivalBankEnabled
              ? (input.maxBet ?? survivalCapital)
              : input.maxBet,
            durationDays,
            durationMinutes,
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

  if (type === TournamentType.SURVIVAL_BANK) {
    await createSurvivalRound(transaction, tournamentId, 1);
    return;
  }
  if (type === TournamentType.ARENA) return; // appariement à la demande
  if (type === TournamentType.GROUPS_ELIMINATION) {
    await createGroupStage(transaction, tournamentId, sorted.map((p) => p.userId));
    return;
  }
  if (type === TournamentType.DOUBLE_ELIMINATION) {
    const half = sorted.length / 2;
    await transaction.tournamentMatch.createMany({
      data: Array.from({ length: half }, (_, index) => ({
        tournamentId,
        stage: TournamentMatchStage.WINNERS,
        round: 1,
        matchNumber: index + 1,
        playerWhiteId: sorted[index]!.userId,
        playerBlackId: sorted[sorted.length - index - 1]!.userId,
        status: TournamentMatchStatus.WAITING,
      })),
    });
    return;
  }

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

/**
 * Survival : crée la ronde suivante entre les joueurs encore actifs.
 * La mise de chaque partie est fixée à la création de la ronde.
 */
async function createSurvivalRound(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  round: number,
): Promise<number> {
  const [tournament, wallets, previous] = await Promise.all([
    transaction.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      select: { minBet: true, maxBet: true, betMode: true },
    }),
    transaction.tournamentWallet.findMany({
      where: { tournamentId, status: TournamentParticipantStatus.ACTIVE },
      select: { userId: true, capital: true },
    }),
    transaction.tournamentMatch.findMany({
      where: { tournamentId },
      select: { round: true, playerWhiteId: true, playerBlackId: true },
    }),
  ]);
  const lastRound = round - 1;
  const lastOpponent = new Map<string, string>();
  const byes = new Map<string, number>();
  for (const m of previous) {
    if (!m.playerWhiteId) continue;
    if (m.playerBlackId === null) {
      byes.set(m.playerWhiteId, (byes.get(m.playerWhiteId) ?? 0) + 1);
    } else if (m.round === lastRound) {
      lastOpponent.set(m.playerWhiteId, m.playerBlackId);
      lastOpponent.set(m.playerBlackId, m.playerWhiteId);
    }
  }
  const minBet = tournament.minBet ?? 1;
  const pairings = survivalPairings(
    wallets.map((w) => ({
      userId: w.userId,
      capital: w.capital,
      lastOpponentId: lastOpponent.get(w.userId) ?? null,
      byes: byes.get(w.userId) ?? 0,
    })),
    { mode: tournament.betMode, minBet, maxBet: tournament.maxBet ?? minBet },
  );
  const games = pairings.filter((p) => p.blackId !== null);
  if (games.length === 0) return 0;
  const now = new Date();
  await transaction.tournamentMatch.createMany({
    data: pairings.map((pairing, index) => ({
      tournamentId,
      stage: TournamentMatchStage.MAIN,
      round,
      matchNumber: index + 1,
      playerWhiteId: pairing.whiteId,
      playerBlackId: pairing.blackId,
      betAmount: pairing.blackId ? pairing.stake : null,
      // Repos : aucune mise, aucun point.
      ...(pairing.blackId === null
        ? { status: TournamentMatchStatus.FINISHED, completedAt: now }
        : { status: TournamentMatchStatus.WAITING }),
    })),
  });
  return games.length;
}

async function advanceSurvival(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  round: number,
): Promise<void> {
  const tournament = await transaction.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: { endsAt: true },
  });
  const expired = tournament.endsAt !== null && tournament.endsAt <= new Date();
  if (expired) {
    // Arrêt demandé (durée écoulée ou unanimité) : on attend seulement la fin
    // des parties déjà commencées, les parties non lancées sont abandonnées.
    if (!(await hasGameInProgress(transaction, tournamentId))) await closeSurvival(transaction, tournamentId);
    return;
  }
  const pending = await transaction.tournamentMatch.count({
    where: { tournamentId, round, status: { not: TournamentMatchStatus.FINISHED } },
  });
  if (pending > 0) return;
  const created = await createSurvivalRound(transaction, tournamentId, round + 1);
  if (created > 0) return;
  // Un seul survivant ou plus aucune partie possible.
  await closeSurvival(transaction, tournamentId);
}

async function closeSurvival(transaction: Prisma.TransactionClient, tournamentId: string): Promise<void> {
  const wallets = await transaction.tournamentWallet.findMany({
    where: { tournamentId },
    select: { userId: true, capital: true, eliminatedAt: true },
  });
  await closeTournament(transaction, tournamentId, survivalRanking(wallets));
}

export class SurvivalStopError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SurvivalStopError";
  }
}

/**
 * Vote d'arrêt anticipé d'un Survival. Le tournoi s'arrête dès que TOUS les
 * joueurs encore actifs ont voté pour ; chacun garde alors son capital.
 */
export async function voteSurvivalStop(
  tournamentId: string,
  userId: string,
  agree: boolean,
): Promise<{ stopped: boolean; pendingStop: boolean; votes: number; required: number }> {
  return withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const tournament = await tx.tournament.findUnique({
          where: { id: tournamentId },
          select: { type: true, status: true },
        });
        if (!tournament || tournament.type !== TournamentType.SURVIVAL_BANK) {
          throw new SurvivalStopError("Tournoi Survival introuvable.", 404);
        }
        if (tournament.status !== TournamentStatus.IN_PROGRESS) {
          throw new SurvivalStopError("Le tournoi n’est pas en cours.", 409);
        }
        const active = await tx.tournamentWallet.findMany({
          where: { tournamentId, status: TournamentParticipantStatus.ACTIVE },
          select: { userId: true },
        });
        if (!active.some((w) => w.userId === userId)) {
          throw new SurvivalStopError("Seuls les joueurs encore en jeu peuvent voter.", 403);
        }
        if (agree) {
          await tx.tournamentStopVote.upsert({
            where: { tournamentId_userId: { tournamentId, userId } },
            update: {},
            create: { tournamentId, userId },
          });
        } else {
          await tx.tournamentStopVote.deleteMany({ where: { tournamentId, userId } });
        }
        const activeIds = active.map((w) => w.userId);
        const votes = await tx.tournamentStopVote.count({
          where: { tournamentId, userId: { in: activeIds } },
        });
        if (votes >= activeIds.length) {
          // Unanimité : arrêt immédiat, ou dès la fin des parties en cours.
          await tx.tournament.update({ where: { id: tournamentId }, data: { endsAt: new Date() } });
          if (await hasGameInProgress(tx, tournamentId)) {
            return { stopped: false, pendingStop: true, votes, required: activeIds.length };
          }
          await closeSurvival(tx, tournamentId);
          return { stopped: true, pendingStop: false, votes, required: activeIds.length };
        }
        return { stopped: false, pendingStop: false, votes, required: activeIds.length };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

/**
 * Clôture les tournois à durée (Survival, Arena) arrivés à échéance, dès
 * qu'aucune partie n'est en cours (appelé périodiquement).
 */
export async function closeExpiredTimedTournaments(): Promise<number> {
  const expired = await prisma.tournament.findMany({
    where: {
      type: { in: [TournamentType.SURVIVAL_BANK, TournamentType.ARENA] },
      status: TournamentStatus.IN_PROGRESS,
      endsAt: { lte: new Date() },
      bracketMatches: { none: { status: TournamentMatchStatus.IN_PROGRESS } },
    },
    select: { id: true, type: true },
    take: 50,
  });
  for (const { id, type } of expired) {
    await withSerializableRetry(() =>
      prisma.$transaction(
        (tx) => (type === TournamentType.ARENA ? closeArena(tx, id) : closeSurvival(tx, id)),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    ).catch((error) => console.error("Clôture d'un tournoi à durée impossible :", error));
  }
  return expired.length;
}

/** @deprecated conservé pour compatibilité : utiliser closeExpiredTimedTournaments. */
export const closeExpiredSurvivals = closeExpiredTimedTournaments;

async function hasGameInProgress(transaction: Prisma.TransactionClient, tournamentId: string): Promise<boolean> {
  return (
    (await transaction.tournamentMatch.count({
      where: { tournamentId, status: TournamentMatchStatus.IN_PROGRESS },
    })) > 0
  );
}

// ── Groupes + phase finale ──────────────────────────────────────────────

async function createGroupStage(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  seededIds: string[],
): Promise<void> {
  const tournament = await transaction.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: { configSnapshot: true },
  });
  const frozen = tournament.configSnapshot as { groupSize?: number; groupQualifiers?: number } | null;
  const settings = await getSettings(["tournaments.groupSize", "tournaments.groupQualifiers"] as const);
  const layout = groupLayout(
    seededIds.length,
    frozen?.groupSize ?? settings["tournaments.groupSize"],
    frozen?.groupQualifiers ?? settings["tournaments.groupQualifiers"],
  );
  if ("error" in layout) throw new TournamentEconomyError(layout.error, "INVALID_INPUT");
  const groups = snakeGroups(seededIds, layout.groups);
  const now = new Date();
  for (let g = 0; g < groups.length; g += 1) {
    const rounds = roundRobinSchedule(groups[g]!);
    for (let r = 0; r < rounds.length; r += 1) {
      await transaction.tournamentMatch.createMany({
        data: rounds[r]!.map((pairing, index) => ({
          tournamentId,
          stage: TournamentMatchStage.GROUP,
          groupNumber: g + 1,
          round: r + 1,
          matchNumber: (g + 1) * 1000 + index + 1,
          playerWhiteId: pairing.whiteId,
          playerBlackId: pairing.blackId,
          ...(pairing.blackId === null
            ? { status: TournamentMatchStatus.FINISHED, winnerId: pairing.whiteId, completedAt: now }
            : { status: TournamentMatchStatus.WAITING }),
        })),
      });
    }
  }
}

/** Classement de chaque groupe (score, Buchholz, Sonneborn-Berger). */
export async function getGroupStandings(
  client: Prisma.TransactionClient | typeof prisma,
  tournamentId: string,
) {
  const [participants, matches] = await Promise.all([
    client.tournamentParticipant.findMany({ where: { tournamentId }, select: { userId: true, seed: true } }),
    client.tournamentMatch.findMany({
      where: { tournamentId, stage: TournamentMatchStage.GROUP },
      select: { groupNumber: true, playerWhiteId: true, playerBlackId: true, winnerId: true, status: true },
    }),
  ]);
  const seeds = new Map(participants.map((p) => [p.userId, p.seed]));
  const byGroup = new Map<number, typeof matches>();
  for (const m of matches) byGroup.set(m.groupNumber ?? 0, [...(byGroup.get(m.groupNumber ?? 0) ?? []), m]);
  return [...byGroup.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([group, list]) => {
      const ids = new Set<string>();
      for (const m of list) {
        if (m.playerWhiteId) ids.add(m.playerWhiteId);
        if (m.playerBlackId) ids.add(m.playerBlackId);
      }
      return {
        group,
        rows: computeStandings(
          [...ids].map((userId) => ({ userId, seed: seeds.get(userId) ?? 999 })),
          list
            .filter((m) => m.playerWhiteId)
            .map((m) => ({
              whiteId: m.playerWhiteId!,
              blackId: m.playerBlackId,
              winnerId: m.winnerId,
              finished: m.status === TournamentMatchStatus.FINISHED,
            })),
        ),
      };
    });
}

async function advanceGroupStage(transaction: Prisma.TransactionClient, tournamentId: string): Promise<void> {
  const pending = await transaction.tournamentMatch.count({
    where: { tournamentId, stage: TournamentMatchStage.GROUP, status: { not: TournamentMatchStatus.FINISHED } },
  });
  if (pending > 0) return;
  const already = await transaction.tournamentMatch.count({
    where: { tournamentId, stage: TournamentMatchStage.KNOCKOUT },
  });
  if (already > 0) return;

  const tournament = await transaction.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: { configSnapshot: true },
  });
  const frozen = tournament.configSnapshot as { groupQualifiers?: number } | null;
  const perGroup =
    frozen?.groupQualifiers ??
    (await getSettings(["tournaments.groupQualifiers"] as const))["tournaments.groupQualifiers"];
  const groups = await getGroupStandings(transaction, tournamentId);

  const qualified = groups.flatMap(({ group, rows }) =>
    rows.slice(0, perGroup).map((row) => ({ userId: row.userId, group, rank: row.rank })),
  );
  // Non qualifiés : classés après les qualifiés (rang de groupe, puis points).
  const out = groups
    .flatMap(({ rows }) => rows.slice(perGroup))
    .sort((a, b) => a.rank - b.rank || b.score - a.score || b.buchholz - a.buchholz);
  for (let i = 0; i < out.length; i += 1) {
    await transaction.tournamentParticipant.update({
      where: { tournamentId_userId: { tournamentId, userId: out[i]!.userId } },
      data: { placement: qualified.length + i + 1, status: TournamentParticipantStatus.ELIMINATED, eliminatedAt: new Date() },
    });
  }
  const pairs = knockoutFromGroups(qualified);
  if (pairs.length === 1) {
    // Deux qualifiés seulement : finale directe, sans petite finale.
    await transaction.tournamentMatch.create({
      data: {
        tournamentId,
        stage: TournamentMatchStage.KNOCKOUT,
        round: 1,
        matchNumber: 1,
        playerWhiteId: pairs[0]!.whiteId,
        playerBlackId: pairs[0]!.blackId,
        status: TournamentMatchStatus.WAITING,
      },
    });
    return;
  }
  await transaction.tournamentMatch.createMany({
    data: pairs.map((pair, index) => ({
      tournamentId,
      stage: TournamentMatchStage.KNOCKOUT,
      round: 1,
      matchNumber: index + 1,
      playerWhiteId: pair.whiteId,
      playerBlackId: pair.blackId,
      status: TournamentMatchStatus.WAITING,
    })),
  });
}

// ── Double élimination ─────────────────────────────────────────────────

/**
 * Crée toutes les rondes dont les prérequis sont remplis (idempotent).
 * Tableau des vainqueurs → perdants reversés dans le tableau des perdants →
 * grande finale, avec « reset » si le champion du tableau des perdants gagne.
 */
async function progressDoubleElimination(transaction: Prisma.TransactionClient, tournamentId: string): Promise<void> {
  const players = await transaction.tournamentParticipant.count({ where: { tournamentId } });
  const { winnersRounds: k, losersRounds: L } = doubleElimShape(players);
  const all = await transaction.tournamentMatch.findMany({
    where: {
      tournamentId,
      stage: { in: [TournamentMatchStage.WINNERS, TournamentMatchStage.LOSERS, TournamentMatchStage.GRAND_FINAL] },
    },
    orderBy: { matchNumber: "asc" },
    select: { stage: true, round: true, matchNumber: true, playerWhiteId: true, playerBlackId: true, winnerId: true, loserId: true, status: true },
  });
  const of = (stage: TournamentMatchStage, round: number) => all.filter((m) => m.stage === stage && m.round === round);
  const exists = (stage: TournamentMatchStage, round: number) => of(stage, round).length > 0;
  const done = (stage: TournamentMatchStage, round: number) =>
    exists(stage, round) && of(stage, round).every((m) => m.status === TournamentMatchStatus.FINISHED);
  const winners = (stage: TournamentMatchStage, round: number) => of(stage, round).map((m) => m.winnerId!);
  const losers = (stage: TournamentMatchStage, round: number) => of(stage, round).map((m) => m.loserId!);
  const create = async (stage: TournamentMatchStage, round: number, pairs: { whiteId: string; blackId: string }[]) => {
    await transaction.tournamentMatch.createMany({
      data: pairs.map((pair, index) => ({
        tournamentId,
        stage,
        round,
        matchNumber: index + 1,
        playerWhiteId: pair.whiteId,
        playerBlackId: pair.blackId,
        status: TournamentMatchStatus.WAITING,
      })),
    });
  };

  for (let r = 1; r < k; r += 1) {
    if (done(TournamentMatchStage.WINNERS, r) && !exists(TournamentMatchStage.WINNERS, r + 1)) {
      await create(TournamentMatchStage.WINNERS, r + 1, pairAdjacent(winners(TournamentMatchStage.WINNERS, r)));
    }
  }
  for (let r = 1; r <= L; r += 1) {
    if (exists(TournamentMatchStage.LOSERS, r)) continue;
    const source = losersRoundSources(r);
    if (source.kind === "WB_LOSERS" && done(TournamentMatchStage.WINNERS, 1)) {
      await create(TournamentMatchStage.LOSERS, r, pairAdjacent(losers(TournamentMatchStage.WINNERS, 1)));
    } else if (
      source.kind === "MIX" &&
      done(TournamentMatchStage.LOSERS, source.lbRound) &&
      done(TournamentMatchStage.WINNERS, source.wbRound)
    ) {
      await create(
        TournamentMatchStage.LOSERS,
        r,
        pairMixed(winners(TournamentMatchStage.LOSERS, source.lbRound), losers(TournamentMatchStage.WINNERS, source.wbRound)),
      );
    } else if (source.kind === "LB_WINNERS" && done(TournamentMatchStage.LOSERS, source.lbRound)) {
      await create(TournamentMatchStage.LOSERS, r, pairAdjacent(winners(TournamentMatchStage.LOSERS, source.lbRound)));
    }
  }

  const wbChampion = done(TournamentMatchStage.WINNERS, k) ? winners(TournamentMatchStage.WINNERS, k)[0] : undefined;
  const lbChampion = done(TournamentMatchStage.LOSERS, L) ? winners(TournamentMatchStage.LOSERS, L)[0] : undefined;
  if (wbChampion && lbChampion && !exists(TournamentMatchStage.GRAND_FINAL, 1)) {
    await create(TournamentMatchStage.GRAND_FINAL, 1, [{ whiteId: wbChampion, blackId: lbChampion }]);
    return;
  }
  if (!done(TournamentMatchStage.GRAND_FINAL, 1)) return;
  const gf1 = of(TournamentMatchStage.GRAND_FINAL, 1)[0]!;
  let champion: string;
  let runnerUp: string;
  if (gf1.winnerId === wbChampion) {
    champion = gf1.winnerId!;
    runnerUp = gf1.loserId!;
  } else {
    // Le champion du tableau des perdants a infligé sa première défaite : match décisif.
    if (!exists(TournamentMatchStage.GRAND_FINAL, 2)) {
      await create(TournamentMatchStage.GRAND_FINAL, 2, [{ whiteId: gf1.winnerId!, blackId: gf1.loserId! }]);
      return;
    }
    if (!done(TournamentMatchStage.GRAND_FINAL, 2)) return;
    const gf2 = of(TournamentMatchStage.GRAND_FINAL, 2)[0]!;
    champion = gf2.winnerId!;
    runnerUp = gf2.loserId!;
  }

  // Places : vainqueur, finaliste, puis éliminés du tableau des perdants (les plus tardifs d'abord).
  const placements: { userId: string; place: number }[] = [
    { userId: champion, place: 1 },
    { userId: runnerUp, place: 2 },
  ];
  for (let r = L; r >= 1; r -= 1) {
    const place = placements.length + 1;
    for (const id of losers(TournamentMatchStage.LOSERS, r)) placements.push({ userId: id, place });
  }
  await closeTournament(transaction, tournamentId, placements);
}

// ── Arena ──────────────────────────────────────────────────────────────

export async function getArenaStandings(client: Prisma.TransactionClient | typeof prisma, tournamentId: string) {
  const [participants, matches] = await Promise.all([
    client.tournamentParticipant.findMany({ where: { tournamentId }, select: { userId: true } }),
    client.tournamentMatch.findMany({
      where: { tournamentId, status: TournamentMatchStatus.FINISHED, playerBlackId: { not: null } },
      select: { playerWhiteId: true, playerBlackId: true, winnerId: true, completedAt: true, createdAt: true },
    }),
  ]);
  return arenaStandings(
    participants.map((p) => p.userId),
    matches.map((m) => ({
      whiteId: m.playerWhiteId!,
      blackId: m.playerBlackId!,
      winnerId: m.winnerId,
      finishedAt: m.completedAt ?? m.createdAt,
    })),
  );
}

async function closeArena(transaction: Prisma.TransactionClient, tournamentId: string): Promise<void> {
  // Les appariements qui n'ont jamais donné lieu à une partie sont abandonnés.
  await transaction.tournamentParticipant.updateMany({ where: { tournamentId }, data: { arenaWaitingSince: null } });
  const table = await getArenaStandings(transaction, tournamentId);
  await closeTournament(
    transaction,
    tournamentId,
    table.map((row) => ({ userId: row.userId, place: row.rank })),
  );
}

async function advanceArena(transaction: Prisma.TransactionClient, tournamentId: string): Promise<void> {
  const tournament = await transaction.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: { endsAt: true },
  });
  if (tournament.endsAt && tournament.endsAt <= new Date() && !(await hasGameInProgress(transaction, tournamentId))) {
    await closeArena(transaction, tournamentId);
  }
}

/**
 * Arena : le joueur se met en recherche ; s'il trouve un autre joueur en
 * attente, un match est créé immédiatement (la partie en ligne est lancée
 * ensuite par startTournamentGame).
 */
export async function arenaSearch(
  tournamentId: string,
  userId: string,
): Promise<{ status: "WAITING" } | { status: "MATCHED"; tournamentMatchId: string }> {
  return withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const tournament = await tx.tournament.findUnique({
          where: { id: tournamentId },
          select: { type: true, status: true, endsAt: true },
        });
        if (!tournament || tournament.type !== TournamentType.ARENA) {
          throw new TournamentGameError("Arena introuvable.", 404);
        }
        if (tournament.status !== TournamentStatus.IN_PROGRESS) {
          throw new TournamentGameError("L’Arena n’est pas en cours.", 409);
        }
        if (tournament.endsAt && tournament.endsAt <= new Date()) {
          throw new TournamentGameError("L’Arena est terminée : plus de nouvel appariement.", 409);
        }
        const me = await tx.tournamentParticipant.findUnique({
          where: { tournamentId_userId: { tournamentId, userId } },
          select: { userId: true },
        });
        if (!me) throw new TournamentGameError("Vous n’êtes pas inscrit à cette Arena.", 403);

        const open = await tx.tournamentMatch.findFirst({
          where: {
            tournamentId,
            status: { not: TournamentMatchStatus.FINISHED },
            OR: [{ playerWhiteId: userId }, { playerBlackId: userId }],
          },
          select: { id: true },
        });
        if (open) return { status: "MATCHED" as const, tournamentMatchId: open.id };

        const lastOpponentOf = async (id: string) => {
          const last = await tx.tournamentMatch.findFirst({
            where: { tournamentId, OR: [{ playerWhiteId: id }, { playerBlackId: id }] },
            orderBy: { createdAt: "desc" },
            select: { playerWhiteId: true, playerBlackId: true },
          });
          if (!last) return null;
          return last.playerWhiteId === id ? last.playerBlackId : last.playerWhiteId;
        };

        const waiting = await tx.tournamentParticipant.findMany({
          where: { tournamentId, arenaWaitingSince: { not: null }, userId: { not: userId } },
          select: { userId: true, arenaWaitingSince: true },
        });
        const candidates = [];
        for (const w of waiting) {
          candidates.push({ userId: w.userId, since: w.arenaWaitingSince!, lastOpponentId: await lastOpponentOf(w.userId) });
        }
        const opponentId = pickArenaOpponent({ userId, lastOpponentId: await lastOpponentOf(userId) }, candidates);
        if (!opponentId) {
          await tx.tournamentParticipant.update({
            where: { tournamentId_userId: { tournamentId, userId } },
            data: { arenaWaitingSince: new Date() },
          });
          return { status: "WAITING" as const };
        }
        const count = await tx.tournamentMatch.count({ where: { tournamentId } });
        // Couleurs : le joueur qui attendait prend les blancs.
        const created = await tx.tournamentMatch.create({
          data: {
            tournamentId,
            stage: TournamentMatchStage.MAIN,
            round: 1,
            matchNumber: count + 1,
            playerWhiteId: opponentId,
            playerBlackId: userId,
            status: TournamentMatchStatus.WAITING,
          },
          select: { id: true },
        });
        await tx.tournamentParticipant.updateMany({
          where: { tournamentId, userId: { in: [userId, opponentId] } },
          data: { arenaWaitingSince: null },
        });
        return { status: "MATCHED" as const, tournamentMatchId: created.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function arenaCancelSearch(tournamentId: string, userId: string): Promise<void> {
  await prisma.tournamentParticipant.updateMany({
    where: { tournamentId, userId },
    data: { arenaWaitingSince: null },
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

/**
 * Lance un tournoi : fige les règles, calcule la cagnotte sur les inscrits
 * réels et crée les premiers appariements selon le format.
 */
async function startTournamentInTransaction(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
): Promise<void> {
  const tournament = await transaction.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: {
      id: true,
      type: true,
      isPaid: true,
      entryFee: true,
      durationDays: true,
      durationMinutes: true,
      participants: { select: { userId: true, seed: true } },
    },
  });
  const participants = tournament.participants;
    const gross = tournament.entryFee.mul(participants.length);
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
      "survival.moneyGainCommissionPercent",
      "tournaments.groupSize",
      "tournaments.groupQualifiers",
    ] as const);
    const feePercent = rules["platform_fee_percentage"];
    const isSurvival = tournament.type === TournamentType.SURVIVAL_BANK;
    const platformFee = tournament.isPaid && !isSurvival
      ? gross.mul(new Prisma.Decimal(feePercent)).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : new Prisma.Decimal(0);
    const startedAt = new Date();
    await transaction.tournament.update({
      where: { id: tournament.id },
      data: {
        status: TournamentStatus.IN_PROGRESS,
        startedAt,
        // Survival : pas de cagnotte, les mises restent dans les portefeuilles.
        totalPrizePool: isSurvival ? new Prisma.Decimal(0) : gross.minus(platformFee),
        platformFee,
        endsAt:
          isSurvival && tournament.durationDays
            ? new Date(startedAt.getTime() + tournament.durationDays * 24 * 60 * 60 * 1000)
            : tournament.type === TournamentType.ARENA && tournament.durationMinutes
              ? new Date(startedAt.getTime() + tournament.durationMinutes * 60 * 1000)
              : null,
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
                survivalGainCommissionPercent: rules["survival.moneyGainCommissionPercent"],
                groupSize: rules["tournaments.groupSize"],
                groupQualifiers: rules["tournaments.groupQualifiers"],
              },
            }
          : {}),
      },
    });
    await createOpeningRound(
      transaction,
      tournament.id,
      participants,
      tournament.type,
    );
}

/** Démarrage anticipé décidé par l'organisateur (formats qui n'exigent pas un tableau complet). */
export async function startTournamentNow(tournamentId: string, actorId: string): Promise<void> {
  await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const [tournament, actor] = await Promise.all([
          tx.tournament.findUnique({
            where: { id: tournamentId },
            select: { creatorId: true, status: true, type: true, _count: { select: { participants: true } } },
          }),
          tx.user.findUnique({ where: { id: actorId }, select: { isAdmin: true } }),
        ]);
        if (!tournament) throw new TournamentGameError("Tournoi introuvable.", 404);
        if (tournament.creatorId !== actorId && !actor?.isAdmin) {
          throw new TournamentGameError("Seul l’organisateur peut lancer le tournoi.", 403);
        }
        if (tournament.status !== TournamentStatus.OPEN) {
          throw new TournamentGameError("Le tournoi n’est plus en inscription.", 409);
        }
        if (!EARLY_START_TYPES.has(tournament.type)) {
          throw new TournamentGameError("Ce format démarre automatiquement quand il est complet.", 409);
        }
        const minimum = tournament.type === TournamentType.SURVIVAL_BANK || tournament.type === TournamentType.ARENA ? 2 : 3;
        if (tournament._count.participants < minimum) {
          throw new TournamentGameError(`Il faut au moins ${minimum} inscrits pour démarrer.`, 409);
        }
        await startTournamentInTransaction(tx, tournamentId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
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
      durationDays: true,
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
    const capital = tournament.isPaid ? tournament.entryFee.toNumber() : tournament.entryPoints;
    const wallet = await transaction.tournamentWallet.create({
      data: {
        tournamentId,
        userId,
        capital,
        initialCapital: capital,
        status: TournamentParticipantStatus.ACTIVE,
      },
    });
    await transaction.tournamentWalletTransaction.create({
      data: {
        walletId: wallet.id,
        tournamentId,
        userId,
        type: TournamentWalletTransactionType.DEPOSIT,
        amount: capital,
        balanceAfter: capital,
        referenceId: tournament.id,
        description: `Droit d’entrée placé dans le portefeuille du tournoi ${tournament.id}`,
      },
    });
  }
  const joinedCount = seed;
  if (joinedCount === tournament.maxPlayers) {
    await startTournamentInTransaction(transaction, tournament.id);
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
  bracketStage: TournamentMatchStage = TournamentMatchStage.MAIN,
  bracketSize?: number,
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
        where: { stage: bracketStage },
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
  const rounds = Math.log2(bracketSize ?? tournament.maxPlayers);
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
  if (!final?.winnerId || !final.loserId) return;
  // Tableau de 2 (finale directe) : pas de petite finale.
  const needsBronze = (bracketSize ?? tournament.maxPlayers) >= 4;
  if (needsBronze && (!bronze?.winnerId || !bronze.loserId)) return;

  await closeTournament(transaction, tournamentId, [
    { userId: final.winnerId, place: 1 },
    { userId: final.loserId, place: 2 },
    ...(needsBronze && bronze?.winnerId && bronze.loserId
      ? [
          { userId: bronze.winnerId, place: 3 },
          { userId: bronze.loserId, place: 4 },
        ]
      : []),
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
    const frozenCommission = (tournament.configSnapshot as { survivalGainCommissionPercent?: number } | null)
      ?.survivalGainCommissionPercent;
    const commissionPercent = tournament.isPaid
      ? frozenCommission ??
        (await getSettings(["survival.moneyGainCommissionPercent"] as const))["survival.moneyGainCommissionPercent"]
      : 0;
    for (const wallet of wallets) {
      await transaction.tournamentWallet.update({
        where: { id: wallet.id },
        data: {
          capital: 0,
          status:
            wallet.userId === placements[0]!.userId
              ? TournamentParticipantStatus.WON
              : TournamentParticipantStatus.ELIMINATED,
        },
      });
      if (wallet.capital <= 0) continue;
      // Chacun récupère ce qu'il a dans son portefeuille de tournoi.
      const { payout, commission } = survivalPayout(wallet.capital, wallet.initialCapital, commissionPercent);
      if (tournament.isPaid) {
        await transaction.user.update({
          where: { id: wallet.userId },
          data: { walletReal: { increment: new Prisma.Decimal(payout) } },
        });
      } else {
        await transaction.user.update({
          where: { id: wallet.userId },
          data: { pointsFree: { increment: payout } },
        });
      }
      await transaction.balanceTransaction.create({
        data: {
          userId: wallet.userId,
          balanceType: tournament.isPaid ? BalanceType.REAL_WALLET : BalanceType.FREE_POINTS,
          transactionType: tournament.isPaid
            ? BalanceTransactionType.TOURNAMENT_PRIZE
            : BalanceTransactionType.TOURNAMENT_POINTS_PRIZE,
          amount: new Prisma.Decimal(payout),
          referenceId: `survival:${tournamentId}`,
          description:
            commission > 0
              ? `Capital Survival restitué (commission ${commission} sur le gain)`
              : "Capital Survival restitué",
        },
      });
      await transaction.tournamentWalletTransaction.create({
        data: {
          walletId: wallet.id,
          tournamentId,
          userId: wallet.userId,
          type: TournamentWalletTransactionType.WITHDRAWAL,
          amount: -wallet.capital,
          balanceAfter: 0,
          referenceId: `tournament-finish:${tournamentId}`,
          description: `Restitution du capital à la fin du tournoi ${tournamentId}`,
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
    const registered = await transaction.tournamentParticipant.count({ where: { tournamentId } });
    const total = tournament.entryPoints * registered;
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
        const survivalFormat = match.tournament.type === TournamentType.SURVIVAL_BANK;
        const drawAllowed =
          standingsFormat ||
          survivalFormat ||
          match.tournament.type === TournamentType.ARENA ||
          match.stage === TournamentMatchStage.GROUP;
        if (winnerId === null && !drawAllowed) {
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

        if (survivalFormat) {
          if (winnerId === null) {
            // Nulle : aucune mise ne change de main.
            await transaction.tournamentWallet.updateMany({
              where: {
                tournamentId: match.tournamentId,
                userId: { in: [match.playerWhiteId, match.playerBlackId] },
              },
              data: { matchesPlayed: { increment: 1 }, matchesDrawn: { increment: 1 } },
            });
          }
          await advanceSurvival(transaction, match.tournamentId, match.round);
          return;
        }

        if (match.tournament.type === TournamentType.ARENA) {
          await advanceArena(transaction, match.tournamentId);
          return;
        }
        if (match.tournament.type === TournamentType.DOUBLE_ELIMINATION) {
          await progressDoubleElimination(transaction, match.tournamentId);
          return;
        }
        if (match.tournament.type === TournamentType.GROUPS_ELIMINATION) {
          if (match.stage === TournamentMatchStage.GROUP) {
            await advanceGroupStage(transaction, match.tournamentId);
            return;
          }
          const size = 2 * (await transaction.tournamentMatch.count({
            where: { tournamentId: match.tournamentId, stage: TournamentMatchStage.KNOCKOUT, round: 1 },
          }));
          await advanceKnockout(transaction, match.tournamentId, TournamentMatchStage.KNOCKOUT, match.stage, match.round, size);
          return;
        }
        await advanceKnockout(
          transaction,
          match.tournamentId,
          TournamentMatchStage.MAIN,
          match.stage,
          match.round,
          match.tournament.maxPlayers,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

/**
 * Avancement d'un tableau à élimination directe (élimination simple ou phase
 * finale après les groupes) : tour suivant, puis finale et petite finale.
 */
async function advanceKnockout(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  bracketStage: TournamentMatchStage,
  matchStage: TournamentMatchStage,
  matchRound: number,
  bracketSize: number,
): Promise<void> {
  const match = { tournamentId, round: matchRound, stage: matchStage, tournament: { maxPlayers: bracketSize } };
  if (match.stage === TournamentMatchStage.THIRD_PLACE) {
    await finishTournament(transaction, match.tournamentId, bracketStage, bracketSize);
    return;
  }

  const currentRoundMatches = await transaction.tournamentMatch.findMany({
    where: {
      tournamentId: match.tournamentId,
      stage: bracketStage,
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
    await finishTournament(transaction, match.tournamentId, bracketStage, bracketSize);
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
          stage: bracketStage,
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
      stage: bracketStage,
      round: match.round + 1,
      matchNumber: index + 1,
      playerWhiteId: winners[index * 2]!,
      playerBlackId: winners[index * 2 + 1]!,
      status: TournamentMatchStatus.WAITING,
    })),
  });
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
              select: { status: true, gameType: true, draughtsVariant: true, timeControlMinutes: true, endsAt: true },
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
        if (tm.tournament.endsAt && tm.tournament.endsAt <= new Date()) {
          throw new TournamentGameError("Le tournoi est arrivé à son terme : plus aucune nouvelle partie.", 409);
        }

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
      tournamentMatch: { select: { status: true, stage: true, tournament: { select: { type: true } } } },
    },
  });
  if (!game?.tournamentMatchId || !game.tournamentMatch) return;
  if (game.status !== MatchStatus.FINISHED && game.status !== MatchStatus.ABANDONED) return;
  if (game.tournamentMatch.status === TournamentMatchStatus.FINISHED) return;

  const drawAllowed =
    STANDINGS_TYPES.has(game.tournamentMatch.tournament.type) ||
    game.tournamentMatch.tournament.type === TournamentType.SURVIVAL_BANK ||
    game.tournamentMatch.tournament.type === TournamentType.ARENA ||
    game.tournamentMatch.stage === TournamentMatchStage.GROUP;
  if (game.winnerId === null && !drawAllowed) {
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
