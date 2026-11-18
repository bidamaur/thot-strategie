import { MatchStatus } from "@/generated/prisma-client";
import { isBlockedBetween } from "@/lib/community/core";
import { notify } from "@/lib/community/notifications";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";

/**
 * Sortie d'une partie en cours, toujours avec l'accord explicite du joueur concerné :
 * - le joueur lui-même confirme « Quitter ma partie en cours » ;
 * - ou il accepte la demande d'un autre joueur qui ne peut pas lancer leur partie.
 * Les parties sont abandonnées par le serveur de jeu (même chemin que le bouton
 * Abandonner) : annulation sans conséquence avant le seuil de coups, sinon défaite.
 */

export class GameExitError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GameExitError";
  }
}

export type ExitRequestStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED";

type ForfeitHook = (userId: string) => Promise<{ ended: number; remaining: number }>;

const activeWhere = (userId: string) => ({
  status: MatchStatus.IN_PROGRESS,
  OR: [{ playerWhiteId: userId }, { playerBlackId: userId }],
});

/** Lien interne uniquement (jamais de redirection externe). */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.length > 200) return null;
  if (path.startsWith("/match")) return null;
  return path;
}

/** Parties en cours du joueur, avec la conséquence d'un abandon maintenant. */
export async function listActiveGames(userId: string) {
  const [rows, settings] = await Promise.all([
    prisma.match.findMany({
      where: activeWhere(userId),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        gameType: true,
        mode: true,
        stakeAmount: true,
        movesHistory: true,
        tournamentMatchId: true,
        clubMatchBoard: { select: { id: true } },
        createdAt: true,
        playerWhiteId: true,
        playerWhite: { select: { username: true } },
        playerBlack: { select: { username: true } },
      },
    }),
    getSettings(["match.abortMovesThreshold"] as const),
  ]);
  const threshold = settings["match.abortMovesThreshold"];
  return rows.map((row) => {
    const moves = Array.isArray(row.movesHistory) ? row.movesHistory.length : 0;
    const consequence: "none" | "loss" = moves < threshold ? "none" : "loss";
    return {
      matchId: row.id,
      gameType: row.gameType,
      mode: row.mode,
      stakeAmount: row.stakeAmount ? row.stakeAmount.toNumber() : null,
      opponent: (row.playerWhiteId === userId ? row.playerBlack?.username : row.playerWhite.username) ?? null,
      context: row.tournamentMatchId ? "tournament" : row.clubMatchBoard ? "interclub" : "game",
      moves,
      consequence,
      startedAt: row.createdAt.toISOString(),
    };
  });
}

/** Abandonne toutes les parties en cours du joueur (il y a consenti). */
export async function forfeitActiveGames(userId: string): Promise<{ ended: number }> {
  const hook = (globalThis as { __thotForfeitPlayerGames?: ForfeitHook }).__thotForfeitPlayerGames;
  if (!hook) {
    // Hors du serveur de jeu (processus séparé) : on ne touche pas aux parties en mémoire.
    throw new GameExitError("Le serveur de jeu est indisponible. Réessayez dans un instant.", 503);
  }
  const { ended, remaining } = await hook(userId);
  if (remaining > 0) {
    throw new GameExitError("Une partie n’a pas pu être arrêtée. Réessayez dans un instant.", 409);
  }
  return { ended };
}

function effectiveStatus(row: { status: string; expiresAt: Date }, now = new Date()): ExitRequestStatus {
  if (row.status === "PENDING" && row.expiresAt <= now) return "EXPIRED";
  return row.status as ExitRequestStatus;
}

