import { MatchStatus, Prisma } from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";

/**
 * Mesure d'audience interne, sobre et respectueuse :
 *  - liste fermée d'événements (aucune collecte libre) ;
 *  - ni adresse IP, ni agent utilisateur, ni empreinte : seulement la classe
 *    d'appareil (mobile/tablette/ordinateur) et le mode « application installée » ;
 *  - propriétés limitées à quelques clés courtes ;
 *  - purge automatique au-delà de la durée de conservation.
 * Les indicateurs de jeu (parties, tournois, amis, Premium) sont calculés
 * directement depuis les tables métier, sans événement supplémentaire.
 */

export const CLIENT_EVENTS = [
  "app_open", // première ouverture de la journée (actifs quotidiens/mensuels)
  "session_time", // durée de visite visible, envoyée à la fermeture
  "pwa_install_prompt_shown",
  "pwa_install_accepted",
  "pwa_install_dismissed",
  "pwa_installed",
  "pwa_ios_guide_shown",
  "prompt_shown",
  "prompt_clicked",
  "prompt_dismissed",
  "premium_view",
  "premium_cta_click",
  "premium_hint_shown",
  "premium_hint_click",
  "quota_reached",
  "objective_claimed",
  "update_applied",
] as const;

export type ClientEvent = (typeof CLIENT_EVENTS)[number];
const CLIENT_SET = new Set<string>(CLIENT_EVENTS);
const SERVER_EVENTS = new Set(["signup", "premium_activated"]);

export interface IncomingEvent {
  name: string;
  anonId?: unknown;
  device?: unknown;
  standalone?: unknown;
  experiment?: unknown;
  variant?: unknown;
  props?: unknown;
}

function cleanProps(value: unknown): Prisma.InputJsonValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(value).slice(0, 6)) {
    if (!/^[a-zA-Z_]{1,24}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.replace(/[^\w\-/.:]/g, "").slice(0, 60);
  }
  return Object.keys(out).length ? out : undefined;
}

const short = (v: unknown, pattern: RegExp, max: number) => (typeof v === "string" && pattern.test(v) ? v.slice(0, max) : null);

export async function analyticsEnabled() {
  return (await getSettings(["analytics.enabled"] as const))["analytics.enabled"];
}

export async function recordClientEvents(events: IncomingEvent[], userId: string | null) {
  if (!(await analyticsEnabled())) return 0;
  const rows = events
    .slice(0, 20)
    .filter((e) => typeof e?.name === "string" && CLIENT_SET.has(e.name))
    .map((e) => ({
      name: e.name,
      userId,
      anonId: short(e.anonId, /^[a-z0-9-]{8,40}$/, 40),
      device: short(e.device, /^(mobile|tablet|desktop)$/, 12),
      standalone: e.standalone === true,
      experiment: short(e.experiment, /^[a-z0-9_]{2,40}$/, 40),
      variant: short(e.variant, /^[A-Za-z0-9_]{1,16}$/, 16),
      props: cleanProps(e.props),
    }));
  if (rows.length) await prisma.analyticsEvent.createMany({ data: rows });
  return rows.length;
}

/** Événement émis par le serveur (inscription, activation Premium). Ne bloque jamais l'action. */
export async function trackServer(name: string, userId: string | null, props?: Record<string, string | number | boolean>) {
  if (!SERVER_EVENTS.has(name)) return;
  try {
    if (!(await analyticsEnabled())) return;
    await prisma.analyticsEvent.create({ data: { name, userId, props: cleanProps(props) } });
  } catch (error) {
    console.error("Mesure d'audience :", error);
  }
}

export async function purgeOldEvents() {
  const days = (await getSettings(["analytics.retentionDays"] as const))["analytics.retentionDays"];
  const { count } = await prisma.analyticsEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
  return count;
}

// ── Indicateurs ─────────────────────────────────────────────────────────

const DAY = 86_400_000;

