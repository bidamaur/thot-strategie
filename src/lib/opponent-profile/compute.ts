/**
 * Calculs purs du profil de l'adversaire (testables sans base de données).
 * Toutes les valeurs proviennent de lignes réellement enregistrées : parties
 * terminées, historique ELO, participations et transactions de tournoi.
 */

export type Outcome = "WIN" | "LOSS" | "DRAW";

export interface Tally {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  /** Pourcentages arrondis au dixième ; null sans partie. */
  winRate: number | null;
  lossRate: number | null;
  drawRate: number | null;
}

export function outcomeFor(userId: string, winnerId: string | null): Outcome {
  if (!winnerId) return "DRAW";
  return winnerId === userId ? "WIN" : "LOSS";
}

const pct = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : null);

export function tally(outcomes: Outcome[]): Tally {
  const wins = outcomes.filter((o) => o === "WIN").length;
  const losses = outcomes.filter((o) => o === "LOSS").length;
  const draws = outcomes.length - wins - losses;
  return {
    played: outcomes.length,
    wins,
    losses,
    draws,
    winRate: pct(wins, outcomes.length),
    lossRate: pct(losses, outcomes.length),
    drawRate: pct(draws, outcomes.length),
  };
}

/**
 * Séries, à partir des résultats triés du plus récent au plus ancien.
 * Une nulle interrompt toute série (pas de série en cours si la dernière partie est nulle).
 */
export function streaks(recentFirst: Outcome[]): {
  current: { kind: "WIN" | "LOSS"; length: number } | null;
  longestWin: number;
} {
  let current: { kind: "WIN" | "LOSS"; length: number } | null = null;
  const first = recentFirst[0];
  if (first === "WIN" || first === "LOSS") {
    let length = 0;
    while (recentFirst[length] === first) length += 1;
    current = { kind: first, length };
  }
  let longestWin = 0;
  let run = 0;
  for (const o of recentFirst) {
    run = o === "WIN" ? run + 1 : 0;
    longestWin = Math.max(longestWin, run);
  }
  return { current, longestWin };
}

/** Formats à élimination directe : les deux premiers ont disputé une finale. */
export const KNOCKOUT_TYPES = new Set(["ELIMINATION", "DOUBLE_ELIMINATION", "GROUPS_ELIMINATION"]);

export const TOURNAMENT_TYPE_LABELS: Record<string, string> = {
  SURVIVAL_BANK: "Survival",
  ARENA: "Arena",
  SWISS: "Système suisse",
  ROUND_ROBIN: "Toutes rondes",
  ELIMINATION: "Élimination directe",
  DOUBLE_ELIMINATION: "Double élimination",
  GROUPS_ELIMINATION: "Poules + élimination",
  LEAGUE: "Ligue",
};

export interface Participation {
  tournamentId: string;
  name: string;
  date: Date;
  type: string;
  gameType: "CHESS" | "CHECKERS";
  draughtsVariant: "ENGLISH" | "INTERNATIONAL" | null;
  status: string;
  placement: number | null;
  participants: number;
  /** A reçu un prix (compétitions rémunérées uniquement, montant jamais exposé). */
  rewarded: boolean;
}

export interface TournamentSummary {
  participated: number;
  completed: number;
  wins: number;
  second: number;
  third: number;
  podiums: number;
  /** Finales disputées (formats à élimination directe terminés). */
  finals: number;
  rewarded: number;
  best: { placement: number; name: string; participants: number } | null;
  recent: {
    name: string;
    date: string;
    type: string;
    gameType: "CHESS" | "CHECKERS";
    draughtsVariant: "ENGLISH" | "INTERNATIONAL" | null;
    completed: boolean;
    placement: number | null;
    participants: number;
    result: string;
    rewarded: boolean;
  }[];
}

export function placementLabel(p: Participation): string {
  if (p.status !== "COMPLETED") return p.status === "IN_PROGRESS" ? "En cours" : "Inscrit";
  if (!p.placement) return "Non classé";
  if (p.placement === 1) return "Vainqueur";
  if (p.placement === 2) return KNOCKOUT_TYPES.has(p.type) ? "Finaliste" : "2e place";
  if (p.placement === 3) return "3e place";
  return `${p.placement}e place`;
}

export function summarizeTournaments(list: Participation[], recentCount = 5): TournamentSummary {
  const completed = list.filter((p) => p.status === "COMPLETED");
  const placed = completed.filter((p) => p.placement !== null) as (Participation & { placement: number })[];
  const at = (n: number) => placed.filter((p) => p.placement === n).length;
  const best = placed.reduce<(Participation & { placement: number }) | null>(
    (acc, p) => (!acc || p.placement < acc.placement || (p.placement === acc.placement && p.participants > acc.participants) ? p : acc),
    null,
  );
  return {
    participated: list.length,
    completed: completed.length,
    wins: at(1),
    second: at(2),
    third: at(3),
    podiums: placed.filter((p) => p.placement <= 3).length,
    finals: placed.filter((p) => KNOCKOUT_TYPES.has(p.type) && p.placement <= 2).length,
    rewarded: list.filter((p) => p.rewarded).length,
    best: best ? { placement: best.placement, name: best.name, participants: best.participants } : null,
    recent: [...list]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, recentCount)
      .map((p) => ({
        name: p.name,
        date: p.date.toISOString(),
        type: TOURNAMENT_TYPE_LABELS[p.type] ?? p.type,
        gameType: p.gameType,
        draughtsVariant: p.draughtsVariant,
        completed: p.status === "COMPLETED",
        placement: p.placement,
        participants: p.participants,
        result: placementLabel(p),
        rewarded: p.rewarded,
      })),
  };
}
