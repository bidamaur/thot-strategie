import { BalanceTransactionType, BalanceType, FriendshipStatus, MatchStatus, Prisma } from "@/generated/prisma-client";
import { getPrivilegesForUserId } from "@/lib/premium/privileges";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";
import { assignVariant, type CampaignDef, type ObjectiveDef, type ObjectiveMetric } from "./definitions";

/**
 * Fidélisation : objectifs, séries, premiers pas et choix de LA sollicitation
 * à afficher. Toutes les valeurs sont recalculées depuis les données de jeu :
 * rien n'est déclaré par le navigateur, sauf l'installation de l'application.
 */

export class EngagementError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "EngagementError";
  }
}

// ── Périodes ────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function periodBounds(period: "daily" | "weekly", now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "weekly") start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // lundi
  const end = new Date(start);
  end.setDate(end.getDate() + (period === "weekly" ? 7 : 1));
  return { start, end, key: `${period === "weekly" ? "W" : "D"}${dayKey(start)}` };
}

// ── Objectifs ───────────────────────────────────────────────────────────

const PLAYED = [MatchStatus.FINISHED, MatchStatus.ABANDONED];

function participant(userId: string): Prisma.MatchWhereInput {
  return { OR: [{ playerWhiteId: userId }, { playerBlackId: userId }] };
}

async function measure(userId: string, metric: ObjectiveMetric, since: Date): Promise<number> {
  const played: Prisma.MatchWhereInput = { ...participant(userId), status: { in: PLAYED }, createdAt: { gte: since } };
  switch (metric) {
    case "games_played":
      return prisma.match.count({ where: played });
    case "games_won":
      return prisma.match.count({ where: { ...played, winnerId: userId } });
    case "rated_games":
      return prisma.match.count({ where: { ...played, mode: "RATED" } });
    case "tournament_games":
      return prisma.match.count({ where: { ...played, tournamentMatchId: { not: null } } });
    case "friend_games":
      return prisma.match.count({ where: { ...played, friendChallenge: { isNot: null } } });
    case "community_posts":
      return prisma.communityPost.count({ where: { authorId: userId, isHidden: false, createdAt: { gte: since } } });
  }
}

export interface ObjectiveView {
  id: string;
  period: "daily" | "weekly";
  label: string;
  target: number;
  progress: number;
  rewardPoints: number;
  completed: boolean;
  claimed: boolean;
  endsAt: string;
}

const claimRef = (objective: ObjectiveDef, key: string) => `objective:${objective.id}:${key}`;

export async function getObjectives(userId: string, now = new Date()): Promise<ObjectiveView[]> {
  const s = await getSettings(["engagement.objectivesEnabled", "engagement.objectives", "engagement.objectiveRewardsEnabled", "points.classic.enabled"] as const);
  if (!s["engagement.objectivesEnabled"]) return [];
  const rewards = s["engagement.objectiveRewardsEnabled"] && s["points.classic.enabled"];
  const objectives = s["engagement.objectives"].filter((o) => o.enabled);
  const bounds = { daily: periodBounds("daily", now), weekly: periodBounds("weekly", now) };
  const claimed = new Set(
    (
      await prisma.balanceTransaction.findMany({
        where: {
          userId,
          transactionType: BalanceTransactionType.OBJECTIVE_REWARD,
          referenceId: { in: objectives.map((o) => claimRef(o, bounds[o.period].key)) },
        },
        select: { referenceId: true },
      })
    ).map((t) => t.referenceId),
  );
  // Une seule requête par couple (mesure, période).
  const cache = new Map<string, Promise<number>>();
  const views = await Promise.all(
    objectives.map(async (o) => {
      const b = bounds[o.period];
      const cacheKey = `${o.metric}:${o.period}`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, measure(userId, o.metric, b.start));
      const progress = await cache.get(cacheKey)!;
      return {
        id: o.id,
        period: o.period,
        label: o.label,
        target: o.target,
        progress: Math.min(progress, o.target),
        rewardPoints: rewards ? o.rewardPoints : 0,
        completed: progress >= o.target,
        claimed: claimed.has(claimRef(o, b.key)),
        endsAt: b.end.toISOString(),
      } satisfies ObjectiveView;
    }),
  );
  return views;
}

/**
 * Réclame la récompense d'un objectif accompli. Idempotent grâce à la
 * contrainte unique (joueur, type, référence) des mouvements de points :
 * deux clics simultanés ne créditent qu'une fois. Points classiques uniquement.
 */
