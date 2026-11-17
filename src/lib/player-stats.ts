import { MatchStatus, type Prisma } from "@/generated/prisma-client";
import { getPrivilegesForUserId } from "@/lib/premium/privileges";
import { prisma } from "@/lib/prisma";
import { cadenceOf, ratingVariantOf } from "@/lib/rating/pools";

/**
 * Historique et statistiques du joueur connecté.
 * - Historique : profondeur limitée par le privilège `historyDays` du niveau
 *   (0 = illimité). Les parties plus anciennes sont comptées, pas affichées.
 * - Statistiques essentielles : pour tous.
 * - Statistiques avancées : privilège `advancedStats`.
 */

const PLAYED = [MatchStatus.FINISHED, MatchStatus.ABANDONED];
const PAGE = 25;

function mine(userId: string): Prisma.MatchWhereInput {
  return { OR: [{ playerWhiteId: userId }, { playerBlackId: userId }], status: { in: PLAYED } };
}

const OPPONENT = { select: { id: true, username: true, avatar: true } } as const;

function outcome(userId: string, m: { winnerId: string | null; result?: unknown }): "WIN" | "LOSS" | "DRAW" {
  if (!m.winnerId) return "DRAW";
  return m.winnerId === userId ? "WIN" : "LOSS";
}

export async function historyWindow(userId: string) {
  const p = await getPrivilegesForUserId(userId);
  const days = p?.privileges.historyDays ?? 30;
  return { days, since: days > 0 ? new Date(Date.now() - days * 86_400_000) : null, advanced: Boolean(p?.privileges.advancedStats) };
}

export async function listMyGames(userId: string, opts: { cursor?: string | null; gameType?: string | null }) {
  const { days, since } = await historyWindow(userId);
  const where: Prisma.MatchWhereInput = {
    ...mine(userId),
    ...(since ? { createdAt: { gte: since } } : {}),
    ...(opts.gameType === "CHESS" || opts.gameType === "CHECKERS" ? { gameType: opts.gameType } : {}),
  };
  const rows = await prisma.match.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true, gameType: true, draughtsVariant: true, mode: true, timeControlMinutes: true, createdAt: true,
      winnerId: true, playerWhiteId: true, eloDeltaWhite: true, eloDeltaBlack: true, tournamentMatchId: true,
      playerWhite: OPPONENT, playerBlack: OPPONENT,
    },
  });
  const hasMore = rows.length > PAGE;
  const items = rows.slice(0, PAGE).map((m) => {
    const white = m.playerWhiteId === userId;
    return {
      id: m.id,
      gameType: m.gameType,
      draughtsVariant: m.draughtsVariant,
      mode: m.mode,
      timeControlMinutes: m.timeControlMinutes,
      createdAt: m.createdAt.toISOString(),
      color: white ? "WHITE" : "BLACK",
      opponent: white ? m.playerBlack : m.playerWhite,
      result: outcome(userId, m),
      eloDelta: white ? m.eloDeltaWhite : m.eloDeltaBlack,
      tournament: Boolean(m.tournamentMatchId),
    };
  });
  const hiddenOlder = since && !opts.cursor ? await prisma.match.count({ where: { ...mine(userId), createdAt: { lt: since } } }) : 0;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null, historyDays: days, hiddenOlder };
}

type Tally = { played: number; wins: number; losses: number; draws: number; winRate: number | null };
const empty = (): Tally => ({ played: 0, wins: 0, losses: 0, draws: 0, winRate: null });
function add(t: Tally, r: "WIN" | "LOSS" | "DRAW") {
  t.played += 1;
  if (r === "WIN") t.wins += 1;
  else if (r === "LOSS") t.losses += 1;
  else t.draws += 1;
}
function finish<T extends Record<string, Tally>>(group: T): T {
  for (const t of Object.values(group)) t.winRate = t.played ? Math.round((t.wins / t.played) * 1000) / 10 : null;
  return group;
}

