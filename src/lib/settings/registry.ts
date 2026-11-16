/**
 * Registre central des paramètres métier administrables.
 *
 * Chaque règle configurable de la plateforme est déclarée ici avec sa valeur
 * par défaut, son type, ses bornes et sa catégorie. Les valeurs sont stockées
 * dans la table `TournamentConfig` (clé/valeur JSON) — les anciennes clés
 * (`survival_bank_*`, `platform_fee_percentage`, …) sont conservées telles
 * quelles pour rester compatibles avec le code existant.
 *
 * Ce fichier ne dépend d'aucun module serveur : il peut être importé côté client
 * (formulaire d'administration) comme côté serveur.
 */

export type SettingCategory =
  | "points"
  | "rating"
  | "money"
  | "matchmaking"
  | "match"
  | "tournaments"
  | "survival"
  | "premium"
  | "clubs";

export const SETTING_CATEGORIES: Record<
  SettingCategory,
  { label: string; description: string }
> = {
  points: {
    label: "Points classiques",
    description: "Points non rémunérés : gains, pertes, limites. Aucune valeur monétaire.",
  },
  rating: {
    label: "Classement ALO/ELO",
    description: "Coefficients, cadences, statut provisoire et catégories de niveau.",
  },
  money: {
    label: "Points argent",
    description: "Portefeuille rémunéré : activation, mises, commissions, limites anti-fraude.",
  },
  matchmaking: {
    label: "Matchmaking",
    description: "Tolérance ELO, élargissement de recherche, modes autorisés.",
  },
  match: {
    label: "Parties",
    description: "Annulation, reconnexion et règles communes à toutes les parties.",
  },
  tournaments: {
    label: "Tournois",
    description: "Formats autorisés, capacités, commissions et droits d'entrée.",
  },
  survival: {
    label: "Survival",
    description: "Capital initial, mises, élimination, réintégration et organisation.",
  },
  premium: {
    label: "Premium",
    description: "Niveaux, tarifs, privilèges et limites des abonnements.",
  },
  clubs: {
    label: "Clubs",
    description: "Création, capacités et permissions des clubs.",
  },
};

type BaseDef = {
  key: string;
  category: SettingCategory;
  label: string;
  description?: string;
  /** Modification sensible : mise en avant dans l'interface d'administration. */
  critical?: boolean;
};

export type SettingDef =
  | (BaseDef & { type: "number"; default: number; min?: number; max?: number; integer?: boolean; unit?: string })
  | (BaseDef & { type: "boolean"; default: boolean })
  | (BaseDef & { type: "enum"; default: string; options: { value: string; label: string }[] })
  | (BaseDef & { type: "json"; default: unknown });

export interface PremiumPrivileges {
  /** Nombre de tournois simultanément ouverts/en cours créés par le membre. */
  maxActiveTournaments: number;
  /** Capacité maximale d'un tournoi créé. */
  maxTournamentPlayers: number;
  /** Portée géographique maximale. */
  maxScope: "NEIGHBORHOOD" | "CITY" | "REGION" | "COUNTRY" | "CONTINENT" | "INTERNATIONAL";
  /** Formats de tournoi utilisables (en plus de Survival, ouvert à tous). */
  tournamentFormats: string[];
  privateTournaments: boolean;
  paidTournaments: boolean;
  customTournamentBranding: boolean;
  advancedStats: boolean;
  /** Profondeur d'historique consultable (jours, 0 = illimité). */
  historyDays: number;
  clubCreate: boolean;
  maxClubsOwned: number;
  maxClubMembers: number;
  clubChampionships: boolean;
  profileThemes: boolean;
  badge: boolean;
}

export interface PremiumTier {
  level: number;
  name: string;
  priceCfa: number;
  durationDays: number;
  tagline: string;
  privileges: PremiumPrivileges;
}

const BASE_FORMATS = ["SURVIVAL_BANK"];