async function distinctActive(since: Date, until = new Date()): Promise<number> {
  // Actif = a ouvert l'application (événement) OU joué une partie sur la période.
  const rows = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS n FROM (
      SELECT "userId" AS u FROM "AnalyticsEvent" WHERE "userId" IS NOT NULL AND "createdAt" >= ${since} AND "createdAt" < ${until}
      UNION
      SELECT "playerWhiteId" FROM "Match" WHERE "createdAt" >= ${since} AND "createdAt" < ${until} AND status <> 'ABORTED'
      UNION
      SELECT "playerBlackId" FROM "Match" WHERE "playerBlackId" IS NOT NULL AND "createdAt" >= ${since} AND "createdAt" < ${until} AND status <> 'ABORTED'
    ) t`);
  return Number(rows[0]?.n ?? 0);
}

async function eventCounts(since: Date) {
  const rows = await prisma.analyticsEvent.groupBy({ by: ["name"], where: { createdAt: { gte: since } }, _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.name, r._count._all])) as Record<string, number>;
}

export async function computeKpis(now = new Date()) {
  await purgeOldEvents().catch(() => 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const d7 = new Date(now.getTime() - 7 * DAY);
  const d30 = new Date(now.getTime() - 30 * DAY);

  const playedWhere = (since: Date): Prisma.MatchWhereInput => ({ createdAt: { gte: since }, status: { in: [MatchStatus.FINISHED, MatchStatus.ABANDONED] } });

  const [
    signups7, signups30, totalUsers, dau, wau, mau,
    games30, aborted30, resigned30,
    tournamentJoins30, friendships, premiumActive, premiumActivated30, premiumExpired30,
    events30, sessionAgg, standaloneOpens, opens30,
  ] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: d7 } } }),
    prisma.user.count({ where: { createdAt: { gte: d30 } } }),
    prisma.user.count(),
    distinctActive(today),
    distinctActive(d7),
    distinctActive(d30),
    prisma.match.count({ where: playedWhere(d30) }),
    prisma.match.count({ where: { createdAt: { gte: d30 }, status: MatchStatus.ABORTED } }),
    prisma.match.count({ where: { ...playedWhere(d30), status: MatchStatus.ABANDONED } }),
    prisma.tournamentParticipant.count({ where: { joinedAt: { gte: d30 } } }),
    prisma.friendship.count({ where: { status: "ACCEPTED" } }),
    prisma.user.count({ where: { isPremium: true, OR: [{ premiumExpiresAt: null }, { premiumExpiresAt: { gt: now } }], isAdmin: false } }),
    prisma.analyticsEvent.count({ where: { name: "premium_activated", createdAt: { gte: d30 } } }),
    prisma.user.count({ where: { isPremium: true, premiumExpiresAt: { gte: d30, lte: now }, isAdmin: false } }),
    eventCounts(d30),
    prisma.analyticsEvent.aggregate({ where: { name: "session_time", createdAt: { gte: d30 } }, _count: { _all: true } }),
    prisma.analyticsEvent.count({ where: { name: "app_open", standalone: true, createdAt: { gte: d30 } } }),
    prisma.analyticsEvent.count({ where: { name: "app_open", createdAt: { gte: d30 } } }),
  ]);

  const sessionSeconds = await prisma.$queryRaw<{ avg: number | null }[]>(Prisma.sql`
    SELECT AVG(("props"->>'seconds')::numeric)::float AS avg FROM "AnalyticsEvent"
    WHERE name = 'session_time' AND "createdAt" >= ${d30} AND "props" ? 'seconds'`);

  // Rétention J+7 : inscrits il y a 8 à 14 jours, revenus entre J+1 et J+7.
  const cohortStart = new Date(now.getTime() - 14 * DAY);
  const cohortEnd = new Date(now.getTime() - 8 * DAY);
  const retention = await prisma.$queryRaw<{ cohort: bigint; returned: bigint }[]>(Prisma.sql`
    WITH c AS (SELECT id, "createdAt" FROM "User" WHERE "createdAt" >= ${cohortStart} AND "createdAt" < ${cohortEnd})
    SELECT (SELECT COUNT(*) FROM c)::bigint AS cohort,
      (SELECT COUNT(*) FROM c WHERE EXISTS (
         SELECT 1 FROM "AnalyticsEvent" e WHERE e."userId" = c.id AND e."createdAt" >= c."createdAt" + interval '1 day' AND e."createdAt" < c."createdAt" + interval '8 days'
       ) OR EXISTS (
         SELECT 1 FROM "Match" m WHERE (m."playerWhiteId" = c.id OR m."playerBlackId" = c.id) AND m.status <> 'ABORTED'
           AND m."createdAt" >= c."createdAt" + interval '1 day' AND m."createdAt" < c."createdAt" + interval '8 days'
       ))::bigint AS returned`);

  const experiments = await prisma.analyticsEvent.groupBy({
    by: ["experiment", "variant", "name"],
    where: { experiment: { not: null }, createdAt: { gte: d30 } },
    _count: { _all: true },
  });

  const cohort = Number(retention[0]?.cohort ?? 0);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  return {
    generatedAt: now.toISOString(),
    users: { total: totalUsers, signups7, signups30, dau, wau, mau, stickiness: pct(dau, mau) },
    retention: { cohort, returnedD7: Number(retention[0]?.returned ?? 0), rateD7: pct(Number(retention[0]?.returned ?? 0), cohort) },
    games: {
      played30: games30,
      perActiveUser30: mau > 0 ? Math.round((games30 * 2 * 10) / mau) / 10 : null,
      abortedRate30: pct(aborted30, games30 + aborted30),
      resignedRate30: pct(resigned30, games30),
    },
    engagement: {
      tournamentJoins30,
      friendsPerUser: totalUsers > 0 ? Math.round(((friendships * 2) / totalUsers) * 10) / 10 : 0,
      avgSessionSeconds: sessionSeconds[0]?.avg ? Math.round(sessionSeconds[0].avg) : null,
      sessionsMeasured: sessionAgg._count._all,
    },
    premium: {
      active: premiumActive,
      activated30: premiumActivated30,
      conversionRate30: pct(premiumActivated30, mau),
      expiredNotRenewed30: premiumExpired30,
      pageViews30: events30.premium_view ?? 0,
      ctaClicks30: events30.premium_cta_click ?? 0,
    },
    pwa: {
      promptsShown30: (events30.pwa_install_prompt_shown ?? 0) + (events30.pwa_ios_guide_shown ?? 0),
      accepted30: events30.pwa_install_accepted ?? 0,
      installed30: events30.pwa_installed ?? 0,
      standaloneShare30: pct(standaloneOpens, opens30),
    },
    featureUsage30: events30,
    experiments: experiments.map((e) => ({ experiment: e.experiment, variant: e.variant, event: e.name, count: e._count._all })),
  };
}
