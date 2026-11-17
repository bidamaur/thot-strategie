/**
 * Définitions administrables de l'engagement (objectifs, campagnes, tests A/B).
 * Fichier sans dépendance serveur : importé par le registre des paramètres.
 */

export const OBJECTIVE_METRICS = {
  games_played: "Parties en ligne jouées",
  games_won: "Parties en ligne gagnées",
  rated_games: "Parties classées jouées",
  tournament_games: "Parties de tournoi jouées",
  community_posts: "Publications dans la communauté",
  friend_games: "Défis joués contre un ami",
} as const;

export type ObjectiveMetric = keyof typeof OBJECTIVE_METRICS;

export interface ObjectiveDef {
  id: string;
  period: "daily" | "weekly";
  metric: ObjectiveMetric;
  target: number;
  /** Récompense en points classiques uniquement (jamais ELO ni points argent). */
  rewardPoints: number;
  label: string;
  enabled: boolean;
}

export const DEFAULT_OBJECTIVES: ObjectiveDef[] = [
  { id: "d_play3", period: "daily", metric: "games_played", target: 3, rewardPoints: 10, label: "Jouer 3 parties en ligne", enabled: true },
  { id: "d_win1", period: "daily", metric: "games_won", target: 1, rewardPoints: 10, label: "Gagner une partie", enabled: true },
  { id: "d_rated1", period: "daily", metric: "rated_games", target: 1, rewardPoints: 5, label: "Jouer une partie classée", enabled: true },
  { id: "w_play15", period: "weekly", metric: "games_played", target: 15, rewardPoints: 40, label: "Jouer 15 parties dans la semaine", enabled: true },
  { id: "w_rated5", period: "weekly", metric: "rated_games", target: 5, rewardPoints: 30, label: "Jouer 5 parties classées", enabled: true },
  { id: "w_tournament", period: "weekly", metric: "tournament_games", target: 1, rewardPoints: 30, label: "Jouer une partie de tournoi", enabled: true },
  { id: "w_friend", period: "weekly", metric: "friend_games", target: 1, rewardPoints: 20, label: "Défier un ami", enabled: true },
  { id: "w_post", period: "weekly", metric: "community_posts", target: 1, rewardPoints: 10, label: "Partager une publication", enabled: true },
];

export type CampaignAudience = "all" | "free" | "premium" | "new";

export interface CampaignDef {
  id: string;
  enabled: boolean;
  audience: CampaignAudience;
  /** "modal" (importante, une seule à la fois) ou "banner" (discrète). */
  kind: "modal" | "banner";
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  /** Préfixes de pages où l'afficher ; vide = accueil uniquement. */
  pages: string[];
  startsAt: string | null;
  endsAt: string | null;
  /** Nombre maximal d'affichages par joueur. */
  maxShows: number;
  /** Jours minimum entre deux affichages pour un même joueur. */
  cooldownDays: number;
  /** Variante B facultative du titre/texte (test A/B 50/50). */
  variantB?: { title: string; body: string; ctaLabel?: string } | null;
}

export const DEFAULT_CAMPAIGNS: CampaignDef[] = [
  {
    id: "discover_tournaments",
    enabled: true,
    audience: "all",
    kind: "banner",
    title: "Des tournois gratuits chaque semaine",
    body: "Survival, Arena, Suisse… Inscrivez-vous en un clic, la plupart des tournois sont ouverts à tous.",
    ctaLabel: "Voir les tournois",
    ctaHref: "/tournois",
    pages: ["/"],
    startsAt: null,
    endsAt: null,
    maxShows: 3,
    cooldownDays: 7,
    variantB: null,
  },
];

export interface ExperimentDef {
  id: string;
  enabled: boolean;
  variants: string[];
  description: string;
}

export const DEFAULT_EXPERIMENTS: ExperimentDef[] = [
  { id: "premium_hero", enabled: true, variants: ["A", "B"], description: "Page Premium : A = organisation et clubs en avant, B = progression du joueur en avant." },
  { id: "install_prompt", enabled: true, variants: ["banner", "card"], description: "Proposition d'installation : bandeau bas d'écran ou carte sur l'accueil." },
];

const ID = /^[a-z0-9_]{2,40}$/;

