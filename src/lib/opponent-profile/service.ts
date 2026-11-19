import { MatchStatus } from "@/generated/prisma-client";
import { relationshipBetween } from "@/lib/community/friends";
import { readPrivacy } from "@/lib/community/profile";
import { getPrivileges, type PremiumSubject } from "@/lib/premium/privileges";
import { prisma } from "@/lib/prisma";
import { loadRatingSettings } from "@/lib/rating/load-config";
import { CADENCE_LABELS, VARIANT_LABELS, cadenceOf, ratingVariantOf, type Cadence, type RatingVariant } from "@/lib/rating/pools";
import { outcomeFor, streaks, summarizeTournaments, tally, type Participation } from "./compute";

/**
 * Profil de l'adversaire consulté depuis la salle de jeu.
 *
 * Règles (appliquées ici, côté serveur) :
 * - seul un joueur de la partie peut consulter le profil de l'autre joueur ;
 * - informations obligatoires : pour tous, sous réserve des réglages
 *   « Ma ville et mon pays » (showLocation) et « Mes classements ELO et mes points » (showRatings) ;
 * - statistiques avancées : privilège Premium `advancedStats` du lecteur ET
 *   autorisation de l'adversaire, section par section. Le Premium ne contourne
 *   jamais la confidentialité : une section refusée n'est pas calculée ni envoyée ;
 * - aucun montant financier n'est exposé (seulement « récompensé » oui/non).
 */

export class OpponentProfileError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const PLAYED = [MatchStatus.FINISHED, MatchStatus.ABANDONED];
type Viewer = PremiumSubject & { id: string };
type Hidden = { hidden: true };
const HIDDEN: Hidden = { hidden: true };

function poolLabel(variant: string, cadence: string | null) {
  const v = VARIANT_LABELS[variant as RatingVariant] ?? variant;
  return cadence ? `${v} · ${CADENCE_LABELS[cadence as Cadence] ?? cadence}` : v;
}

