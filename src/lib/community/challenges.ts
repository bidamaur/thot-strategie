import { FriendChallengeStatus, MatchMode, MatchStatus, Prisma } from "@/generated/prisma-client";
import { assertPlayersFree } from "@/lib/game-exit/busy";
import { withSerializableRetry } from "@/lib/db/retry";
import { assertCanQueueForMoney, getMoneyRules, lockMoneyMatchStakes, MoneyEligibilityError } from "@/lib/economy/money-matches";
import { prisma } from "@/lib/prisma";
import { assertCanStartGame, QuotaReachedError } from "@/lib/quota";
import { getSettings } from "@/lib/settings/service";
import { CommunityError, PLAYER_CARD_SELECT, assertNotBlocked, playerCard, requireActor } from "./core";
import { areFriends } from "./friends";
import { notify } from "./notifications";
import { cleanText, decodeFromDb, encodeBounded } from "./text";

/**
 * Défis entre amis. Aucun moteur parallèle : à l'acceptation on crée une partie
 * classique (table Match), exactement comme le matchmaking ou les tournois, puis
 * les deux joueurs la rejoignent via la salle de jeu habituelle.
 *
 * Points argent : rien n'est bloqué à la création ; les deux mises sont bloquées
 * ensemble, dans la transaction qui crée la partie, et seulement si le
 * destinataire confirme explicitement la mise. Un défi refusé, annulé ou expiré
 * ne débite jamais rien.
 */

export interface ChallengeInput {
  to?: unknown;
  gameType?: unknown;
  draughtsVariant?: unknown;
  timeControlMinutes?: unknown;
  mode?: unknown;
  stake?: unknown;
  color?: unknown;
  message?: unknown;
  /** Consentement explicite du lanceur pour un défi en points argent. */
  moneyConsent?: unknown;
}

/** Passe en EXPIRED les défis sans réponse et prévient le lanceur. */
export async function expireChallenges(now = new Date()): Promise<number> {
  const stale = await prisma.friendChallenge.findMany({
    where: { status: FriendChallengeStatus.PENDING, expiresAt: { lte: now } },
    select: { id: true, challengerId: true, challenged: { select: { username: true } } },
    take: 500,
  });
  if (stale.length === 0) return 0;
  const updated = await prisma.friendChallenge.updateMany({
    where: { id: { in: stale.map((c) => c.id) }, status: FriendChallengeStatus.PENDING },
    data: { status: FriendChallengeStatus.EXPIRED, respondedAt: now },
  });
  await notify(
    stale.map((c) => ({
      userId: c.challengerId,
      type: "CHALLENGE_DECLINED" as const,
      title: `${c.challenged.username} n’a pas répondu à votre défi : il a expiré`,
      link: "/communaute?tab=defis",
    })),
  );
  return updated.count;
}

/** Défis acceptés dont la partie est finie → COMPLETED (lecture paresseuse). */
async function completeFinishedChallenges(userId: string) {
  await prisma.friendChallenge.updateMany({
    where: {
      status: FriendChallengeStatus.ACCEPTED,
      OR: [{ challengerId: userId }, { challengedId: userId }],
      match: { status: { in: [MatchStatus.FINISHED, MatchStatus.ABANDONED, MatchStatus.ABORTED] } },
    },
    data: { status: FriendChallengeStatus.COMPLETED },
  });
}

async function assertQuota(userId: string, mode: MatchMode) {
  try {
    await assertCanStartGame(userId, mode, "challenge");
  } catch (error) {
    if (error instanceof QuotaReachedError) throw new CommunityError(error.message, 403);
    throw error;
  }
}