export async function myStats(userId: string) {
  const { advanced } = await historyWindow(userId);
  const [ratings, totals] = await Promise.all([
    prisma.playerRating.findMany({ where: { userId }, orderBy: { gamesPlayed: "desc" }, select: { variant: true, timeControl: true, eloRating: true, gamesPlayed: true } }),
    prisma.match.findMany({ where: mine(userId), select: { gameType: true, winnerId: true } }),
  ]);
  const overall = { all: empty(), CHESS: empty(), CHECKERS: empty() };
  for (const m of totals) {
    const r = outcome(userId, m);
    add(overall.all, r);
    add(overall[m.gameType], r);
  }
  const essential = { overall: finish(overall), ratings };
  if (!advanced) return { essential, advanced: null, advancedLocked: true };

  // ── Avancées : 500 dernières parties, sans requête par partie ──
  const recent = await prisma.match.findMany({
    where: mine(userId),
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true, gameType: true, draughtsVariant: true, mode: true, timeControlMinutes: true, createdAt: true,
      winnerId: true, playerWhiteId: true, playerBlackId: true, movesHistory: true,
      playerWhite: OPPONENT, playerBlack: OPPONENT,
    },
  });
  const byColor = { WHITE: empty(), BLACK: empty() };
  const byMode: Record<string, Tally> = {};
  const byCadence: Record<string, Tally> = {};
  const byVariant: Record<string, Tally> = {};
  const opponents = new Map<string, { username: string; avatar: string | null; tally: Tally }>();
  const months = new Map<string, number>();
  let plies = 0;
  for (const m of recent) {
    const white = m.playerWhiteId === userId;
    const r = outcome(userId, m);
    add(byColor[white ? "WHITE" : "BLACK"], r);
    add((byMode[m.mode] ??= empty()), r);
    add((byCadence[cadenceOf(m.timeControlMinutes)] ??= empty()), r);
    add((byVariant[ratingVariantOf(m.gameType, m.draughtsVariant)] ??= empty()), r);
    const opp = white ? m.playerBlack : m.playerWhite;
    if (opp) {
      const entry = opponents.get(opp.id) ?? { username: opp.username, avatar: opp.avatar, tally: empty() };
      add(entry.tally, r);
      opponents.set(opp.id, entry);
    }
    const month = m.createdAt.toISOString().slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + 1);
    plies += Array.isArray(m.movesHistory) ? m.movesHistory.length : 0;
  }
  const [trend, bestWin] = await Promise.all([
    prisma.ratingHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { variant: true, timeControl: true, newRating: true, change: true, createdAt: true },
    }),
    prisma.ratingHistory.findFirst({
      where: { userId, change: { gt: 0 }, opponentRatingBefore: { not: null } },
      orderBy: { opponentRatingBefore: "desc" },
      select: { opponentRatingBefore: true, opponentId: true, matchId: true, createdAt: true, variant: true },
    }),
  ]);
  const bestOpponent = bestWin?.opponentId
    ? await prisma.user.findUnique({ where: { id: bestWin.opponentId }, select: { username: true } })
    : null;
  return {
    essential,
    advancedLocked: false,
    advanced: {
      sample: recent.length,
      byColor: finish(byColor),
      byMode: finish(byMode),
      byCadence: finish(byCadence),
      byVariant: finish(byVariant),
      topOpponents: [...opponents.values()]
        .sort((a, b) => b.tally.played - a.tally.played)
        .slice(0, 5)
        .map((o) => ({ username: o.username, avatar: o.avatar, ...finish({ t: o.tally }).t })),
      averagePlies: recent.length ? Math.round(plies / recent.length) : null,
      activityByMonth: [...months.entries()].sort().slice(-6).map(([month, games]) => ({ month, games })),
      ratingTrend: trend.reverse().map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
      bestWin: bestWin
        ? { opponent: bestOpponent?.username ?? null, opponentRating: bestWin.opponentRatingBefore, matchId: bestWin.matchId, date: bestWin.createdAt.toISOString(), variant: bestWin.variant }
        : null,
    },
  };
}