export async function getOpponentProfile(matchId: string, viewer: Viewer) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { playerWhiteId: true, playerBlackId: true, gameType: true, draughtsVariant: true, timeControlMinutes: true },
  });
  if (!match || (match.playerWhiteId !== viewer.id && match.playerBlackId !== viewer.id)) {
    throw new OpponentProfileError("Vous ne participez pas à cette partie.", 404);
  }
  const opponentId = match.playerWhiteId === viewer.id ? match.playerBlackId : match.playerWhiteId;
  if (!opponentId) throw new OpponentProfileError("Adversaire introuvable.", 404);

  const [opponent, relationship, ratingSettings, { privileges }] = await Promise.all([
    prisma.user.findUnique({
      where: { id: opponentId },
      select: {
        id: true, username: true, avatar: true, country: true, city: true, pointsFree: true, createdAt: true,
        privacySettings: true,
        playerRatings: { select: { variant: true, timeControl: true, eloRating: true, gamesPlayed: true } },
      },
    }),
    relationshipBetween(viewer.id, opponentId),
    loadRatingSettings(),
    getPrivileges(viewer),
  ]);
  if (!opponent) throw new OpponentProfileError("Adversaire introuvable.", 404);

  const privacy = readPrivacy(opponent.privacySettings);
  // Un joueur qui a bloqué le lecteur ne partage rien au-delà de ce que la salle affiche déjà.
  const blockedMe = relationship.status === "BLOCKED_ME";
  const allow = (flag: boolean) => flag && !blockedMe;

  // ── Section 1 : informations obligatoires ──
  const contextVariant = ratingVariantOf(match.gameType, match.draughtsVariant);
  const contextCadence = cadenceOf(match.timeControlMinutes, ratingSettings.cadences);
  const ratings = opponent.playerRatings;
  const mainPool = (variants: string[], prefer?: string) =>
    ratings
      .filter((r) => variants.includes(r.variant) && r.gamesPlayed > 0)
      .sort((a, b) => Number(b.variant === prefer) - Number(a.variant === prefer) || b.gamesPlayed - a.gamesPlayed)[0] ?? null;
  const asRating = (r: (typeof ratings)[number] | null) =>
    r ? { label: poolLabel(r.variant, r.timeControl), rating: r.eloRating, games: r.gamesPlayed } : null;
  const contextPool = ratings.find((r) => r.variant === contextVariant && r.timeControl === contextCadence) ?? null;

  const level = allow(privacy.showRatings)
    ? {
        points: Math.round(opponent.pointsFree),
        context: {
          label: poolLabel(contextVariant, contextCadence),
          // Classement de la catégorie de cette partie ; null tant qu'aucune partie classée n'y a été jouée.
          rating: contextPool && contextPool.gamesPlayed > 0 ? contextPool.eloRating : null,
          games: contextPool?.gamesPlayed ?? 0,
        },
        draughts: asRating(mainPool(["INTERNATIONAL", "ENGLISH"], match.gameType === "CHECKERS" ? contextVariant : undefined)),
        chess: asRating(mainPool(["CHESS"])),
      }
    : HIDDEN;

  const header = {
    username: opponent.username,
    avatar: opponent.avatar,
    memberSince: opponent.createdAt.toISOString(),
    location: allow(privacy.showLocation) ? { country: opponent.country, city: opponent.city } : HIDDEN,
    level,
    discipline: match.gameType,
  };

  // ── Section 2 : statistiques avancées (Premium) ──
  if (!privileges.advancedStats) {
    return { ...header, advanced: { locked: "PREMIUM" as const } };
  }
  const canStats = allow(privacy.showStats && privacy.showAdvancedStats);
  const canOpponents = allow(privacy.showStats && privacy.showRecentOpponents);
  const canTournaments = allow(privacy.showTournaments);
  const [general, recentOpponents, tournaments] = await Promise.all([
    canStats ? generalStats(opponent.id, ratings) : HIDDEN,
    canOpponents ? lastOpponents(opponent.id) : HIDDEN,
    canTournaments ? tournamentStats(opponent.id) : HIDDEN,
  ]);
  return {
    ...header,
    advanced: {
      locked: null,
      general,
      recentOpponents,
      tournaments: "hidden" in tournaments ? HIDDEN : tournaments.points,
      paidCompetitions: "hidden" in tournaments ? HIDDEN : tournaments.paid,
    },
  };
}

async function generalStats(
  userId: string,
  ratings: { variant: string; timeControl: string | null; eloRating: number; gamesPlayed: number }[],
) {
  const [games, best] = await Promise.all([
    prisma.match.findMany({
      where: { status: { in: PLAYED }, OR: [{ playerWhiteId: userId }, { playerBlackId: userId }] },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { gameType: true, winnerId: true },
    }),
    prisma.ratingHistory.groupBy({
      by: ["variant", "timeControl"],
      where: { userId },
      _max: { newRating: true, oldRating: true },
    }),
  ]);
  const all = games.map((g) => outcomeFor(userId, g.winnerId));
  const of = (type: "CHESS" | "CHECKERS") => games.filter((g) => g.gameType === type).map((g) => outcomeFor(userId, g.winnerId));
  const pools = ratings
    .filter((r) => r.gamesPlayed > 0)
    .map((r) => {
      const h = best.find((b) => b.variant === r.variant && b.timeControl === r.timeControl);
      return {
        label: poolLabel(r.variant, r.timeControl),
        discipline: r.variant === "CHESS" ? ("CHESS" as const) : ("CHECKERS" as const),
        current: r.eloRating,
        best: Math.max(r.eloRating, h?._max.newRating ?? 0, h?._max.oldRating ?? 0),
        games: r.gamesPlayed,
      };
    })
    .sort((a, b) => b.games - a.games);
  return {
    overall: { ...tally(all), ...streaks(all) },
    CHECKERS: { ...tally(of("CHECKERS")), ...streaks(of("CHECKERS")) },
    CHESS: { ...tally(of("CHESS")), ...streaks(of("CHESS")) },
    pools,
  };
}