export async function createChallenge(userId: string, input: ChallengeInput) {
  const actor = await requireActor(userId);
  const settings = await getSettings([
    "community.challengesEnabled",
    "community.challengeExpiryMinutes",
    "community.maxPendingChallenges",
    "community.challengeMoneyEnabled",
    "community.challengeNonFriends",
    "matchmaking.casualEnabled",
    "matchmaking.ratedEnabled",
    "matchmaking.timeControlMin",
    "matchmaking.timeControlMax",
  ] as const);
  if (!settings["community.challengesEnabled"]) throw new CommunityError("Les défis entre amis sont désactivés.", 403);

  const target = typeof input.to === "string"
    ? await prisma.user.findFirst({ where: { OR: [{ id: input.to }, { username: input.to }] }, select: { id: true, username: true } })
    : null;
  if (!target) throw new CommunityError("Joueur introuvable.", 404);
  if (target.id === userId) throw new CommunityError("Vous ne pouvez pas vous défier vous-même.", 400);
  await assertNotBlocked(userId, target.id);
  if (!settings["community.challengeNonFriends"] && !(await areFriends(userId, target.id))) {
    throw new CommunityError("Vous ne pouvez défier que vos amis.", 403);
  }

  const gameType = input.gameType === "CHESS" ? "CHESS" : input.gameType === "CHECKERS" ? "CHECKERS" : null;
  if (!gameType) throw new CommunityError("Choisissez les échecs ou les dames.", 400);
  const draughtsVariant = gameType === "CHECKERS" ? (input.draughtsVariant === "ENGLISH" ? "ENGLISH" : "INTERNATIONAL") : null;

  let timeControlMinutes: number | null = null;
  if (input.timeControlMinutes !== null && input.timeControlMinutes !== undefined && input.timeControlMinutes !== "") {
    const minutes = Number(input.timeControlMinutes);
    if (!Number.isInteger(minutes) || minutes < settings["matchmaking.timeControlMin"] || minutes > settings["matchmaking.timeControlMax"]) {
      throw new CommunityError(`Cadence entre ${settings["matchmaking.timeControlMin"]} et ${settings["matchmaking.timeControlMax"]} minutes.`, 400);
    }
    timeControlMinutes = minutes;
  }

  const mode = input.mode === "RATED" ? MatchMode.RATED : input.mode === "MONEY" ? MatchMode.MONEY : MatchMode.CASUAL;
  if (mode === MatchMode.CASUAL && !settings["matchmaking.casualEnabled"]) throw new CommunityError("Les parties amicales sont fermées.", 403);
  if (mode === MatchMode.RATED && !settings["matchmaking.ratedEnabled"]) throw new CommunityError("Les parties classées sont fermées.", 403);

  await assertQuota(userId, mode);

  let stakeAmount: number | null = null;
  if (mode === MatchMode.MONEY) {
    if (!settings["community.challengeMoneyEnabled"]) throw new CommunityError("Les défis en points argent sont désactivés.", 403);
    if (input.moneyConsent !== true) {
      throw new CommunityError("Confirmez explicitement l’engagement de points argent.", 400);
    }
    const stake = Number(input.stake);
    try {
      await assertCanQueueForMoney(userId, stake);
    } catch (error) {
      if (error instanceof MoneyEligibilityError) throw new CommunityError(error.message, 403);
      throw error;
    }
    stakeAmount = stake;
  }

  const color = input.color === "white" || input.color === "black" ? input.color : "random";
  const message = cleanText(input.message, 200);

  await expireChallenges();
  const pending = await prisma.friendChallenge.count({ where: { challengerId: userId, status: FriendChallengeStatus.PENDING } });
  if (pending >= settings["community.maxPendingChallenges"]) {
    throw new CommunityError("Vous avez trop de défis en attente. Annulez-en ou attendez une réponse.", 429);
  }
  const duplicate = await prisma.friendChallenge.findFirst({
    where: { challengerId: userId, challengedId: target.id, status: FriendChallengeStatus.PENDING },
    select: { id: true },
  });
  if (duplicate) throw new CommunityError("Un défi est déjà en attente avec ce joueur.", 409);

  const challenge = await prisma.friendChallenge.create({
    data: {
      challengerId: userId,
      challengedId: target.id,
      gameType,
      draughtsVariant,
      timeControlMinutes,
      mode,
      stakeAmount,
      challengerColor: color,
      message: message ? encodeBounded(message, 200) : null,
      expiresAt: new Date(Date.now() + settings["community.challengeExpiryMinutes"] * 60_000),
    },
  });
  const gameLabel = gameType === "CHESS" ? "échecs" : "dames";
  await notify({
    userId: target.id,
    actorId: userId,
    type: "CHALLENGE_RECEIVED",
    title: `${actor.username} vous défie aux ${gameLabel}${mode === MatchMode.MONEY ? ` (${stakeAmount} FCFA en points argent)` : ""}`,
    body: message || null,
    link: "/communaute?tab=defis",
  });
  return { id: challenge.id, expiresAt: challenge.expiresAt.toISOString() };
}