export function validateObjectives(value: unknown): string | null {
  if (!Array.isArray(value)) return "Liste d'objectifs attendue.";
  const ids = new Set<string>();
  for (const o of value as ObjectiveDef[]) {
    if (!o || typeof o !== "object" || !ID.test(o.id)) return "Chaque objectif doit avoir un identifiant (a-z, 0-9, _).";
    if (ids.has(o.id)) return `Objectif ${o.id} en double.`;
    ids.add(o.id);
    if (o.period !== "daily" && o.period !== "weekly") return `${o.id} : période daily ou weekly.`;
    if (!(o.metric in OBJECTIVE_METRICS)) return `${o.id} : mesure inconnue (${Object.keys(OBJECTIVE_METRICS).join(", ")}).`;
    if (!Number.isInteger(o.target) || o.target < 1 || o.target > 500) return `${o.id} : objectif entre 1 et 500.`;
    if (!Number.isInteger(o.rewardPoints) || o.rewardPoints < 0 || o.rewardPoints > 1000) return `${o.id} : récompense entre 0 et 1000 points classiques.`;
    if (typeof o.label !== "string" || !o.label.trim() || o.label.length > 80) return `${o.id} : libellé requis (80 caractères max).`;
    if (typeof o.enabled !== "boolean") return `${o.id} : enabled vrai/faux.`;
  }
  return null;
}

const SAFE_HREF = /^\/[a-zA-Z0-9/_\-?=&#.]*$/;

export function validateCampaigns(value: unknown): string | null {
  if (!Array.isArray(value)) return "Liste de campagnes attendue.";
  const ids = new Set<string>();
  for (const c of value as CampaignDef[]) {
    if (!c || typeof c !== "object" || !ID.test(c.id)) return "Chaque campagne doit avoir un identifiant (a-z, 0-9, _).";
    if (ids.has(c.id)) return `Campagne ${c.id} en double.`;
    ids.add(c.id);
    if (typeof c.enabled !== "boolean") return `${c.id} : enabled vrai/faux.`;
    if (!["all", "free", "premium", "new"].includes(c.audience)) return `${c.id} : audience all, free, premium ou new.`;
    if (c.kind !== "modal" && c.kind !== "banner") return `${c.id} : type modal ou banner.`;
    if (typeof c.title !== "string" || !c.title.trim() || c.title.length > 90) return `${c.id} : titre requis (90 caractères max).`;
    if (typeof c.body !== "string" || c.body.length > 400) return `${c.id} : texte de 400 caractères max.`;
    if (typeof c.ctaLabel !== "string" || c.ctaLabel.length > 40) return `${c.id} : bouton de 40 caractères max.`;
    // Liens internes uniquement : pas de redirection vers un site tiers ni de javascript:.
    if (typeof c.ctaHref !== "string" || (c.ctaHref !== "" && !SAFE_HREF.test(c.ctaHref))) return `${c.id} : lien interne attendu (ex. /tournois).`;
    if (!Array.isArray(c.pages) || !c.pages.every((p) => typeof p === "string" && SAFE_HREF.test(p))) return `${c.id} : pages = liste de chemins (ex. ["/", "/clubs"]).`;
    for (const d of [c.startsAt, c.endsAt]) if (d !== null && (typeof d !== "string" || Number.isNaN(Date.parse(d)))) return `${c.id} : dates ISO ou null.`;
    if (!Number.isInteger(c.maxShows) || c.maxShows < 1 || c.maxShows > 50) return `${c.id} : affichages maximum entre 1 et 50.`;
    if (!Number.isInteger(c.cooldownDays) || c.cooldownDays < 0 || c.cooldownDays > 365) return `${c.id} : délai entre 0 et 365 jours.`;
    if (c.variantB != null && (typeof c.variantB.title !== "string" || typeof c.variantB.body !== "string")) return `${c.id} : variante B {title, body}.`;
  }
  return null;
}

export function validateExperiments(value: unknown): string | null {
  if (!Array.isArray(value)) return "Liste d'expériences attendue.";
  for (const e of value as ExperimentDef[]) {
    if (!e || !ID.test(e.id)) return "Chaque expérience doit avoir un identifiant.";
    if (typeof e.enabled !== "boolean") return `${e.id} : enabled vrai/faux.`;
    if (!Array.isArray(e.variants) || e.variants.length < 2 || e.variants.length > 4 || !e.variants.every((v) => typeof v === "string" && /^[A-Za-z0-9_]{1,16}$/.test(v))) {
      return `${e.id} : 2 à 4 variantes.`;
    }
  }
  return null;
}

/** Répartition déterministe et stable d'un visiteur dans une variante. */
export function assignVariant(seed: string, experimentId: string, variants: string[]): string {
  let h = 2166136261;
  for (const ch of `${experimentId}:${seed}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return variants[(h >>> 0) % variants.length]!;
}