export const DEFAULT_PREMIUM_TIERS: PremiumTier[] = [
  {
    level: 0,
    name: "Gratuit",
    priceCfa: 0,
    durationDays: 0,
    tagline: "Jouer, progresser et organiser des Survival.",
    privileges: {
      maxActiveTournaments: 1,
      maxTournamentPlayers: 16,
      maxScope: "CITY",
      tournamentFormats: BASE_FORMATS,
      privateTournaments: false,
      paidTournaments: false,
      customTournamentBranding: false,
      advancedStats: false,
      historyDays: 30,
      clubCreate: false,
      maxClubsOwned: 0,
      maxClubMembers: 30,
      clubChampionships: false,
      profileThemes: false,
      badge: false,
    },
  },
  {
    level: 1,
    name: "Bronze",
    priceCfa: 2_000,
    durationDays: 30,
    tagline: "Statistiques détaillées et tournois de quartier.",
    privileges: {
      maxActiveTournaments: 2,
      maxTournamentPlayers: 16,
      maxScope: "NEIGHBORHOOD",
      tournamentFormats: [...BASE_FORMATS, "ARENA", "ELIMINATION"],
      privateTournaments: true,
      paidTournaments: false,
      customTournamentBranding: false,
      advancedStats: true,
      historyDays: 180,
      clubCreate: true,
      maxClubsOwned: 1,
      maxClubMembers: 50,
      clubChampionships: false,
      profileThemes: true,
      badge: true,
    },
  },
  {
    level: 2,
    name: "Argent",
    priceCfa: 5_000,
    durationDays: 30,
    tagline: "Clubs, tournois privés et formats avancés.",
    privileges: {
      maxActiveTournaments: 3,
      maxTournamentPlayers: 32,
      maxScope: "CITY",
      tournamentFormats: [...BASE_FORMATS, "ARENA", "ELIMINATION", "SWISS", "ROUND_ROBIN"],
      privateTournaments: true,
      paidTournaments: true,
      customTournamentBranding: true,
      advancedStats: true,
      historyDays: 365,
      clubCreate: true,
      maxClubsOwned: 1,
      maxClubMembers: 100,
      clubChampionships: true,
      profileThemes: true,
      badge: true,
    },
  },
  {
    level: 3,
    name: "Or",
    priceCfa: 10_000,
    durationDays: 30,
    tagline: "Organisateur national : tous les formats.",
    privileges: {
      maxActiveTournaments: 5,
      maxTournamentPlayers: 64,
      maxScope: "COUNTRY",
      tournamentFormats: [
        ...BASE_FORMATS, "ARENA", "ELIMINATION", "SWISS", "ROUND_ROBIN",
        "DOUBLE_ELIMINATION", "GROUPS_ELIMINATION", "LEAGUE",
      ],
      privateTournaments: true,
      paidTournaments: true,
      customTournamentBranding: true,
      advancedStats: true,
      historyDays: 0,
      clubCreate: true,
      maxClubsOwned: 2,
      maxClubMembers: 250,
      clubChampionships: true,
      profileThemes: true,
      badge: true,
    },
  },
  {
    level: 4,
    name: "Platine",
    priceCfa: 20_000,
    durationDays: 30,
    tagline: "Compétitions continentales et ligues.",
    privileges: {
      maxActiveTournaments: 10,
      maxTournamentPlayers: 64,
      maxScope: "CONTINENT",
      tournamentFormats: [
        ...BASE_FORMATS, "ARENA", "ELIMINATION", "SWISS", "ROUND_ROBIN",
        "DOUBLE_ELIMINATION", "GROUPS_ELIMINATION", "LEAGUE",
      ],
      privateTournaments: true,
      paidTournaments: true,
      customTournamentBranding: true,
      advancedStats: true,
      historyDays: 0,
      clubCreate: true,
      maxClubsOwned: 3,
      maxClubMembers: 500,
      clubChampionships: true,
      profileThemes: true,
      badge: true,
    },
  },
  {
    level: 5,
    name: "Diamant",
    priceCfa: 50_000,
    durationDays: 30,
    tagline: "Organisateur international sans limite.",
    privileges: {
      maxActiveTournaments: 25,
      maxTournamentPlayers: 64,
      maxScope: "INTERNATIONAL",
      tournamentFormats: [
        ...BASE_FORMATS, "ARENA", "ELIMINATION", "SWISS", "ROUND_ROBIN",
        "DOUBLE_ELIMINATION", "GROUPS_ELIMINATION", "LEAGUE",
      ],
      privateTournaments: true,
      paidTournaments: true,
      customTournamentBranding: true,
      advancedStats: true,
      historyDays: 0,
      clubCreate: true,
      maxClubsOwned: 5,
      maxClubMembers: 1000,
      clubChampionships: true,
      profileThemes: true,
      badge: true,
    },
  },
];

