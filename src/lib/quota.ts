import { MatchMode, MatchStatus, type Prisma } from "@/generated/prisma-client";
import { getPrivilegesForUserId } from "@/lib/premium/privileges";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";

/**
 * Quota quotidien de parties en ligne de l'offre gratuite.
 *
 * Règles (toutes déduites de la table Match : aucun compteur séparé qui
 * pourrait se désynchroniser) :
 *  - comptent les parties en ligne amicales et classées réellement commencées
 *    (en cours, terminées ou abandonnées) créées depuis minuit (heure du
 *    serveur, comme le plafond de gain quotidien des points classiques) ;
 *  - ne comptent jamais : les parties annulées avant le seuil d'annulation
 *    (ABORTED), les parties de tournoi, les rencontres interclubs, les parties
 *    rémunérées (déjà encadrées par leurs propres limites) ni l'entraînement
 *    contre l'IA ;
 *  - un abandon, une défaite au temps ou une déconnexion comptent comme une
 *    partie jouée (la partie a eu lieu) ;
 *  - le quota n'est vérifié qu'au lancement d'une nouvelle partie : une partie
 *    commencée n'est jamais interrompue, même si minuit passe ou si le quota
 *    est atteint pendant qu'elle se joue ;
 *  - les nouveaux comptes jouent sans limite pendant la période de découverte ;
 *  - tout niveau Premium avec le privilège « parties illimitées » est exempté.
 */

export interface QuotaStatus {
  /** false : aucune limite pour ce joueur (quota désactivé, Premium, découverte, admin). */
  limited: boolean;
  limit: number;
  used: number;
  remaining: number;
  /** Prochaine remise à zéro (ISO). */
  resetsAt: string;
  /** Raison de l'absence de limite, pour l'affichage. */
  exemptReason: "disabled" | "premium" | "discovery" | null;
  /** Fin de la période de découverte (ISO) si elle est en cours. */
  discoveryEndsAt: string | null;
}

export class QuotaReachedError extends Error {
  readonly code = "QUOTA_REACHED";
  constructor(readonly status: QuotaStatus) {
    super(
      `Vous avez joué vos ${status.limit} parties gratuites du jour. Le compteur repart à zéro à minuit. ` +
        "Les tournois, l'entraînement contre l'IA et vos parties en cours restent accessibles.",
    );
    this.name = "QuotaReachedError";
  }
}

export function startOfDay(now = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

function nextReset(now = new Date()): Date {
  const next = startOfDay(now);
  next.setDate(next.getDate() + 1);
  return next;
}

/** Filtre Prisma des parties qui consomment le quota. */
export function quotaMatchWhere(userId: string, since: Date, countFriendChallenges = true): Prisma.MatchWhereInput {
  return {
    ...(countFriendChallenges ? {} : { friendChallenge: { is: null } }),
    OR: [{ playerWhiteId: userId }, { playerBlackId: userId }],
    createdAt: { gte: since },
    status: { in: [MatchStatus.IN_PROGRESS, MatchStatus.FINISHED, MatchStatus.ABANDONED] },
    mode: { in: [MatchMode.CASUAL, MatchMode.RATED] },
    tournamentMatchId: null,
    clubMatchBoard: { is: null },
  };
}

export async function getQuotaStatus(userId: string, now = new Date()): Promise<QuotaStatus> {
  const settings = await getSettings([
    "freePlan.dailyGamesEnabled",
    "freePlan.dailyGames",
    "freePlan.newPlayerGraceDays",
    "freePlan.countFriendChallenges",
  ] as const);
  const resetsAt = nextReset(now).toISOString();
  const limit = settings["freePlan.dailyGames"];
  const base = { limit, resetsAt, discoveryEndsAt: null as string | null };
  const unlimited = (exemptReason: QuotaStatus["exemptReason"], used = 0, discoveryEndsAt: string | null = null): QuotaStatus => ({
    ...base,
    limited: false,
    used,
    remaining: Number.POSITIVE_INFINITY,
    exemptReason,
    discoveryEndsAt,
  });

  if (!settings["freePlan.dailyGamesEnabled"]) return unlimited("disabled");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  if (!user) return unlimited("disabled");
  const privileges = await getPrivilegesForUserId(userId);
  if (privileges?.privileges.unlimitedGames) return unlimited("premium");

  const used = await prisma.match.count({ where: quotaMatchWhere(userId, startOfDay(now), settings["freePlan.countFriendChallenges"]) });
  const graceDays = settings["freePlan.newPlayerGraceDays"];
  if (graceDays > 0) {
    const ends = new Date(user.createdAt.getTime() + graceDays * 86_400_000);
    if (ends > now) return unlimited("discovery", used, ends.toISOString());
  }
  return { ...base, limited: true, used, remaining: Math.max(0, limit - used), exemptReason: null };
}

/** À appeler avant de créer une nouvelle partie amicale ou classée. */
export async function assertCanStartGame(
  userId: string,
  mode: string,
  origin: "queue" | "challenge" | "rematch" = "queue",
): Promise<void> {
  if (mode !== "CASUAL" && mode !== "RATED") return;
  if (origin === "challenge" && !(await getSettings(["freePlan.countFriendChallenges"] as const))["freePlan.countFriendChallenges"]) return;
  const status = await getQuotaStatus(userId);
  if (status.limited && status.remaining <= 0) throw new QuotaReachedError(status);
}

/** Sérialisation JSON (Infinity n'est pas représentable). */
export function serializeQuota(status: QuotaStatus) {
  return { ...status, remaining: Number.isFinite(status.remaining) ? status.remaining : null };
}
