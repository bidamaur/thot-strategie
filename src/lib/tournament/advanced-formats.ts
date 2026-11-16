/**
 * Formats avancés — logique pure, sans base de données.
 *  - Groupes + phase finale
 *  - Double élimination (tableau des vainqueurs, des perdants, grande finale)
 *  - Arena (barème au fil des parties avec bonus de série)
 */

// ── Groupes ───────────────────────────────────────────────────────────

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
}

/** Nombre de groupes et de qualifiés ; erreur lisible si la configuration est impossible. */
export function groupLayout(
  players: number,
  groupSize: number,
  qualifiersPerGroup: number,
): { groups: number; qualifiers: number } | { error: string } {
  const groups = Math.ceil(players / groupSize);
  const smallest = Math.floor(players / groups);
  const qualifiers = groups * qualifiersPerGroup;
  if (groups < 2) return { error: "Il faut au moins deux groupes." };
  if (smallest <= qualifiersPerGroup) {
    return { error: `Chaque groupe doit compter plus de ${qualifiersPerGroup} joueurs.` };
  }
  if (!isPowerOfTwo(qualifiers)) {
    return {
      error: `${groups} groupes × ${qualifiersPerGroup} qualifiés = ${qualifiers} : la phase finale exige 2, 4, 8, 16 ou 32 qualifiés.`,
    };
  }
  return { groups, qualifiers };
}

/** Répartition « serpentin » des têtes de série dans les groupes (1..G, G..1, …). */
export function snakeGroups<T>(seeded: T[], groups: number): T[][] {
  const result: T[][] = Array.from({ length: groups }, () => []);
  seeded.forEach((item, index) => {
    const lap = Math.floor(index / groups);
    const position = index % groups;
    result[lap % 2 === 0 ? position : groups - 1 - position]!.push(item);
  });
  return result;
}

/**
 * Tableau final à partir des qualifiés : un premier de groupe affronte un
 * qualifié d'un autre groupe, et deux qualifiés d'un même groupe ne se
 * retrouvent pas avant la finale autant que possible.
 */
export function knockoutFromGroups(
  qualified: { userId: string; group: number; rank: number }[],
): { whiteId: string; blackId: string }[] {
  const pool = [...qualified].sort((a, b) => a.rank - b.rank || a.group - b.group);
  const pairs: { whiteId: string; blackId: string }[] = [];
  while (pool.length >= 2) {
    const top = pool.shift()!;
    // Adversaire le plus faible restant, d'un autre groupe si possible.
    let index = -1;
    for (let i = pool.length - 1; i >= 0; i -= 1) {
      if (pool[i]!.group !== top.group) {
        index = i;
        break;
      }
    }
    if (index === -1) index = pool.length - 1;
    const [opponent] = pool.splice(index, 1);
    pairs.push({ whiteId: top.userId, blackId: opponent!.userId });
  }
  // Ordre de tableau : 1er et 2e têtes de série dans des moitiés opposées.
  const ordered: typeof pairs = [];
  const half = pairs.length / 2;
  for (let i = 0; i < half; i += 1) {
    ordered.push(pairs[i]!);
    ordered.push(pairs[pairs.length - 1 - i]!);
  }
  return pairs.length === 1 ? pairs : ordered;
}

// ── Double élimination ────────────────────────────────────────────────

export interface DoubleElimRound {
  stage: "WINNERS" | "LOSERS" | "GRAND_FINAL";
  round: number;
}

/** Nombre de rondes : vainqueurs = log2(N), perdants = 2 × (log2(N) − 1). */
export function doubleElimShape(players: number) {
  const winnersRounds = Math.log2(players);
  return { winnersRounds, losersRounds: 2 * (winnersRounds - 1) };
}

/**
 * Prérequis d'une ronde du tableau des perdants :
 *  - ronde 1 : perdants de la ronde 1 des vainqueurs, entre eux ;
 *  - ronde paire 2j : vainqueurs de la ronde 2j−1 contre perdants de la ronde j+1 des vainqueurs ;
 *  - ronde impaire 2j+1 : vainqueurs de la ronde 2j, entre eux.
 */