export const DEFAULT_RATING_LEVELS = [
  { label: "Débutant", minRating: 0 },
  { label: "Amateur", minRating: 1000 },
  { label: "Confirmé", minRating: 1200 },
  { label: "Expert", minRating: 1400 },
  { label: "Maître", minRating: 1600 },
  { label: "Grand Maître", minRating: 1800 },
  { label: "Grand Maître Élite", minRating: 2000 },
  { label: "Légende", minRating: 2200 },
];

export const SETTING_DEFINITIONS = [
  // ── Points classiques ────────────────────────────────────────────────
  { key: "points.classic.enabled", category: "points", type: "boolean", default: true, label: "Points classiques actifs", description: "Attribuer/retirer des points classiques à l'issue des parties." },
  { key: "points.classic.winBase", category: "points", type: "number", default: 3, min: 0, max: 1000, integer: true, label: "Bonus de victoire", unit: "pts" },
  { key: "points.classic.pieceBonusCap", category: "points", type: "number", default: 10, min: 0, max: 1000, integer: true, label: "Plafond du bonus d'écart de pièces", unit: "pts" },
  { key: "points.classic.lossPercent", category: "points", type: "number", default: 100, min: 0, max: 100, integer: true, label: "Perte du vaincu (% du gain du vainqueur)", unit: "%" },
  { key: "points.classic.drawPoints", category: "points", type: "number", default: 0, min: 0, max: 100, integer: true, label: "Points pour une nulle", unit: "pts" },
  { key: "points.classic.floorAtZero", category: "points", type: "boolean", default: true, label: "Interdire un solde négatif", description: "La perte est plafonnée au solde disponible." },
  { key: "points.classic.casualAwards", category: "points", type: "boolean", default: true, label: "Points en parties amicales" },
  { key: "points.classic.ratedAwards", category: "points", type: "boolean", default: true, label: "Points en parties classées" },
  { key: "points.classic.dailyGainCap", category: "points", type: "number", default: 0, min: 0, max: 1_000_000, integer: true, label: "Plafond de gain quotidien (0 = illimité)", unit: "pts" },
  { key: "points.classic.friendlyStakesEnabled", category: "points", type: "boolean", default: true, label: "Défis en points classiques", description: "Mise amicale en points classiques proposée avant le premier coup." },
  { key: "points.classic.friendlyStakeMax", category: "points", type: "number", default: 1000, min: 1, max: 1_000_000, integer: true, label: "Défi maximum", unit: "pts" },

  // ── ALO / ELO ────────────────────────────────────────────────────────
  { key: "rating.initial", category: "rating", type: "number", default: 1200, min: 100, max: 3000, integer: true, label: "Classement initial" },
  { key: "rating.floor", category: "rating", type: "number", default: 100, min: 0, max: 2000, integer: true, label: "Classement plancher" },
  { key: "rating.provisionalGames", category: "rating", type: "number", default: 15, min: 0, max: 100, integer: true, label: "Parties avant classement confirmé" },
  { key: "rating.kProvisional", category: "rating", type: "number", default: 40, min: 1, max: 100, integer: true, label: "Coefficient K provisoire" },
  { key: "rating.kBeginner", category: "rating", type: "number", default: 40, min: 1, max: 100, integer: true, label: "K < seuil débutant" },
  { key: "rating.kAmateur", category: "rating", type: "number", default: 32, min: 1, max: 100, integer: true, label: "K amateur" },
  { key: "rating.kConfirmed", category: "rating", type: "number", default: 24, min: 1, max: 100, integer: true, label: "K confirmé" },
  { key: "rating.kExpert", category: "rating", type: "number", default: 20, min: 1, max: 100, integer: true, label: "K expert" },
  { key: "rating.kProfessional", category: "rating", type: "number", default: 16, min: 1, max: 100, integer: true, label: "K professionnel" },
  { key: "rating.bandBeginner", category: "rating", type: "number", default: 1200, min: 0, max: 4000, integer: true, label: "Seuil amateur" },
  { key: "rating.bandAmateur", category: "rating", type: "number", default: 1400, min: 0, max: 4000, integer: true, label: "Seuil confirmé" },
  { key: "rating.bandConfirmed", category: "rating", type: "number", default: 1600, min: 0, max: 4000, integer: true, label: "Seuil expert" },
  { key: "rating.bandExpert", category: "rating", type: "number", default: 1800, min: 0, max: 4000, integer: true, label: "Seuil professionnel" },
  { key: "rating.cadenceBulletMax", category: "rating", type: "number", default: 2, min: 1, max: 60, integer: true, label: "Bullet ≤ (minutes)", unit: "min" },
  { key: "rating.cadenceBlitzMax", category: "rating", type: "number", default: 5, min: 1, max: 120, integer: true, label: "Blitz ≤ (minutes)", unit: "min" },
  { key: "rating.cadenceRapidMax", category: "rating", type: "number", default: 15, min: 1, max: 240, integer: true, label: "Rapide ≤ (minutes)", unit: "min" },
  { key: "rating.levels", category: "rating", type: "json", default: DEFAULT_RATING_LEVELS, label: "Catégories de niveau", description: "Liste [{label, minRating}] triée par seuil croissant." },

  // ── Points argent ────────────────────────────────────────────────────
  { key: "money.enabled", category: "money", type: "boolean", default: false, critical: true, label: "Parties rémunérées actives", description: "Interrupteur général du mode rémunéré. À activer uniquement si le cadre légal le permet." },
  { key: "money.requireVerification", category: "money", type: "boolean", default: true, critical: true, label: "Vérification du compte obligatoire", description: "Seuls les comptes marqués « vérifiés » par un administrateur peuvent jouer en mode rémunéré." },
  { key: "money.minStake", category: "money", type: "number", default: 100, min: 1, max: 10_000_000, integer: true, label: "Mise minimale", unit: "FCFA" },
  { key: "money.maxStake", category: "money", type: "number", default: 10_000, min: 1, max: 10_000_000, integer: true, label: "Mise maximale", unit: "FCFA" },
  { key: "money.stakePresets", category: "money", type: "json", default: [100, 500, 1000, 5000], label: "Montants proposés", description: "Liste des mises proposées dans la recherche de partie." },
  { key: "money.commissionPercent", category: "money", type: "number", default: 10, min: 0, max: 50, label: "Commission plateforme sur le pot", unit: "%", critical: true },
  { key: "money.dailyStakeLimit", category: "money", type: "number", default: 50_000, min: 0, max: 100_000_000, integer: true, label: "Limite quotidienne de mises (0 = illimitée)", unit: "FCFA" },
  { key: "money.maxGamesVsSameOpponentPerDay", category: "money", type: "number", default: 3, min: 0, max: 100, integer: true, label: "Parties/jour contre le même adversaire (anti-collusion, 0 = illimité)" },
  { key: "money.affectsRating", category: "money", type: "boolean", default: false, label: "Les parties rémunérées comptent pour l'ELO" },
  { key: "money.tournamentsEnabled", category: "money", type: "boolean", default: true, critical: true, label: "Tournois payants actifs" },

  // ── Matchmaking ──────────────────────────────────────────────────────
  { key: "matchmaking.casualEnabled", category: "matchmaking", type: "boolean", default: true, label: "Mode amical disponible" },
  { key: "matchmaking.ratedEnabled", category: "matchmaking", type: "boolean", default: true, label: "Mode classé disponible" },
  { key: "matchmaking.eloToleranceBase", category: "matchmaking", type: "number", default: 150, min: 0, max: 3000, integer: true, label: "Écart ELO initial toléré" },
  { key: "matchmaking.eloToleranceGrowthPerSec", category: "matchmaking", type: "number", default: 10, min: 0, max: 500, label: "Élargissement par seconde d'attente" },
  { key: "matchmaking.eloToleranceMax", category: "matchmaking", type: "number", default: 800, min: 0, max: 4000, integer: true, label: "Écart ELO maximum" },
  { key: "matchmaking.casualUsesElo", category: "matchmaking", type: "boolean", default: false, label: "Appliquer la tolérance ELO en amical" },
  { key: "matchmaking.avoidRepeatSeconds", category: "matchmaking", type: "number", default: 45, min: 0, max: 3600, integer: true, label: "Éviter le dernier adversaire pendant", unit: "s" },
  { key: "matchmaking.timeControlMin", category: "matchmaking", type: "number", default: 1, min: 1, max: 180, integer: true, label: "Cadence minimale", unit: "min" },
  { key: "matchmaking.timeControlMax", category: "matchmaking", type: "number", default: 60, min: 1, max: 180, integer: true, label: "Cadence maximale", unit: "min" },

  // ── Parties ──────────────────────────────────────────────────────────
  { key: "match.abortMovesThreshold", category: "match", type: "number", default: 2, min: 0, max: 10, integer: true, label: "Annulation sans conséquence avant N coups", description: "Un abandon/déconnexion avant ce nombre de demi-coups annule la partie (aucun point, ELO ou mise)." },
  { key: "match.chatEnabled", category: "match", type: "boolean", default: true, label: "Chat en partie" },

  // ── Tournois (clés historiques conservées) ───────────────────────────
  { key: "allowed_tournament_types", category: "tournaments", type: "json", default: ["SURVIVAL_BANK", "ARENA", "SWISS", "ROUND_ROBIN", "ELIMINATION", "DOUBLE_ELIMINATION", "GROUPS_ELIMINATION", "LEAGUE"], label: "Formats autorisés" },
  { key: "tournament_max_players", category: "tournaments", type: "json", default: { min: 4, max: 64 }, label: "Capacité des tournois {min, max}" },
  { key: "platform_fee_percentage", category: "tournaments", type: "number", default: 10, min: 0, max: 50, label: "Commission sur les tournois payants", unit: "%", critical: true },
  { key: "entry_fee_min_cfa", category: "tournaments", type: "number", default: 100, min: 0, max: 10_000_000, integer: true, label: "Droit d'entrée minimum", unit: "FCFA" },
  { key: "tournaments.swissRounds", category: "tournaments", type: "number", default: 0, min: 0, max: 20, integer: true, label: "Rondes en système suisse (0 = automatique)" },
  { key: "tournaments.roundRobinMaxPlayers", category: "tournaments", type: "number", default: 20, min: 3, max: 40, integer: true, label: "Joueurs max. en toutes rondes / ligue" },
  { key: "tournaments.gamesRated", category: "tournaments", type: "boolean", default: true, label: "Les parties de tournoi comptent pour l'ELO" },
  { key: "tournaments.prizeSplitPercent", category: "tournaments", type: "json", default: [50, 30, 20], label: "Répartition des prix (1er, 2e, 3e) en %", description: "Trois pourcentages dont la somme vaut 100." },
  { key: "tournaments.freezeRulesOnStart", category: "tournaments", type: "boolean", default: true, label: "Figer les règles au démarrage", description: "Les paramètres sont copiés dans le tournoi à son lancement et ne changent plus." },

  // ── Survival ─────────────────────────────────────────────────────────
  { key: "community_tournament_min_points", category: "survival", type: "number", default: 5000, min: 0, max: 100_000_000, integer: true, label: "Points requis pour organiser un Survival", description: "Ouvert à tous les joueurs, Premium ou non." },
  { key: "survival_bank_initial_capital", category: "survival", type: "number", default: 500, min: 1, max: 1_000_000, integer: true, label: "Capital initial", unit: "pts" },
  { key: "survival_bank_min_bet", category: "survival", type: "number", default: 10, min: 1, max: 1_000_000, integer: true, label: "Mise minimale", unit: "pts" },
  { key: "survival_bank_max_bet", category: "survival", type: "number", default: 100, min: 1, max: 1_000_000, integer: true, label: "Mise maximale", unit: "pts" },
  { key: "survival_bank_rebuy_enabled", category: "survival", type: "boolean", default: false, label: "Réintégration autorisée par défaut" },
  { key: "survival_bank_rebuy_cost", category: "survival", type: "number", default: 0, min: 0, max: 1_000_000, integer: true, label: "Coût de réintégration", unit: "pts" },

  // ── Premium ──────────────────────────────────────────────────────────
  { key: "premium.tiers", category: "premium", type: "json", default: DEFAULT_PREMIUM_TIERS, critical: true, label: "Niveaux, tarifs et privilèges", description: "Tableau des niveaux 0 à 5 avec leurs privilèges et limites." },

  // ── Clubs ────────────────────────────────────────────────────────────
  { key: "clubs.enabled", category: "clubs", type: "boolean", default: true, label: "Clubs actifs" },
  { key: "clubs.minPointsToCreate", category: "clubs", type: "number", default: 2000, min: 0, max: 100_000_000, integer: true, label: "Points requis pour créer un club sans Premium (0 = Premium obligatoire)" },
  { key: "clubs.defaultMaxMembers", category: "clubs", type: "number", default: 30, min: 2, max: 10_000, integer: true, label: "Capacité d'un club non Premium" },
] as const satisfies readonly SettingDef[];