export async function respondChallenge(
  userId: string,
  challengeId: string,
  decision: "accept" | "decline",
  options: { acceptMoney?: unknown } = {},
) {
  const actor = await requireActor(userId, decision === "accept" ? "write" : "read");
  await expireChallenges();
  const challenge = await prisma.friendChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge || challenge.challengedId !== userId) throw new CommunityError("Défi introuvable.", 404);
  if (challenge.status !== FriendChallengeStatus.PENDING) {
    throw new CommunityError(challenge.status === "EXPIRED" ? "Ce défi a expiré." : "Ce défi n’est plus en attente.", 409);
  }

  if (decision === "decline") {
    const updated = await prisma.friendChallenge.updateMany({
      where: { id: challengeId, status: FriendChallengeStatus.PENDING },
      data: { status: FriendChallengeStatus.DECLINED, respondedAt: new Date() },
    });
    if (updated.count === 1) {
      await notify({ userId: challenge.challengerId, actorId: userId, type: "CHALLENGE_DECLINED", title: `${actor.username} a décliné votre défi`, link: "/communaute?tab=defis" });
    }
    return { status: "DECLINED" as const, matchId: null };
  }

  await assertNotBlocked(userId, challenge.challengerId);
  await assertQuota(userId, challenge.mode);
  try {
    await assertCanStartGame(challenge.challengerId, challenge.mode, "challenge");
  } catch (error) {
    if (error instanceof QuotaReachedError) {
      throw new CommunityError("Votre ami a atteint sa limite de parties du jour : réessayez demain ou proposez un autre défi plus tard.", 409);
    }
    throw error;
  }
  if (challenge.mode === MatchMode.MONEY) {
    if (options.acceptMoney !== true) {
      throw new CommunityError("Ce défi engage des points argent : confirmez explicitement la mise pour l’accepter.", 400);
    }
    const rules = await getMoneyRules();
    if (!rules.enabled) throw new CommunityError("Le mode rémunéré est fermé : défi impossible à accepter.", 403);
    try {
      await assertCanQueueForMoney(userId, challenge.stakeAmount ?? 0);
      await assertCanQueueForMoney(challenge.challengerId, challenge.stakeAmount ?? 0);
    } catch (error) {
      if (error instanceof MoneyEligibilityError) throw new CommunityError(error.message, 403);
      throw error;
    }
  }

  const challengerIsWhite =
    challenge.challengerColor === "white" ? true : challenge.challengerColor === "black" ? false : Math.random() < 0.5;
  const [white, black] = challengerIsWhite ? [challenge.challengerId, userId] : [userId, challenge.challengerId];

  try {
    const matchId = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const claimed = await tx.friendChallenge.updateMany({
            where: { id: challengeId, status: FriendChallengeStatus.PENDING, expiresAt: { gt: new Date() } },
            data: { status: FriendChallengeStatus.ACCEPTED, respondedAt: new Date() },
          });
          if (claimed.count !== 1) throw new CommunityError("Ce défi n’est plus disponible.", 409);
          await assertPlayersFree(tx, [userId, challenge.challengerId], userId);
          const match = await tx.match.create({
            data: {
              playerWhiteId: white,
              playerBlackId: black,
              gameType: challenge.gameType,
              draughtsVariant: challenge.draughtsVariant,
              timeControlMinutes: challenge.timeControlMinutes,
              mode: challenge.mode,
              rated: challenge.mode === MatchMode.RATED,
              stakeAmount: challenge.mode === MatchMode.MONEY ? challenge.stakeAmount : null,
              status: MatchStatus.IN_PROGRESS,
              movesHistory: [],
            },
            select: { id: true },
          });
          if (challenge.mode === MatchMode.MONEY && challenge.stakeAmount) {
            await lockMoneyMatchStakes(tx, { matchId: match.id, playerIds: [white, black], stake: challenge.stakeAmount });
          }
          await tx.friendChallenge.update({ where: { id: challengeId }, data: { matchId: match.id } });
          return match.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
    await notify({
      userId: challenge.challengerId,
      actorId: userId,
      type: "CHALLENGE_ACCEPTED",
      title: `${actor.username} a accepté votre défi : la partie commence`,
      link: `/match/${matchId}`,
    });
    return { status: "ACCEPTED" as const, matchId };
  } catch (error) {
    if (error instanceof MoneyEligibilityError) throw new CommunityError(error.message, 403);
    throw error;
  }
}