export function losersRoundSources(round: number):
  | { kind: "WB_LOSERS"; wbRound: number }
  | { kind: "MIX"; lbRound: number; wbRound: number }
  | { kind: "LB_WINNERS"; lbRound: number } {
  if (round === 1) return { kind: "WB_LOSERS", wbRound: 1 };
  if (round % 2 === 0) return { kind: "MIX", lbRound: round - 1, wbRound: round / 2 + 1 };
  return { kind: "LB_WINNERS", lbRound: round - 1 };
}

export function pairAdjacent(ids: string[]): { whiteId: string; blackId: string }[] {
  const pairs: { whiteId: string; blackId: string }[] = [];
  for (let i = 0; i + 1 < ids.length; i += 2) pairs.push({ whiteId: ids[i]!, blackId: ids[i + 1]! });
  return pairs;
}

/** Ronde « mixte » : les perdants du haut sont croisés (ordre inversé) pour éviter les revanches immédiates. */
export function pairMixed(lbWinners: string[], wbLosers: string[]): { whiteId: string; blackId: string }[] {
  const reversed = [...wbLosers].reverse();
  return lbWinners.map((id, i) => ({ whiteId: reversed[i]!, blackId: id }));
}

// ── Arena ─────────────────────────────────────────────────────────────

export interface ArenaGame {
  whiteId: string;
  blackId: string;
  winnerId: string | null;
  finishedAt: Date;
}

export interface ArenaRow {
  userId: string;
  score: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Série en cours : après 2 victoires consécutives, les points sont doublés. */
  onFire: boolean;
  rank: number;
}

/**
 * Barème Arena : victoire 2, nulle 1, défaite 0. Après deux victoires de
 * suite, chaque partie rapporte le double jusqu'à la prochaine non-victoire.
 */
export function arenaStandings(playerIds: string[], games: ArenaGame[]): ArenaRow[] {
  const rows = new Map<string, ArenaRow & { streak: number }>(
    playerIds.map((id) => [id, { userId: id, score: 0, games: 0, wins: 0, draws: 0, losses: 0, onFire: false, rank: 0, streak: 0 }]),
  );
  const sorted = [...games].sort((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime());
  for (const game of sorted) {
    for (const id of [game.whiteId, game.blackId]) {
      const row = rows.get(id);
      if (!row) continue;
      const multiplier = row.streak >= 2 ? 2 : 1;
      row.games += 1;
      if (game.winnerId === null) {
        row.draws += 1;
        row.score += 1 * multiplier;
        row.streak = 0;
      } else if (game.winnerId === id) {
        row.wins += 1;
        row.score += 2 * multiplier;
        row.streak += 1;
      } else {
        row.losses += 1;
        row.streak = 0;
      }
    }
  }
  const list = [...rows.values()].map((r) => ({ ...r, onFire: r.streak >= 2 }));
  list.sort((a, b) => b.score - a.score || b.wins - a.wins || a.games - b.games || a.userId.localeCompare(b.userId));
  return list.map(({ streak: _streak, ...row }, index) => ({ ...row, rank: index + 1 }));
}

/** Choix d'adversaire Arena : le plus ancien en attente, en évitant la revanche immédiate. */
export function pickArenaOpponent(
  self: { userId: string; lastOpponentId: string | null },
  waiting: { userId: string; since: Date; lastOpponentId: string | null }[],
): string | null {
  const candidates = waiting
    .filter((w) => w.userId !== self.userId)
    .sort((a, b) => a.since.getTime() - b.since.getTime());
  const fresh = candidates.find((w) => w.userId !== self.lastOpponentId && w.lastOpponentId !== self.userId);
  // Revanche acceptée seulement s'il n'y a personne d'autre.
  return (fresh ?? candidates[0])?.userId ?? null;
}
