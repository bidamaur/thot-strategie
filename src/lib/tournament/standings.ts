/**
 * Classement des formats à points (Suisse, toutes rondes, ligue).
 * Module pur : aucune dépendance base de données, entièrement testable.
 *
 * Barème : victoire 1, nulle ½, défaite 0, exempt (bye) 1.
 * Départages, dans l'ordre : score, Buchholz, Sonneborn-Berger, victoires, tête de série.
 */

export interface StandingsPlayer {
  userId: string;
  seed: number;
}

export interface StandingsGame {
  whiteId: string;
  /** null = exempt (bye) attribué au joueur blanc. */
  blackId: string | null;
  /** null avec deux joueurs = nulle. */
  winnerId: string | null;
  finished: boolean;
}

export interface StandingRow {
  userId: string;
  seed: number;
  rank: number;
  score: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  byes: number;
  buchholz: number;
  sonnebornBerger: number;
  opponents: string[];
  whiteGames: number;
  blackGames: number;
}

export function computeStandings(players: StandingsPlayer[], games: StandingsGame[]): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    players.map((p) => [
      p.userId,
      {
        userId: p.userId,
        seed: p.seed,
        rank: 0,
        score: 0,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        byes: 0,
        buchholz: 0,
        sonnebornBerger: 0,
        opponents: [],
        whiteGames: 0,
        blackGames: 0,
      },
    ]),
  );
  const results: { a: string; b: string; scoreA: number }[] = [];

  for (const game of games) {
    if (!game.finished) continue;
    const white = rows.get(game.whiteId);
    if (!white) continue;
    if (game.blackId === null) {
      white.score += 1;
      white.byes += 1;
      continue;
    }
    const black = rows.get(game.blackId);
    if (!black) continue;
    white.played += 1;
    black.played += 1;
    white.whiteGames += 1;
    black.blackGames += 1;
    white.opponents.push(black.userId);
    black.opponents.push(white.userId);
    if (game.winnerId === null) {
      white.score += 0.5;
      black.score += 0.5;
      white.draws += 1;
      black.draws += 1;
      results.push({ a: white.userId, b: black.userId, scoreA: 0.5 });
    } else if (game.winnerId === white.userId) {
      white.score += 1;
      white.wins += 1;
      black.losses += 1;
      results.push({ a: white.userId, b: black.userId, scoreA: 1 });
    } else {
      black.score += 1;
      black.wins += 1;
      white.losses += 1;
      results.push({ a: white.userId, b: black.userId, scoreA: 0 });
    }
  }

  for (const row of rows.values()) {
    row.buchholz = row.opponents.reduce((sum, id) => sum + (rows.get(id)?.score ?? 0), 0);
  }
  for (const { a, b, scoreA } of results) {
    const rowA = rows.get(a)!;
    const rowB = rows.get(b)!;
    rowA.sonnebornBerger += scoreA * rowB.score;
    rowB.sonnebornBerger += (1 - scoreA) * rowA.score;
  }

  const sorted = [...rows.values()].sort(
    (x, y) =>
      y.score - x.score ||
      y.buchholz - x.buchholz ||
      y.sonnebornBerger - x.sonnebornBerger ||
      y.wins - x.wins ||
      x.seed - y.seed,
  );
  sorted.forEach((row, index) => {
    row.rank = index + 1;
  });
  return sorted;
}

export interface Pairing {
  whiteId: string;
  /** null = exempt. */
  blackId: string | null;
}

/**
 * Calendrier « toutes rondes » par la méthode du cercle. Avec un nombre impair
 * de joueurs, chacun est exempt une fois. `doubleRound` produit une ligue
 * aller-retour (couleurs inversées au retour).
 */
export function roundRobinSchedule(playerIds: string[], doubleRound = false): Pairing[][] {
  const list: (string | null)[] = [...playerIds];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const rounds: Pairing[][] = [];
  const rotating = list.slice(1);
  for (let r = 0; r < n - 1; r += 1) {
    const order = [list[0]!, ...rotating];
    const round: Pairing[] = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = order[i] ?? null;
      const b = order[n - 1 - i] ?? null;
      if (a === null && b === null) continue;
      if (a === null || b === null) {
        round.push({ whiteId: (a ?? b)!, blackId: null });
        continue;
      }
      // Alternance des couleurs pour équilibrer blancs/noirs.
      const swap = i === 0 ? r % 2 === 1 : i % 2 === 1;
      round.push(swap ? { whiteId: b, blackId: a } : { whiteId: a, blackId: b });
    }
    rounds.push(round);
    rotating.unshift(rotating.pop()!);
  }
  if (!doubleRound) return rounds;
  const second = rounds.map((round) =>
    round.map((p) => (p.blackId === null ? p : { whiteId: p.blackId, blackId: p.whiteId })),
  );
  return [...rounds, ...second];
}

export function swissRoundCount(players: number, configured: number): number {
  if (configured > 0) return Math.min(configured, Math.max(1, players - 1));
  return Math.min(Math.max(3, Math.ceil(Math.log2(Math.max(2, players)))), Math.max(1, players - 1));
}

/**
 * Appariement suisse : joueurs triés par classement, chacun apparié au mieux
 * classé possible qu'il n'a pas encore rencontré (retour arrière si impasse).
 * Exempt : le joueur le moins bien classé n'en ayant jamais eu.
 * Couleurs : blancs à celui qui en a eu le moins.
 */
export function swissPairings(standings: StandingRow[]): Pairing[] {
  const ordered = [...standings].sort((a, b) => a.rank - b.rank);
  const pairings: Pairing[] = [];
  let pool = ordered;

  if (pool.length % 2 === 1) {
    const byeIndex = [...pool].reverse().findIndex((p) => p.byes === 0);
    const chosen = pool[byeIndex === -1 ? pool.length - 1 : pool.length - 1 - byeIndex]!;
    pairings.push({ whiteId: chosen.userId, blackId: null });
    pool = pool.filter((p) => p.userId !== chosen.userId);
  }

  const solve = (remaining: StandingRow[], allowRematch: boolean): [StandingRow, StandingRow][] | null => {
    if (remaining.length === 0) return [];
    const [first, ...rest] = remaining;
    for (let i = 0; i < rest.length; i += 1) {
      const candidate = rest[i]!;
      if (!allowRematch && first!.opponents.includes(candidate.userId)) continue;
      const others = rest.filter((_, index) => index !== i);
      const tail = solve(others, allowRematch);
      if (tail) return [[first!, candidate], ...tail];
    }
    return null;
  };

  const pairs = solve(pool, false) ?? solve(pool, true) ?? [];
  for (const [a, b] of pairs) {
    const aBalance = a.whiteGames - a.blackGames;
    const bBalance = b.whiteGames - b.blackGames;
    const aWhite = aBalance < bBalance || (aBalance === bBalance && a.rank < b.rank);
    pairings.unshift(aWhite ? { whiteId: a.userId, blackId: b.userId } : { whiteId: b.userId, blackId: a.userId });
  }
  return pairings;
}
