/**
 * Survival : logique pure (sans base de données).
 *
 * Règles :
 *  - chaque joueur joue uniquement avec le capital de sa mise d'entrée ;
 *  - à chaque ronde, les joueurs encore actifs sont appariés entre eux ;
 *  - la mise d'une partie est fixe (mise minimale) ou variable (jusqu'à la
 *    mise maximale, plafonnée au plus petit des deux capitaux) ;
 *  - un joueur dont le capital passe sous la mise minimale est éliminé ;
 *  - le tournoi s'arrête quand il reste un seul joueur, à la date de fin, ou
 *    si tous les joueurs actifs votent l'arrêt ; chacun récupère son capital.
 */

export interface SurvivalPlayer {
  userId: string;
  capital: number;
  /** Adversaire de la ronde précédente (évite de rejouer aussitôt le même). */
  lastOpponentId: string | null;
  /** Nombre d'exemptions déjà reçues (repos équitable). */
  byes: number;
}

export interface SurvivalPairing {
  whiteId: string;
  blackId: string | null;
  stake: number;
}

export function survivalStake(
  mode: "FIXED" | "VARIABLE",
  minBet: number,
  maxBet: number,
  capitalA: number,
  capitalB: number,
): number {
  if (mode === "FIXED") return minBet;
  return Math.max(minBet, Math.min(maxBet, capitalA, capitalB));
}

export function survivalPairings(
  players: SurvivalPlayer[],
  rules: { mode: "FIXED" | "VARIABLE"; minBet: number; maxBet: number },
): SurvivalPairing[] {
  // Les plus gros capitaux s'affrontent : départage naturel des leaders.
  let pool = [...players]
    .filter((p) => p.capital >= rules.minBet)
    .sort((a, b) => b.capital - a.capital || a.userId.localeCompare(b.userId));
  const pairings: SurvivalPairing[] = [];

  if (pool.length % 2 === 1) {
    // Repos pour le plus petit capital ayant eu le moins d'exemptions.
    const resting = [...pool].reverse().sort((a, b) => a.byes - b.byes)[0]!;
    pairings.push({ whiteId: resting.userId, blackId: null, stake: 0 });
    pool = pool.filter((p) => p.userId !== resting.userId);
  }

  while (pool.length >= 2) {
    const [first, ...rest] = pool;
    let index = rest.findIndex((p) => p.userId !== first!.lastOpponentId);
    if (index === -1) index = 0;
    const second = rest[index]!;
    pool = rest.filter((_, i) => i !== index);
    const white = pairings.length % 2 === 0 ? first! : second;
    const black = white === first ? second : first!;
    pairings.unshift({
      whiteId: white.userId,
      blackId: black.userId,
      stake: survivalStake(rules.mode, rules.minBet, rules.maxBet, first!.capital, second.capital),
    });
  }
  return pairings;
}

/** Ordre final : capital décroissant, puis élimination la plus tardive. */
export function survivalRanking(
  wallets: { userId: string; capital: number; eliminatedAt: Date | null }[],
): { userId: string; place: number }[] {
  return [...wallets]
    .sort(
      (a, b) =>
        b.capital - a.capital ||
        (b.eliminatedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (a.eliminatedAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
    )
    .map((w, index) => ({ userId: w.userId, place: index + 1 }));
}

/** Commission prélevée uniquement sur le gain net au-delà de la mise d'entrée. */
export function survivalPayout(capital: number, initialCapital: number, commissionPercent: number) {
  const gain = Math.max(0, capital - initialCapital);
  const commission = Math.floor((gain * commissionPercent) / 100);
  return { payout: capital - commission, commission };
}