export async function claimObjective(userId: string, objectiveId: string, now = new Date()) {
  const s = await getSettings(["engagement.objectivesEnabled", "engagement.objectives", "engagement.objectiveRewardsEnabled", "points.classic.enabled"] as const);
  if (!s["engagement.objectivesEnabled"]) throw new EngagementError("Les objectifs sont désactivés.", 403);
  const objective = s["engagement.objectives"].find((o) => o.id === objectiveId && o.enabled);
  if (!objective) throw new EngagementError("Objectif introuvable.", 404);
  const { start, key } = periodBounds(objective.period, now);
  const progress = await measure(userId, objective.metric, start);
  if (progress < objective.target) throw new EngagementError("Objectif pas encore atteint.", 409);
  const amount = s["engagement.objectiveRewardsEnabled"] && s["points.classic.enabled"] ? objective.rewardPoints : 0;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.balanceTransaction.create({
        data: {
          userId,
          balanceType: BalanceType.FREE_POINTS,
          transactionType: BalanceTransactionType.OBJECTIVE_REWARD,
          amount: new Prisma.Decimal(amount),
          referenceId: claimRef(objective, key),
          description: `Objectif accompli : ${objective.label}`.slice(0, 190),
        },
      });
      if (amount > 0) await tx.user.update({ where: { id: userId }, data: { pointsFree: { increment: amount } } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new EngagementError("Récompense déjà reçue.", 409);
    }
    throw error;
  }
  return { rewardPoints: amount };
}

// ── Séries ──────────────────────────────────────────────────────────────

export async function getStreaks(userId: string, now = new Date()) {
  const since = new Date(now.getTime() - 60 * 86_400_000);
  const recent = await prisma.match.findMany({
    where: { ...participant(userId), status: { in: PLAYED }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, winnerId: true },
    take: 500,
  });
  const days = new Set(recent.map((m) => dayKey(m.createdAt)));
  const cursor = new Date(now);
  // La série reste vivante aujourd'hui tant que le joueur a joué hier.
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let playDays = 0;
  while (days.has(dayKey(cursor))) {
    playDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  let wins = 0;
  for (const m of recent) {
    if (m.winnerId !== userId) break;
    wins += 1;
  }
  return { playDays, playedToday: days.has(dayKey(now)), winStreak: wins };
}

// ── Premiers pas ────────────────────────────────────────────────────────

export interface EngagementState {
  onboardingDismissedAt?: string;
  lastModalAt?: string;
  prompts?: Record<string, { shows?: number; lastShownAt?: string; dismissedAt?: string; dismissals?: number; clickedAt?: string; installedAt?: string }>;
}

export function readState(value: unknown): EngagementState {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as EngagementState) : {};
}

export async function getOnboarding(userId: string, state: EngagementState, createdAt: Date) {
  const enabled = (await getSettings(["engagement.onboardingEnabled"] as const))["engagement.onboardingEnabled"];
  if (!enabled || state.onboardingDismissedAt) return null;
  const [user, games, friends, tournaments, clubs] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { avatar: true, city: true, country: true } }),
    prisma.match.count({ where: { ...participant(userId), status: { in: PLAYED } } }),
    prisma.friendship.count({ where: { status: FriendshipStatus.ACCEPTED, OR: [{ requesterId: userId }, { addresseeId: userId }] } }),
    prisma.tournamentParticipant.count({ where: { userId } }),
    prisma.clubMember.count({ where: { userId } }),
  ]);
  const steps = [
    { id: "first_game", label: "Jouer votre première partie en ligne", href: "/match/en-ligne", done: games > 0 },
    { id: "profile", label: "Compléter votre profil (avatar, ville)", href: "/?profil=1", done: Boolean(user?.avatar || user?.city || user?.country) },
    { id: "friend", label: "Ajouter un ami", href: "/communaute?tab=amis", done: friends > 0 },
    { id: "tournament", label: "Rejoindre un tournoi", href: "/tournois", done: tournaments > 0 },
    { id: "club", label: "Rejoindre un club", href: "/clubs", done: clubs > 0 },
    { id: "install", label: "Installer l'application", href: "#installer", done: Boolean(state.prompts?.pwa_install?.installedAt) },
  ];
  const done = steps.filter((s) => s.done).length;
  // Les anciens joueurs ne voient pas le parcours ; il disparaît une fois terminé.
  const ageDays = (Date.now() - createdAt.getTime()) / 86_400_000;
  if (done === steps.length || (ageDays > 30 && games > 20)) return null;
  return { steps, done, total: steps.length };
}

// ── Sollicitations : une seule à la fois ────────────────────────────────

export interface PromptView {
  id: string;
  kind: "modal" | "banner";
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  variant: string | null;
}

/** Parties (en ligne, IA, recherche) et administration : aucune sollicitation, jamais. */
export function isQuietPath(path: string): boolean {
  // Toute la section /match (recherche, entraînement IA, salle de jeu) : le joueur joue ou va jouer.
  return path === "/match" || path.startsWith("/match/") || path.startsWith("/admin");
}

function pageMatches(campaign: CampaignDef, path: string) {
  const pages = campaign.pages.length ? campaign.pages : ["/"];
  return pages.some((p) => (p === "/" ? path === "/" || path === "/dashboard" : path === p || path.startsWith(`${p}/`)));
}