export async function cancelChallenge(userId: string, challengeId: string) {
  const updated = await prisma.friendChallenge.updateMany({
    where: { id: challengeId, challengerId: userId, status: FriendChallengeStatus.PENDING },
    data: { status: FriendChallengeStatus.CANCELLED, respondedAt: new Date() },
  });
  if (updated.count === 0) throw new CommunityError("Défi introuvable ou déjà traité.", 404);
}

export async function listChallenges(userId: string) {
  await expireChallenges();
  await completeFinishedChallenges(userId);
  const rows = await prisma.friendChallenge.findMany({
    where: {
      OR: [{ challengerId: userId }, { challengedId: userId }],
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      challenger: { select: PLAYER_CARD_SELECT },
      challenged: { select: PLAYER_CARD_SELECT },
      match: { select: { status: true, winnerId: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    direction: c.challengerId === userId ? ("SENT" as const) : ("RECEIVED" as const),
    opponent: playerCard(c.challengerId === userId ? c.challenged : c.challenger),
    gameType: c.gameType,
    draughtsVariant: c.draughtsVariant,
    timeControlMinutes: c.timeControlMinutes,
    mode: c.mode,
    stakeAmount: c.stakeAmount,
    color: c.challengerColor,
    message: decodeFromDb(c.message),
    status: c.status,
    matchId: c.matchId,
    matchLive: c.match?.status === MatchStatus.IN_PROGRESS,
    result: c.match && c.match.status !== MatchStatus.IN_PROGRESS
      ? c.match.status === MatchStatus.ABORTED ? "ABORTED" : c.match.winnerId === null ? "DRAW" : c.match.winnerId === userId ? "WIN" : "LOSS"
      : null,
    expiresAt: c.expiresAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
  }));
}

/** Parties issues de défis jamais commencées : à annuler sans conséquence (appelé par le serveur de jeu). */
export async function staleChallengeMatchIds(olderThanMinutes = 10): Promise<string[]> {
  const rows = await prisma.friendChallenge.findMany({
    where: {
      status: FriendChallengeStatus.ACCEPTED,
      respondedAt: { lt: new Date(Date.now() - olderThanMinutes * 60_000) },
      match: { status: MatchStatus.IN_PROGRESS },
    },
    select: { matchId: true, match: { select: { movesHistory: true } } },
    take: 100,
  });
  return rows
    .filter((r) => r.matchId && Array.isArray(r.match?.movesHistory) && r.match.movesHistory.length === 0)
    .map((r) => r.matchId!);
}