export type SettingKey = (typeof SETTING_DEFINITIONS)[number]["key"];

type DefByKey<K extends SettingKey> = Extract<(typeof SETTING_DEFINITIONS)[number], { key: K }>;

export type SettingValue<K extends SettingKey> =
  DefByKey<K> extends { type: "number" } ? number
  : DefByKey<K> extends { type: "boolean" } ? boolean
  : DefByKey<K> extends { type: "enum" } ? string
  : K extends "premium.tiers" ? PremiumTier[]
  : K extends "rating.levels" ? typeof DEFAULT_RATING_LEVELS
  : K extends "money.stakePresets" ? number[]
  : K extends "allowed_tournament_types" ? string[]
  : K extends "tournament_max_players" ? { min: number; max: number }
  : K extends "tournaments.prizeSplitPercent" ? [number, number, number]
  : unknown;

const DEF_MAP = new Map<string, SettingDef>(
  (SETTING_DEFINITIONS as readonly SettingDef[]).map((def) => [def.key, def]),
);

export function getSettingDef(key: string): SettingDef | undefined {
  return DEF_MAP.get(key);
}

export function getSettingDefault<K extends SettingKey>(key: K): SettingValue<K> {
  return structuredClone(DEF_MAP.get(key)!.default) as SettingValue<K>;
}