export async function nextPrompt(
  user: { id: string; createdAt: Date; engagement: unknown },
  path: string,
  now = new Date(),
): Promise<PromptView | null> {
  if (isQuietPath(path)) return null;
  const s = await getSettings(["engagement.promptsEnabled", "engagement.promptMinIntervalHours", "engagement.campaigns"] as const);
  if (!s["engagement.promptsEnabled"]) return null;
  const state = readState(user.engagement);
  const prompts = state.prompts ?? {};
  const modalAllowed =
    !state.lastModalAt || now.getTime() - Date.parse(state.lastModalAt) >= s["engagement.promptMinIntervalHours"] * 3_600_000;
  const ageHours = (now.getTime() - user.createdAt.getTime()) / 3_600_000;

  // 1. Bienvenue : une seule fois, dans les 3 jours suivant l'inscription.
  if (!prompts.welcome?.shows && !prompts.welcome?.dismissedAt && ageHours < 72 && (path === "/" || path === "/dashboard")) {
    return {
      id: "welcome",
      kind: "modal",
      title: "Bienvenue sur Thot Stratégie",
      body: "Dames et échecs en ligne, tournois gratuits, clubs et classements. Commencez par une partie : l'adversaire est trouvé en quelques secondes.",
      ctaLabel: "Jouer maintenant",
      ctaHref: "/match/en-ligne",
      variant: null,
    };
  }

  // 2. Campagnes administrables.
  const privileges = await getPrivilegesForUserId(user.id);
  const premium = (privileges?.level ?? 0) > 0;
  for (const c of s["engagement.campaigns"]) {
    if (!c.enabled || !pageMatches(c, path)) continue;
    if (c.startsAt && Date.parse(c.startsAt) > now.getTime()) continue;
    if (c.endsAt && Date.parse(c.endsAt) < now.getTime()) continue;
    if (c.audience === "free" && premium) continue;
    if (c.audience === "premium" && !premium) continue;
    if (c.audience === "new" && ageHours > 14 * 24) continue;
    const st = prompts[c.id] ?? {};
    if (st.dismissedAt || st.clickedAt) continue; // un refus est respecté
    if ((st.shows ?? 0) >= c.maxShows) continue;
    if (st.lastShownAt && now.getTime() - Date.parse(st.lastShownAt) < c.cooldownDays * 86_400_000) continue;
    if (c.kind === "modal" && !modalAllowed) continue;
    const variant = c.variantB ? assignVariant(user.id, c.id, ["A", "B"]) : null;
    const copy = variant === "B" && c.variantB ? { ...c, ...c.variantB, ctaLabel: c.variantB.ctaLabel || c.ctaLabel } : c;
    return { id: c.id, kind: c.kind, title: copy.title, body: copy.body, ctaLabel: copy.ctaLabel, ctaHref: c.ctaHref, variant };
  }
  return null;
}

const KNOWN_PROMPTS = new Set(["welcome", "pwa_install"]);

export async function recordPrompt(userId: string, id: string, action: "shown" | "dismissed" | "clicked" | "installed", kind?: "modal" | "banner") {
  if (!/^[a-z0-9_]{2,40}$/.test(id)) throw new EngagementError("Sollicitation inconnue.");
  if (!KNOWN_PROMPTS.has(id)) {
    const campaigns = (await getSettings(["engagement.campaigns"] as const))["engagement.campaigns"];
    if (!campaigns.some((c) => c.id === id)) throw new EngagementError("Sollicitation inconnue.");
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { engagement: true } });
  if (!user) throw new EngagementError("Joueur introuvable.", 404);
  const state = readState(user.engagement);
  const now = new Date().toISOString();
  const entry = { ...(state.prompts?.[id] ?? {}) };
  if (action === "shown") {
    entry.shows = (entry.shows ?? 0) + 1;
    entry.lastShownAt = now;
  } else if (action === "dismissed") {
    entry.dismissedAt = now;
    entry.dismissals = (entry.dismissals ?? 0) + 1;
  } else if (action === "clicked") {
    entry.clickedAt = now;
  } else {
    entry.installedAt = now;
  }
  const next: EngagementState = {
    ...state,
    prompts: { ...(state.prompts ?? {}), [id]: entry },
    ...(action === "shown" && kind === "modal" ? { lastModalAt: now } : {}),
  };
  await prisma.user.update({ where: { id: userId }, data: { engagement: next as Prisma.InputJsonValue } });
  return next;
}

export async function dismissOnboarding(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { engagement: true } });
  if (!user) throw new EngagementError("Joueur introuvable.", 404);
  const next = { ...readState(user.engagement), onboardingDismissedAt: new Date().toISOString() };
  await prisma.user.update({ where: { id: userId }, data: { engagement: next as Prisma.InputJsonValue } });
}
