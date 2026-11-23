/**
 * Indice composite de classement (calcul pur).
 *
 * Problème : l'ELO (≈ 800–2400) et les points (0 → plusieurs dizaines de
 * milliers, distribution très étirée) n'ont ni la même échelle ni la même
 * forme : une simple somme serait dominée par les points.
 *
 * Méthode : chaque critère est converti en rang-centile dans la population
 * classée (0 = dernier, 1 = premier ; ex æquo = moyenne de leurs rangs), puis
 * combiné par une moyenne pondérée :
 *
 *     Indice = 1000 × (wₑ × centile(ELO) + wₚ × centile(points))
 *
 * Avantages : indépendant des échelles, insensible aux valeurs extrêmes (un
 * gros solde ne peut pas écraser le classement), lisible (0 à 1000). En cas
 * d'égalité d'indice : ELO, puis points, puis ancienneté de l'inscription.
 */

export interface RankInput {
  id: string;
  elo: number;
  points: number;
  createdAt: Date;
}

export interface Ranked<T extends RankInput> {
  player: T;
  rank: number;
  index: number;
  eloPercentile: number;
  pointsPercentile: number;
}

/** Rang-centile de chaque valeur (ex æquo : rang moyen). Un seul joueur : 1. */
export function percentiles(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(n);
  let k = 0;
  while (k < n) {
    let j = k;
    while (j + 1 < n && order[j + 1]!.v === order[k]!.v) j += 1;
    const avgRank = (k + j) / 2; // rang 0-based moyen des ex æquo
    for (let m = k; m <= j; m += 1) out[order[m]!.i] = avgRank / (n - 1);
    k = j + 1;
  }
  return out;
}

export function rankComposite<T extends RankInput>(players: T[], eloWeightPercent: number, limit = players.length): Ranked<T>[] {
  const we = Math.min(100, Math.max(0, eloWeightPercent)) / 100;
  const wp = 1 - we;
  const pe = percentiles(players.map((p) => p.elo));
  const pp = percentiles(players.map((p) => p.points));
  return players
    .map((player, i) => ({
      player,
      eloPercentile: pe[i]!,
      pointsPercentile: pp[i]!,
      raw: we * pe[i]! + wp * pp[i]!,
    }))
    .sort(
      (a, b) =>
        b.raw - a.raw ||
        b.player.elo - a.player.elo ||
        b.player.points - a.player.points ||
        a.player.createdAt.getTime() - b.player.createdAt.getTime(),
    )
    .slice(0, limit)
    .map((r, i) => ({ player: r.player, rank: i + 1, index: Math.round(r.raw * 1000), eloPercentile: r.eloPercentile, pointsPercentile: r.pointsPercentile }));
}