/**
 * Valide une valeur selon sa définition. Retourne la valeur normalisée ou
 * un message d'erreur lisible.
 */
export function validateSettingValue(
  key: string,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const def = DEF_MAP.get(key);
  if (!def) return { ok: true, value }; // clé libre héritée : acceptée telle quelle
  switch (def.type) {
    case "number": {
      const n = typeof value === "string" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false, error: `${def.label} : nombre attendu.` };
      if (def.integer && !Number.isInteger(n)) return { ok: false, error: `${def.label} : entier attendu.` };
      if (def.min !== undefined && n < def.min) return { ok: false, error: `${def.label} : minimum ${def.min}.` };
      if (def.max !== undefined && n > def.max) return { ok: false, error: `${def.label} : maximum ${def.max}.` };
      return { ok: true, value: n };
    }
    case "boolean":
      if (typeof value !== "boolean") return { ok: false, error: `${def.label} : vrai/faux attendu.` };
      return { ok: true, value };
    case "enum":
      if (!def.options.some((o) => o.value === value)) return { ok: false, error: `${def.label} : valeur non autorisée.` };
      return { ok: true, value };
    case "json":
      return validateJsonSetting(key, value, def.label);
  }
}

function validateJsonSetting(
  key: string,
  value: unknown,
  label: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: false, error: `${label} : valeur requise.` };
  if (key === "premium.tiers") {
    if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "Les niveaux Premium doivent être une liste non vide." };
    const levels = new Set<number>();
    for (const tier of value as PremiumTier[]) {
      if (typeof tier !== "object" || tier === null || !Number.isInteger(tier.level) || tier.level < 0 || tier.level > 10) {
        return { ok: false, error: "Chaque niveau Premium doit avoir un niveau entier (0-10)." };
      }
      if (levels.has(tier.level)) return { ok: false, error: `Niveau Premium ${tier.level} en double.` };
      levels.add(tier.level);
      if (typeof tier.name !== "string" || !tier.name.trim()) return { ok: false, error: `Niveau ${tier.level} : nom requis.` };
      if (typeof tier.priceCfa !== "number" || tier.priceCfa < 0) return { ok: false, error: `Niveau ${tier.level} : tarif invalide.` };
      if (typeof tier.privileges !== "object" || tier.privileges === null) return { ok: false, error: `Niveau ${tier.level} : privilèges requis.` };
    }
    if (!levels.has(0)) return { ok: false, error: "Le niveau 0 (gratuit) est obligatoire." };
    return { ok: true, value };
  }
  if (key === "money.stakePresets") {
    if (!Array.isArray(value) || !value.every((v) => Number.isInteger(v) && v > 0)) {
      return { ok: false, error: "Les montants proposés doivent être des entiers positifs." };
    }
    return { ok: true, value: [...new Set(value as number[])].sort((a, b) => a - b) };
  }
  if (key === "rating.levels") {
    if (!Array.isArray(value) || !value.every((l) => typeof l?.label === "string" && Number.isFinite(l?.minRating))) {
      return { ok: false, error: "Chaque catégorie doit avoir un libellé et un seuil." };
    }
    return { ok: true, value: [...value].sort((a, b) => a.minRating - b.minRating) };
  }
  if (key === "tournament_max_players") {
    const v = value as { min?: unknown; max?: unknown };
    if (!Number.isInteger(v.min) || !Number.isInteger(v.max) || (v.min as number) < 2 || (v.max as number) < (v.min as number)) {
      return { ok: false, error: "Capacité invalide : {min ≥ 2, max ≥ min}." };
    }
    return { ok: true, value };
  }
  if (key === "tournaments.prizeSplitPercent") {
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      !value.every((v) => Number.isInteger(v) && v >= 0) ||
      (value as number[]).reduce((a, b) => a + b, 0) !== 100
    ) {
      return { ok: false, error: "Trois pourcentages entiers dont la somme vaut 100." };
    }
    return { ok: true, value };
  }
  if (key === "allowed_tournament_types") {
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return { ok: false, error: "Liste de formats attendue." };
    return { ok: true, value };
  }
  return { ok: true, value };
}
