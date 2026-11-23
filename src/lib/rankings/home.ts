import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";
import { rankComposite } from "./composite";

/**
 * Classements de l'accueil :
 *  - Top 20 : indice ELO + points classiques (non monétisés) ;
 *  - Top 10 Or : comptes monétisés (vérifiés pour les parties rémunérées),
 *    indice ELO + points argent. Les montants ne sont jamais renvoyés.
 * ELO retenu : le meilleur classement du joueur parmi ses catégories jouées.
 * Calcul mis en cache une minute (page d'accueil très consultée).
 */

const VARIANT_LABEL: Record<string, string> = { CHESS: "Échecs", INTERNATIONAL: "Dames", ENGLISH: "Dames 8×8" };

export interface HomeRankingEntry {
  rank: number;
  index: number;
  id: string;
  username: string;
  avatar: string | null;
  country: string | null;
  elo: number;
  eloLabel: string;
  /** Points classiques (Top 20 uniquement). */
  points: number | null;
}

export interface HomeRankings {
  top: HomeRankingEntry[] | null;
  gold: HomeRankingEntry[] | null;
  eloWeight: number;
  goldEloWeight: number;
  minGames: number;
  updatedAt: string;
}

let cache: { at: number; value: HomeRankings } | null = null;
const TTL_MS = 60_000;

export function invalidateHomeRankings() {
  cache = null;
}

export async function getHomeRankings(now = Date.now()): Promise<HomeRankings> {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  const s = await getSettings(["rankings.homeEnabled", "rankings.eloWeight", "rankings.minGames", "rankings.goldEnabled", "rankings.goldEloWeight", "money.enabled"] as const);

  const rows = await prisma.user.findMany({
    where: { isAdmin: false, playerRatings: { some: { gamesPlayed: { gt: 0 } } } },
    select: {
      id: true, username: true, avatar: true, country: true, createdAt: true, pointsFree: true,
      moneyVerified: true, walletReal: true, walletLocked: true,
      playerRatings: { where: { gamesPlayed: { gt: 0 } }, select: { variant: true, eloRating: true, gamesPlayed: true } },
    },
  });

  const players = rows
    .map((u) => {
      const games = u.playerRatings.reduce((n, r) => n + r.gamesPlayed, 0);
      const best = [...u.playerRatings].sort((a, b) => b.eloRating - a.eloRating || b.gamesPlayed - a.gamesPlayed)[0]!;
      return {
        id: u.id, username: u.username, avatar: u.avatar, country: u.country, createdAt: u.createdAt,
        games, elo: best.eloRating, eloLabel: VARIANT_LABEL[best.variant] ?? best.variant,
        classic: Math.max(0, u.pointsFree),
        money: Number(u.walletReal) + Number(u.walletLocked),
        monetized: u.moneyVerified,
      };
    })
    .filter((p) => p.games >= s["rankings.minGames"]);

  const entry = (r: { rank: number; index: number; player: (typeof players)[number] }, withPoints: boolean): HomeRankingEntry => ({
    rank: r.rank,
    index: r.index,
    id: r.player.id,
    username: r.player.username,
    avatar: r.player.avatar,
    country: r.player.country,
    elo: r.player.elo,
    eloLabel: r.player.eloLabel,
    points: withPoints ? Math.round(r.player.classic) : null,
  });

  const top = s["rankings.homeEnabled"]
    ? rankComposite(players.map((p) => ({ ...p, points: p.classic })), s["rankings.eloWeight"], 20).map((r) => entry(r, true))
    : null;
  const gold =
    s["rankings.goldEnabled"] && s["money.enabled"]
      ? rankComposite(players.filter((p) => p.monetized).map((p) => ({ ...p, points: p.money })), s["rankings.goldEloWeight"], 10).map((r) => entry(r, false))
      : null;

  const value: HomeRankings = {
    top,
    gold,
    eloWeight: s["rankings.eloWeight"],
    goldEloWeight: s["rankings.goldEloWeight"],
    minGames: s["rankings.minGames"],
    updatedAt: new Date(now).toISOString(),
  };
  cache = { at: now, value };
  return value;
}