async function lastOpponents(userId: string) {
  const rows = await prisma.match.findMany({
    where: { status: { in: PLAYED }, OR: [{ playerWhiteId: userId }, { playerBlackId: userId }] },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 5,
    select: {
      gameType: true, draughtsVariant: true, mode: true, updatedAt: true, winnerId: true, playerWhiteId: true,
      eloDeltaWhite: true, eloDeltaBlack: true,
      playerWhite: { select: { username: true, avatar: true } },
      playerBlack: { select: { username: true, avatar: true } },
      resultRecord: { select: { whitePointsChange: true, blackPointsChange: true, settledAt: true, createdAt: true } },
    },
  });
  return rows.map((m) => {
    const white = m.playerWhiteId === userId;
    const other = white ? m.playerBlack : m.playerWhite;
    return {
      opponent: other ? { username: other.username, avatar: other.avatar } : null,
      date: (m.resultRecord?.settledAt ?? m.resultRecord?.createdAt ?? m.updatedAt).toISOString(),
      gameType: m.gameType,
      draughtsVariant: m.draughtsVariant,
      mode: m.mode,
      result: outcomeFor(userId, m.winnerId),
      // Points classiques réellement réglés pour cette partie (MatchResult) ; null si aucun règlement.
      pointsChange: m.resultRecord ? (white ? m.resultRecord.whitePointsChange : m.resultRecord.blackPointsChange) : null,
      // ELO : classement distinct, affiché à part.
      eloChange: white ? m.eloDeltaWhite : m.eloDeltaBlack,
    };
  });
}

async function tournamentStats(userId: string) {
  const [entries, prizes] = await Promise.all([
    prisma.tournamentParticipant.findMany({
      where: { userId },
      select: {
        placement: true,
        tournament: {
          select: {
            id: true, name: true, type: true, gameType: true, draughtsVariant: true, status: true, isPaid: true,
            entryFee: true, createdAt: true, startedAt: true, finishedAt: true,
            _count: { select: { participants: true } },
          },
        },
      },
    }),
    // Prix en argent : sert uniquement à savoir si le joueur a été récompensé (montant jamais renvoyé).
    prisma.balanceTransaction.findMany({
      where: { userId, transactionType: "TOURNAMENT_PRIZE" },
      select: { referenceId: true, amount: true },
    }),
  ]);
  const rewardedIn = (t: (typeof entries)[number]["tournament"]) =>
    prizes.some((p) =>
      p.referenceId === `survival:${t.id}`
        ? p.amount.gt(t.entryFee) // Survival : restitution du capital ; récompensé seulement en cas de gain.
        : p.referenceId.startsWith(`${t.id}:`),
    );
  const toParticipation = ({ placement, tournament: t }: (typeof entries)[number]): Participation => ({
    tournamentId: t.id,
    name: t.name,
    date: t.finishedAt ?? t.startedAt ?? t.createdAt,
    type: t.type,
    gameType: t.gameType,
    draughtsVariant: t.gameType === "CHECKERS" ? t.draughtsVariant : null,
    status: t.status,
    placement,
    participants: t._count.participants,
    rewarded: t.isPaid && rewardedIn(t),
  });
  return {
    // Jamais de mélange : un tournoi à points n'apparaît pas dans les compétitions rémunérées.
    points: summarizeTournaments(entries.filter((e) => !e.tournament.isPaid).map(toParticipation)),
    paid: summarizeTournaments(entries.filter((e) => e.tournament.isPaid).map(toParticipation)),
  };
}

export type OpponentProfile = Awaited<ReturnType<typeof getOpponentProfile>>;
