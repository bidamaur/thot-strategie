import { ClubMatchStatus, MatchMode, MatchStatus, Prisma } from "@/generated/prisma-client";
import { writeAuditLog } from "@/lib/audit";
import { withSerializableRetry } from "@/lib/db/retry";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";
import { actorPrivileges, CommunityError, PLAYER_CARD_SELECT, playerCard, requireActor } from "./core";
import { notify, type NotifyInput } from "./notifications";
import { cleanText, decodeFromDb, encodeBounded } from "./text";

/**
 * Rencontres interclubs : club contre club sur N échiquiers.
 * 1. un responsable propose (privilège Premium « championnats de club » si exigé) ;
 * 2. un responsable du club adverse accepte ;
 * 3. chaque club aligne ses joueurs (ordre des échiquiers) ;
 * 4. chaque échiquier se joue comme une partie normale (même moteur, même salle de jeu) ;
 * 5. le résultat est consolidé à la lecture : 1 point par victoire, ½ par nulle.
 * Jamais de points argent ; le mode classé met à jour l'ELO comme une partie ordinaire.
 */

type Side = "HOME" | "AWAY";

async function managerRole(userId: string, clubId: string) {
  const m = await prisma.clubMember.findUnique({ where: { clubId_userId: { clubId, userId } }, select: { role: true } });
  return m?.role === "OWNER" || m?.role === "ADMIN";
}

async function clubManagers(clubIds: string[]): Promise<{ userId: string; clubId: string }[]> {
  return prisma.clubMember.findMany({ where: { clubId: { in: clubIds }, role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true, clubId: true } });
}

async function expireProposals() {
  await prisma.clubMatch.updateMany({
    where: { status: ClubMatchStatus.PROPOSED, expiresAt: { lt: new Date() } },
    data: { status: ClubMatchStatus.EXPIRED },
  });
}

