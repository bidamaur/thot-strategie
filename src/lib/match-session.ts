import { prisma } from "@/lib/prisma";

/**
 * Score de session d'un affront : parties successives entre les deux mêmes
 * joueurs, reliées par la revanche (Match.rematchOfId). Les couleurs
 * s'inversent à chaque revanche ; le score suit les joueurs, pas les couleurs.
 */

export interface SessionGame {
  id: string;
  status: string;
  winnerId: string | null;
}

export interface SessionScore {
  /** Parties terminées comptées dans le score. */
  played: number;
  /** Numéro de la partie en cours dans la session (1 pour la première). */
  gameNumber: number;
  wins: Record<string, number>;
  draws: number;
}

const COUNTED = new Set(["FINISHED", "ABANDONED"]);

/** Calcul pur : les parties annulées (ABORTED) et en cours ne comptent pas. */
export function sessionScore(games: SessionGame[], playerIds: [string, string]): SessionScore {
  const wins: Record<string, number> = { [playerIds[0]]: 0, [playerIds[1]]: 0 };
  let draws = 0;
  let played = 0;
  for (const g of games) {
    if (!COUNTED.has(g.status)) continue;
    played += 1;
    if (g.winnerId && g.winnerId in wins) wins[g.winnerId]! += 1;
    else draws += 1;
  }
  return { played, gameNumber: games.filter((g) => g.status !== "ABORTED").length || 1, wins, draws };
}

export class SessionError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const MAX_CHAIN = 200;

/** Score de la session à laquelle appartient la partie (joueurs de la partie uniquement). */
export async function getMatchSession(matchId: string, viewerId: string) {
  const current = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true, status: true, winnerId: true, rematchOfId: true, playerWhiteId: true, playerBlackId: true,
      playerWhite: { select: { id: true, username: true } },
      playerBlack: { select: { id: true, username: true } },
    },
  });
  if (!current || !current.playerBlackId || !current.playerBlack) throw new SessionError("Partie introuvable.", 404);
  if (viewerId !== current.playerWhiteId && viewerId !== current.playerBlackId) throw new SessionError("Partie introuvable.", 404);

  const players = [current.playerWhite, current.playerBlack];
  const pair = new Set([current.playerWhiteId, current.playerBlackId]);
  const games: SessionGame[] = [current];
  let previousId = current.rematchOfId;
  while (previousId && games.length < MAX_CHAIN) {
    const previous = await prisma.match.findUnique({
      where: { id: previousId },
      select: { id: true, status: true, winnerId: true, rematchOfId: true, playerWhiteId: true, playerBlackId: true },
    });
    // Par sécurité : la chaîne s'arrête si les joueurs ne sont plus les mêmes.
    if (!previous || !pair.has(previous.playerWhiteId) || !previous.playerBlackId || !pair.has(previous.playerBlackId)) break;
    games.push(previous);
    previousId = previous.rematchOfId;
  }
  games.reverse();
  const score = sessionScore(games, [current.playerWhiteId, current.playerBlackId]);
  return {
    ...score,
    players: players.map((p) => ({ id: p.id, username: p.username, wins: score.wins[p.id] ?? 0 })),
  };
}