/** Demande à `targetId` de quitter sa partie en cours. Idempotent tant qu'elle est en attente. */
export async function createExitRequest(requesterId: string, targetId: string, returnPathInput: unknown) {
  const settings = await getSettings([
    "match.exitRequestsEnabled",
    "match.exitRequestTtlMinutes",
    "match.exitRequestsPerHour",
  ] as const);
  if (!settings["match.exitRequestsEnabled"]) throw new GameExitError("Les demandes de sortie de partie sont désactivées.", 403);
  if (!targetId || targetId === requesterId) throw new GameExitError("Joueur invalide.", 400);

  const [requester, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: requesterId }, select: { username: true } }),
    prisma.user.findUnique({ where: { id: targetId }, select: { id: true, username: true } }),
  ]);
  if (!requester || !target) throw new GameExitError("Joueur introuvable.", 404);
  if (await isBlockedBetween(requesterId, targetId)) throw new GameExitError("Interaction impossible avec ce joueur.", 403);

  const busy = await prisma.match.count({ where: activeWhere(targetId) });
  if (busy === 0) throw new GameExitError(`${target.username} n’a plus de partie en cours : vous pouvez relancer.`, 409);

  const now = new Date();
  const pending = await prisma.gameExitRequest.findFirst({
    where: { requesterId, targetId, status: "PENDING", expiresAt: { gt: now } },
    select: { id: true, expiresAt: true },
  });
  if (pending) return { id: pending.id, status: "PENDING" as const, expiresAt: pending.expiresAt.toISOString(), alreadySent: true };

  const lastHour = await prisma.gameExitRequest.count({
    where: { requesterId, createdAt: { gt: new Date(now.getTime() - 3_600_000) } },
  });
  if (lastHour >= settings["match.exitRequestsPerHour"]) {
    throw new GameExitError("Trop de demandes envoyées. Réessayez plus tard.", 429);
  }

  const expiresAt = new Date(now.getTime() + settings["match.exitRequestTtlMinutes"] * 60_000);
  const request = await prisma.gameExitRequest.create({
    data: { requesterId, targetId, returnPath: safeReturnPath(returnPathInput), expiresAt },
    select: { id: true },
  });
  await notify({
    userId: targetId,
    actorId: requesterId,
    type: "GAME_EXIT_REQUEST",
    title: `${requester.username} vous demande de quitter votre partie en cours`,
    body: "Il ne peut pas lancer votre partie tant que la vôtre n’est pas terminée. Rien ne sera arrêté sans votre accord.",
    link: `/partie-en-cours?demande=${request.id}`,
  });
  return { id: request.id, status: "PENDING" as const, expiresAt: expiresAt.toISOString(), alreadySent: false };
}

/** Demandes reçues encore en attente (pour la page « Partie en cours »). */
export async function listReceivedRequests(userId: string) {
  const rows = await prisma.gameExitRequest.findMany({
    where: { targetId: userId, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, expiresAt: true, requester: { select: { username: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    requester: r.requester.username,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
  }));
}

/** Accepte (abandon de toutes ses parties en cours) ou refuse une demande reçue. */
export async function respondExitRequest(userId: string, requestId: string, accept: boolean) {
  const request = await prisma.gameExitRequest.findUnique({
    where: { id: requestId },
    select: { id: true, requesterId: true, targetId: true, status: true, expiresAt: true, returnPath: true, target: { select: { username: true } } },
  });
  if (!request || request.targetId !== userId) throw new GameExitError("Demande introuvable.", 404);
  const status = effectiveStatus(request);
  if (status === "EXPIRED") {
    await prisma.gameExitRequest.updateMany({ where: { id: requestId, status: "PENDING" }, data: { status: "EXPIRED" } });
    throw new GameExitError("Cette demande a expiré.", 409);
  }
  if (status !== "PENDING") throw new GameExitError("Cette demande a déjà été traitée.", 409);

  let ended = 0;
  if (accept) ended = (await forfeitActiveGames(userId)).ended;

  // L'arrêt des parties est déjà fait : la réponse est enregistrée une seule fois.
  const claimed = await prisma.gameExitRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() },
  });
  if (claimed.count === 1) {
    await notify({
      userId: request.requesterId,
      actorId: userId,
      type: "GAME_EXIT_ANSWER",
      title: accept
        ? `${request.target.username} a quitté sa partie : vous pouvez lancer la vôtre`
        : `${request.target.username} préfère terminer sa partie en cours`,
      link: accept ? request.returnPath : null,
    });
  }
  return { status: accept ? ("ACCEPTED" as const) : ("DECLINED" as const), ended };
}

/** Le demandeur retire sa demande. */
export async function cancelExitRequest(userId: string, requestId: string) {
  const updated = await prisma.gameExitRequest.updateMany({
    where: { id: requestId, requesterId: userId, status: "PENDING" },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });
  if (updated.count === 0) throw new GameExitError("Demande introuvable ou déjà traitée.", 404);
}

/** Suivi par le demandeur (l'interface interroge tant que la demande est en attente). */
export async function getSentRequest(userId: string, requestId: string) {
  const row = await prisma.gameExitRequest.findUnique({
    where: { id: requestId },
    select: { requesterId: true, targetId: true, status: true, expiresAt: true },
  });
  if (!row || row.requesterId !== userId) throw new GameExitError("Demande introuvable.", 404);
  const status = effectiveStatus(row);
  const targetBusy = status === "PENDING" ? (await prisma.match.count({ where: activeWhere(row.targetId) })) > 0 : null;
  return { status, expiresAt: row.expiresAt.toISOString(), targetBusy };
}