export async function proposeClubMatch(
  userId: string,
  input: { homeClub?: unknown; awayClub?: unknown; boards?: unknown; gameType?: unknown; draughtsVariant?: unknown; timeControlMinutes?: unknown; mode?: unknown; message?: unknown },
) {
  const actor = await requireActor(userId);
  const s = await getSettings([
    "clubs.interclubEnabled",
    "clubs.interclubRequiresPremium",
    "clubs.interclubMaxBoards",
    "clubs.interclubProposalExpiryHours",
    "matchmaking.casualEnabled",
    "matchmaking.ratedEnabled",
    "matchmaking.timeControlMin",
    "matchmaking.timeControlMax",
  ] as const);
  if (!s["clubs.interclubEnabled"]) throw new CommunityError("Les rencontres interclubs sont désactivées.", 403);
  const [home, away] = await Promise.all([
    typeof input.homeClub === "string" ? prisma.club.findUnique({ where: { slug: input.homeClub }, select: { id: true, name: true, slug: true } }) : null,
    typeof input.awayClub === "string" ? prisma.club.findFirst({ where: { OR: [{ slug: input.awayClub }, { id: input.awayClub }] }, select: { id: true, name: true, slug: true } }) : null,
  ]);
  if (!home || !away) throw new CommunityError("Club introuvable.", 404);
  if (home.id === away.id) throw new CommunityError("Un club ne peut pas se défier lui-même.", 400);
  if (!actor.isAdmin && !(await managerRole(userId, home.id))) throw new CommunityError("Seuls les responsables du club peuvent lancer une rencontre.", 403);
  if (s["clubs.interclubRequiresPremium"] && !actor.isAdmin) {
    const privileges = await actorPrivileges(actor);
    if (!privileges.clubChampionships) throw new CommunityError("Lancer une rencontre interclubs est un privilège Premium (championnats de club).", 403);
  }

  const boards = Number(input.boards);
  if (!Number.isInteger(boards) || boards < 1 || boards > s["clubs.interclubMaxBoards"]) {
    throw new CommunityError(`Nombre d’échiquiers entre 1 et ${s["clubs.interclubMaxBoards"]}.`, 400);
  }
  const gameType = input.gameType === "CHESS" ? "CHESS" : input.gameType === "CHECKERS" ? "CHECKERS" : null;
  if (!gameType) throw new CommunityError("Choisissez les échecs ou les dames.", 400);
  const mode = input.mode === "RATED" ? MatchMode.RATED : MatchMode.CASUAL;
  if (mode === MatchMode.RATED && !s["matchmaking.ratedEnabled"]) throw new CommunityError("Les parties classées sont fermées.", 403);
  if (mode === MatchMode.CASUAL && !s["matchmaking.casualEnabled"]) throw new CommunityError("Les parties amicales sont fermées.", 403);
  let timeControlMinutes: number | null = null;
  if (input.timeControlMinutes !== null && input.timeControlMinutes !== undefined && input.timeControlMinutes !== "") {
    const m = Number(input.timeControlMinutes);
    if (!Number.isInteger(m) || m < s["matchmaking.timeControlMin"] || m > s["matchmaking.timeControlMax"]) throw new CommunityError("Cadence invalide.", 400);
    timeControlMinutes = m;
  }

  await expireProposals();
  const pending = await prisma.clubMatch.count({
    where: {
      status: { in: [ClubMatchStatus.PROPOSED, ClubMatchStatus.LINEUP, ClubMatchStatus.IN_PROGRESS] },
      OR: [{ homeClubId: home.id, awayClubId: away.id }, { homeClubId: away.id, awayClubId: home.id }],
    },
  });
  if (pending > 0) throw new CommunityError("Une rencontre est déjà en cours entre ces deux clubs.", 409);

  const message = cleanText(input.message, 300);
  const match = await prisma.$transaction(async (tx) => {
    const created = await tx.clubMatch.create({
      data: {
        homeClubId: home.id,
        awayClubId: away.id,
        proposedById: userId,
        boards,
        gameType,
        draughtsVariant: gameType === "CHECKERS" ? (input.draughtsVariant === "ENGLISH" ? "ENGLISH" : "INTERNATIONAL") : null,
        timeControlMinutes,
        mode,
        message: message ? encodeBounded(message, 300) : null,
        expiresAt: new Date(Date.now() + s["clubs.interclubProposalExpiryHours"] * 3600_000),
      },
    });
    await writeAuditLog(tx, { actorId: userId, action: "CLUB_MATCH_PROPOSED", entity: "ClubMatch", entityId: created.id, after: { home: home.slug, away: away.slug, boards } });
    return created;
  });
  const managers = await clubManagers([away.id]);
  await notify(
    managers.map((m) => ({
      userId: m.userId,
      actorId: userId,
      type: "CLUB_MATCH" as const,
      title: `${home.name} défie ${away.name} sur ${boards} échiquier(s)`,
      body: message || null,
      link: `/interclubs/${match.id}`,
    })),
  );
  return { id: match.id };
}

async function loadMatch(id: string) {
  const match = await prisma.clubMatch.findUnique({ where: { id }, include: { homeClub: { select: { id: true, name: true, slug: true } }, awayClub: { select: { id: true, name: true, slug: true } } } });
  if (!match) throw new CommunityError("Rencontre introuvable.", 404);
  return match;
}

export async function respondClubMatch(userId: string, id: string, accept: boolean) {
  const actor = await requireActor(userId, accept ? "write" : "read");
  await expireProposals();
  const match = await loadMatch(id);
  if (!actor.isAdmin && !(await managerRole(userId, match.awayClubId))) throw new CommunityError("Seuls les responsables du club défié peuvent répondre.", 403);
  if (match.status !== ClubMatchStatus.PROPOSED) throw new CommunityError(match.status === "EXPIRED" ? "Cette proposition a expiré." : "Cette proposition n’est plus en attente.", 409);
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.clubMatch.updateMany({
      where: { id, status: ClubMatchStatus.PROPOSED },
      data: { status: accept ? ClubMatchStatus.LINEUP : ClubMatchStatus.DECLINED, respondedAt: new Date() },
    });
    if (claimed.count !== 1) throw new CommunityError("Cette proposition n’est plus en attente.", 409);
    if (accept) {
      await tx.clubMatchBoard.createMany({
        data: Array.from({ length: match.boards }, (_, i) => ({ clubMatchId: id, board: i + 1, homeIsWhite: (i + 1) % 2 === 1 })),
      });
    }
  });
  const managers = await clubManagers([match.homeClubId]);
  await notify(
    managers.map((m) => ({
      userId: m.userId,
      actorId: userId,
      type: "CLUB_MATCH" as const,
      title: accept ? `${match.awayClub.name} accepte la rencontre : composez votre équipe` : `${match.awayClub.name} décline la rencontre`,
      link: `/interclubs/${id}`,
    })),
  );
  if (accept) {
    const awayManagers = (await clubManagers([match.awayClubId])).filter((m) => m.userId !== userId);
    await notify(awayManagers.map((m) => ({ userId: m.userId, actorId: userId, type: "CLUB_MATCH" as const, title: `Rencontre contre ${match.homeClub.name} acceptée : composez votre équipe`, link: `/interclubs/${id}` })));
  }
}

