import { MatchStatus, type Prisma } from "@/generated/prisma-client";

/** Joueur empêché de lancer une partie parce qu'il en a déjà une en cours. */
export interface BusyPlayer {
  id: string;
  username: string;
  /** Vrai si c'est le joueur qui a fait la demande. */
  self: boolean;
}

/**
 * « Un des deux joueurs a déjà une partie en cours » : l'erreur précise QUI est
 * occupé, pour que l'interface propose de quitter sa propre partie ou de
 * demander à l'adversaire de quitter la sienne.
 */
export class PlayerBusyError extends Error {
  readonly status = 409;
  readonly code = "PLAYER_BUSY";

  constructor(readonly busy: BusyPlayer[]) {
    const self = busy.some((p) => p.self);
    const others = busy.filter((p) => !p.self).map((p) => p.username);
    super(
      self && others.length > 0
        ? `Vous et ${others.join(", ")} avez déjà une partie en cours.`
        : self
          ? "Vous avez déjà une partie en cours."
          : `${others.join(", ")} a déjà une partie en cours.`,
    );
    this.name = "PlayerBusyError";
  }

  toJSON() {
    return { error: this.message, code: this.code, busy: this.busy };
  }
}

type Db = Pick<Prisma.TransactionClient, "match">;

/** Joueurs (parmi `playerIds`) ayant une partie en cours ; `viewerId` est marqué `self`. */
export async function findBusyPlayers(db: Db, playerIds: string[], viewerId: string): Promise<BusyPlayer[]> {
  const ids = [...new Set(playerIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const rows = await db.match.findMany({
    where: {
      status: MatchStatus.IN_PROGRESS,
      OR: [{ playerWhiteId: { in: ids } }, { playerBlackId: { in: ids } }],
    },
    select: {
      playerWhiteId: true,
      playerBlackId: true,
      playerWhite: { select: { username: true } },
      playerBlack: { select: { username: true } },
    },
  });
  const found = new Map<string, string>();
  for (const row of rows) {
    if (ids.includes(row.playerWhiteId)) found.set(row.playerWhiteId, row.playerWhite.username);
    if (row.playerBlackId && ids.includes(row.playerBlackId)) found.set(row.playerBlackId, row.playerBlack?.username ?? "");
  }
  return ids
    .filter((id) => found.has(id))
    .map((id) => ({ id, username: found.get(id)!, self: id === viewerId }))
    .sort((a, b) => Number(b.self) - Number(a.self));
}

/** Lève PlayerBusyError si l'un des joueurs a déjà une partie en cours. */
export async function assertPlayersFree(db: Db, playerIds: string[], viewerId: string): Promise<void> {
  const busy = await findBusyPlayers(db, playerIds, viewerId);
  if (busy.length > 0) throw new PlayerBusyError(busy);
}