export async function cancelClubMatch(userId: string, id: string) {
  const actor = await requireActor(userId, "read");
  const match = await loadMatch(id);
  const isManager = actor.isAdmin || (await managerRole(userId, match.homeClubId)) || (await managerRole(userId, match.awayClubId));
  if (!isManager) throw new CommunityError("Action réservée aux responsables des clubs.", 403);
  const updated = await prisma.clubMatch.updateMany({
    where: { id, status: { in: [ClubMatchStatus.PROPOSED, ClubMatchStatus.LINEUP] } },
    data: { status: ClubMatchStatus.CANCELLED },
  });
  if (updated.count === 0) throw new CommunityError("Une rencontre commencée ne peut plus être annulée.", 409);
}

/** Composition d'équipe : l'ordre de la liste = l'ordre des échiquiers. */
export async function setLineup(userId: string, id: string, side: Side, playerIds: string[]) {
  const actor = await requireActor(userId);
  const match = await loadMatch(id);
  const clubId = side === "HOME" ? match.homeClubId : match.awayClubId;
  if (!actor.isAdmin && !(await managerRole(userId, clubId))) throw new CommunityError("Seuls les responsables du club composent l’équipe.", 403);
  if (match.status !== ClubMatchStatus.LINEUP) throw new CommunityError("La composition n’est plus modifiable.", 409);
  const ids = playerIds.slice(0, match.boards);
  if (ids.length !== match.boards || new Set(ids).size !== ids.length) {
    throw new CommunityError(`Choisissez ${match.boards} joueurs différents.`, 400);
  }
  const members = await prisma.clubMember.count({ where: { clubId, userId: { in: ids } } });
  if (members !== ids.length) throw new CommunityError("Tous les joueurs doivent être membres du club.", 400);

  const result = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const boards = await tx.clubMatchBoard.findMany({ where: { clubMatchId: id }, orderBy: { board: "asc" } });
        const other = new Set(boards.map((b) => (side === "HOME" ? b.awayPlayerId : b.homePlayerId)).filter(Boolean));
        if (ids.some((p) => other.has(p))) throw new CommunityError("Un joueur ne peut pas jouer pour les deux clubs.", 400);
        for (const b of boards) {
          await tx.clubMatchBoard.update({
            where: { id: b.id },
            data: side === "HOME" ? { homePlayerId: ids[b.board - 1] } : { awayPlayerId: ids[b.board - 1] },
          });
        }
        const fresh = await tx.clubMatchBoard.findMany({ where: { clubMatchId: id } });
        const complete = fresh.every((b) => b.homePlayerId && b.awayPlayerId);
        if (complete) {
          await tx.clubMatch.update({ where: { id }, data: { status: ClubMatchStatus.IN_PROGRESS, startedAt: new Date() } });
        }
        return { complete, players: fresh.flatMap((b) => [b.homePlayerId!, b.awayPlayerId!]).filter(Boolean) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
  if (result.complete) {
    await notify(
      result.players.map((p) => ({
        userId: p,
        actorId: userId,
        type: "CLUB_MATCH" as const,
        title: `${match.homeClub.name} – ${match.awayClub.name} : votre partie interclubs est prête`,
        link: `/interclubs/${id}`,
      })),
    );
  }
  return { started: result.complete };
}

/** Lance (ou reprend) la partie d'un échiquier : une partie ordinaire liée à la rencontre. */
export async function startBoardGame(userId: string, boardId: string): Promise<{ matchId: string }> {
  await requireActor(userId);
  try {
    return await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const board = await tx.clubMatchBoard.findUnique({ where: { id: boardId }, include: { clubMatch: true, match: { select: { id: true, status: true } } } });
          if (!board) throw new CommunityError("Échiquier introuvable.", 404);
          if (userId !== board.homePlayerId && userId !== board.awayPlayerId) throw new CommunityError("Seuls les deux joueurs de cet échiquier peuvent lancer la partie.", 403);
          if (board.clubMatch.status !== ClubMatchStatus.IN_PROGRESS || board.result) throw new CommunityError("Cette partie n’est plus à jouer.", 409);
          if (board.match?.status === MatchStatus.IN_PROGRESS) return { matchId: board.match.id };
          const players = [board.homePlayerId!, board.awayPlayerId!];
          const busy = await tx.match.findFirst({
            where: { status: MatchStatus.IN_PROGRESS, OR: [{ playerWhiteId: { in: players } }, { playerBlackId: { in: players } }] },
            select: { id: true },
          });
          if (busy) throw new CommunityError("Un des deux joueurs a déjà une partie en cours.", 409);
          const [white, black] = board.homeIsWhite ? players : [players[1]!, players[0]!];
          const cm = board.clubMatch;
          const game = await tx.match.create({
            data: {
              playerWhiteId: white,
              playerBlackId: black,
              gameType: cm.gameType,
              draughtsVariant: cm.draughtsVariant,
              timeControlMinutes: cm.timeControlMinutes,
              mode: cm.mode,
              rated: cm.mode === MatchMode.RATED,
              status: MatchStatus.IN_PROGRESS,
              movesHistory: [],
            },
            select: { id: true },
          });
          await tx.clubMatchBoard.update({ where: { id: boardId }, data: { matchId: game.id } });
          return { matchId: game.id, opponent: userId === board.homePlayerId ? board.awayPlayerId! : board.homePlayerId!, clubMatchId: cm.id };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    ).then(async (r) => {
      if ("opponent" in r && r.opponent) {
        await notify({ userId: r.opponent, actorId: userId, type: "CLUB_MATCH", title: "Votre adversaire interclubs vous attend sur l’échiquier", link: `/match/${r.matchId}` });
      }
      return { matchId: r.matchId };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      const board = await prisma.clubMatchBoard.findUnique({ where: { id: boardId }, select: { matchId: true } });
      if (board?.matchId) return { matchId: board.matchId };
    }
    throw error;
  }
}

/**
 * Consolide les résultats à partir des parties terminées (idempotent).
 * Partie annulée (avant le 2e coup) : l'échiquier redevient jouable.
 */
export async function reconcileClubMatch(id: string): Promise<void> {
  const match = await prisma.clubMatch.findUnique({
    where: { id },
    include: {
      homeClub: { select: { name: true } },
      awayClub: { select: { name: true } },
      boardList: { include: { match: { select: { status: true, winnerId: true } } } },
    },
  });
  if (!match || match.status !== ClubMatchStatus.IN_PROGRESS) return;
  for (const b of match.boardList) {
    if (b.result || !b.matchId || !b.match) continue;
    if (b.match.status === MatchStatus.ABORTED) {
      await prisma.clubMatchBoard.updateMany({ where: { id: b.id, matchId: b.matchId }, data: { matchId: null } });
    } else if (b.match.status === MatchStatus.FINISHED || b.match.status === MatchStatus.ABANDONED) {
      const result = b.match.winnerId === null ? "DRAW" : b.match.winnerId === b.homePlayerId ? "HOME" : "AWAY";
      await prisma.clubMatchBoard.updateMany({ where: { id: b.id, result: null }, data: { result } });
    }
  }
  const boards = await prisma.clubMatchBoard.findMany({ where: { clubMatchId: id } });
  const home = boards.reduce((t, b) => t + (b.result === "HOME" ? 1 : b.result === "DRAW" ? 0.5 : 0), 0);
  const away = boards.reduce((t, b) => t + (b.result === "AWAY" ? 1 : b.result === "DRAW" ? 0.5 : 0), 0);
  const done = boards.every((b) => b.result);
  const closed = await prisma.clubMatch.updateMany({
    where: { id, status: ClubMatchStatus.IN_PROGRESS },
    data: {
      homeScore: home,
      awayScore: away,
      ...(done
        ? { status: ClubMatchStatus.COMPLETED, completedAt: new Date(), winnerClubId: home > away ? match.homeClubId : away > home ? match.awayClubId : null }
        : {}),
    },
  });
  if (done && closed.count === 1) {
    const members = await prisma.clubMember.findMany({ where: { clubId: { in: [match.homeClubId, match.awayClubId] } }, select: { userId: true }, take: 2000 });
    const title = `${match.homeClub.name} ${home} – ${away} ${match.awayClub.name} : rencontre terminée`;
    await notify([...new Set(members.map((m) => m.userId))].map((u): NotifyInput => ({ userId: u, type: "CLUB_MATCH", title, link: `/interclubs/${id}` })));
  }
}

const BOARD_PLAYER = { select: PLAYER_CARD_SELECT } as const;

export async function getClubMatch(id: string, viewer: { id: string; isAdmin: boolean } | null) {
  await expireProposals();
  await reconcileClubMatch(id);
  const m = await prisma.clubMatch.findUnique({
    where: { id },
    include: {
      homeClub: { select: { id: true, name: true, slug: true, logo: true, isPrivate: true } },
      awayClub: { select: { id: true, name: true, slug: true, logo: true, isPrivate: true } },
      proposedBy: { select: { username: true } },
      boardList: {
        orderBy: { board: "asc" },
        include: { homePlayer: BOARD_PLAYER, awayPlayer: BOARD_PLAYER, match: { select: { status: true } } },
      },
    },
  });
  if (!m) throw new CommunityError("Rencontre introuvable.", 404);
  const [homeManager, awayManager] = viewer
    ? await Promise.all([managerRole(viewer.id, m.homeClubId), managerRole(viewer.id, m.awayClubId)])
    : [false, false];
  const canManageHome = homeManager || (viewer?.isAdmin ?? false);
  const canManageAway = awayManager || (viewer?.isAdmin ?? false);
  // Membres proposés pour la composition (uniquement pour les responsables, pendant la composition).
  const roster = async (clubId: string) =>
    (await prisma.clubMember.findMany({ where: { clubId }, take: 300, include: { user: { select: PLAYER_CARD_SELECT } } }))
      .map((x) => playerCard(x.user))
      .sort((a, b) => b.elo - a.elo);
  return {
    id: m.id,
    status: m.status,
    home: { id: m.homeClub.id, name: m.homeClub.name, slug: m.homeClub.slug, logo: m.homeClub.logo, score: m.homeScore },
    away: { id: m.awayClub.id, name: m.awayClub.name, slug: m.awayClub.slug, logo: m.awayClub.logo, score: m.awayScore },
    winnerClubId: m.winnerClubId,
    boards: m.boards,
    gameType: m.gameType,
    draughtsVariant: m.draughtsVariant,
    timeControlMinutes: m.timeControlMinutes,
    mode: m.mode,
    message: decodeFromDb(m.message),
    proposedBy: m.proposedBy.username,
    expiresAt: m.expiresAt.toISOString(),
    createdAt: m.createdAt.toISOString(),
    boardList: m.boardList.map((b) => ({
      id: b.id,
      board: b.board,
      homeIsWhite: b.homeIsWhite,
      home: b.homePlayer ? playerCard(b.homePlayer) : null,
      away: b.awayPlayer ? playerCard(b.awayPlayer) : null,
      result: b.result,
      matchId: b.matchId,
      live: b.match?.status === MatchStatus.IN_PROGRESS,
      mine: !!viewer && (viewer.id === b.homePlayerId || viewer.id === b.awayPlayerId),
    })),
    viewer: {
      canManageHome,
      canManageAway,
      canRespond: m.status === "PROPOSED" && canManageAway,
      canCancel: (m.status === "PROPOSED" || m.status === "LINEUP") && (canManageHome || canManageAway),
    },
    rosters:
      m.status === "LINEUP"
        ? { home: canManageHome ? await roster(m.homeClubId) : null, away: canManageAway ? await roster(m.awayClubId) : null }
        : null,
  };
}

export async function listClubMatches(clubSlug: string) {
  await expireProposals();
  const club = await prisma.club.findUnique({ where: { slug: clubSlug }, select: { id: true } });
  if (!club) throw new CommunityError("Club introuvable.", 404);
  const active = await prisma.clubMatch.findMany({ where: { status: "IN_PROGRESS", OR: [{ homeClubId: club.id }, { awayClubId: club.id }] }, select: { id: true } });
  for (const m of active) await reconcileClubMatch(m.id);
  const rows = await prisma.clubMatch.findMany({
    where: { OR: [{ homeClubId: club.id }, { awayClubId: club.id }], status: { notIn: ["CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { homeClub: { select: { name: true, slug: true } }, awayClub: { select: { name: true, slug: true } } },
  });
  return rows.map((m) => ({
    id: m.id,
    status: m.status,
    home: { ...m.homeClub, score: m.homeScore },
    away: { ...m.awayClub, score: m.awayScore },
    boards: m.boards,
    gameType: m.gameType,
    mode: m.mode,
    winnerClubId: m.winnerClubId,
    isHome: m.homeClubId === club.id,
    createdAt: m.createdAt.toISOString(),
  }));
}

/** Classement interclubs : victoire 2 pts, nul 1 pt ; départage aux points d'échiquiers. */
export async function interclubStandings(limit = 50) {
  const rows = await prisma.clubMatch.findMany({
    where: { status: "COMPLETED" },
    select: { homeClubId: true, awayClubId: true, homeScore: true, awayScore: true, homeClub: { select: { name: true, slug: true, logo: true } }, awayClub: { select: { name: true, slug: true, logo: true } } },
    take: 5000,
  });
  const table = new Map<string, { clubId: string; name: string; slug: string; logo: string | null; played: number; wins: number; draws: number; losses: number; points: number; boardsFor: number; boardsAgainst: number }>();
  const entry = (id: string, club: { name: string; slug: string; logo: string | null }) => {
    if (!table.has(id)) table.set(id, { clubId: id, ...club, played: 0, wins: 0, draws: 0, losses: 0, points: 0, boardsFor: 0, boardsAgainst: 0 });
    return table.get(id)!;
  };
  for (const r of rows) {
    const h = entry(r.homeClubId, r.homeClub);
    const a = entry(r.awayClubId, r.awayClub);
    h.played += 1;
    a.played += 1;
    h.boardsFor += r.homeScore;
    h.boardsAgainst += r.awayScore;
    a.boardsFor += r.awayScore;
    a.boardsAgainst += r.homeScore;
    if (r.homeScore > r.awayScore) {
      h.wins += 1; h.points += 2; a.losses += 1;
    } else if (r.awayScore > r.homeScore) {
      a.wins += 1; a.points += 2; h.losses += 1;
    } else {
      h.draws += 1; a.draws += 1; h.points += 1; a.points += 1;
    }
  }
  return [...table.values()]
    .sort((x, y) => y.points - x.points || y.boardsFor - y.boardsAgainst - (x.boardsFor - x.boardsAgainst) || y.boardsFor - x.boardsFor)
    .slice(0, limit)
    .map((row, i) => ({ rank: i + 1, ...row }));
}

/** Parties interclubs lancées mais jamais commencées : à annuler (l'échiquier redevient jouable). */
export async function staleInterclubMatchIds(olderThanMinutes = 10): Promise<string[]> {
  const rows = await prisma.clubMatchBoard.findMany({
    where: { result: null, match: { status: MatchStatus.IN_PROGRESS, createdAt: { lt: new Date(Date.now() - olderThanMinutes * 60_000) } } },
    select: { matchId: true, match: { select: { movesHistory: true } } },
    take: 100,
  });
  return rows.filter((r) => r.matchId && Array.isArray(r.match?.movesHistory) && r.match.movesHistory.length === 0).map((r) => r.matchId!);
}
