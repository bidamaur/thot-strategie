import { countryCodeFromName } from "@/lib/countries";

/**
 * Règles pures de la monétisation (sans base de données) : pays, numéros,
 * codes USSD, références de transaction, périodes Premium.
 * Importable côté client comme côté serveur.
 */

export const PROVIDERS = ["ORANGE_MONEY", "MTN_MOMO"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER_LABELS: Record<Provider, string> = {
  ORANGE_MONEY: "Orange Money",
  MTN_MOMO: "MTN Mobile Money",
};

export const PURPOSES = ["PREMIUM", "DONATION"] as const;
export type PaymentPurpose = (typeof PURPOSES)[number];

export const STATUSES = ["PENDING", "VALIDATED", "REJECTED"] as const;
export type PaymentStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "En attente de validation",
  VALIDATED: "Validé",
  REJECTED: "Rejeté",
};

export const REJECT_REASONS = {
  NOT_FOUND: "Transaction introuvable",
  WRONG_AMOUNT: "Montant incorrect",
  INVALID_REFERENCE: "Référence invalide",
  REFERENCE_USED: "Référence déjà utilisée",
  NOT_RECEIVED: "Paiement non reçu",
  OTHER: "Autre motif",
} as const;
export type RejectReason = keyof typeof REJECT_REASONS;

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

// ── Pays ────────────────────────────────────────────────────────────────

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

const COUNTRY_ALIASES: Record<string, string> = {
  cm: "CM", cmr: "CM", cameroun: "CM", cameroon: "CM", kamerun: "CM", camerun: "CM", republiqueducameroun: "CM",
  ci: "CI", cotedivoire: "CI", ivorycoast: "CI",
  sn: "SN", senegal: "SN",
  ga: "GA", gabon: "GA",
  td: "TD", tchad: "TD", chad: "TD",
  cf: "CF", centrafrique: "CF", republiquecentrafricaine: "CF",
  cg: "CG", congo: "CG", congobrazzaville: "CG",
  cd: "CD", rdc: "CD", congokinshasa: "CD", republiquedemocratiqueducongo: "CD",
  gq: "GQ", guineeequatoriale: "GQ",
  ng: "NG", nigeria: "NG",
  bj: "BJ", benin: "BJ",
  tg: "TG", togo: "TG",
  bf: "BF", burkinafaso: "BF",
  ml: "ML", mali: "ML",
  ne: "NE", niger: "NE",
  gn: "GN", guinee: "GN",
  ma: "MA", maroc: "MA", morocco: "MA",
  dz: "DZ", algerie: "DZ",
  tn: "TN", tunisie: "TN",
  fr: "FR", france: "FR",
  be: "BE", belgique: "BE", belgium: "BE",
  ch: "CH", suisse: "CH",
  ca: "CA", canada: "CA",
  us: "US", usa: "US", etatsunis: "US", unitedstates: "US",
  gb: "GB", uk: "GB", royaumeuni: "GB",
  de: "DE", allemagne: "DE",
  nl: "NL", paysbas: "NL",
};

/** Code pays ISO à partir du texte libre du profil (null si inconnu). */
export function normalizeCountryCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const key = fold(text);
  if (!key) return null;
  return COUNTRY_ALIASES[key] ?? countryCodeFromName(text);
}

/** Pays retenu pour les paiements : celui confirmé par l'administration prime. */
export function paymentCountryCode(user: { country: string | null; verifiedCountryCode: string | null }): string | null {
  return user.verifiedCountryCode ?? normalizeCountryCode(user.country);
}

// ── Numéros camerounais ─────────────────────────────────────────────────

/**
 * Numéro mobile camerounais normalisé sur 9 chiffres (6XXXXXXXX), avec ou
 * sans indicatif +237 / 00237 ; null s'il ne s'agit pas d'un mobile camerounais.
 */
export function normalizeCameroonMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/[\s.\-()/]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 12 && digits.startsWith("237")) digits = digits.slice(3);
  return /^6\d{8}$/.test(digits) ? digits : null;
}

export function formatPhone(nine: string): string {
  return /^\d{9}$/.test(nine) ? `${nine.slice(0, 3)} ${nine.slice(3, 5)} ${nine.slice(5, 7)} ${nine.slice(7)}` : nine;
}

// ── USSD ────────────────────────────────────────────────────────────────

/** Remplace {NUMERO} et {MONTANT} ; null si aucun code n'est configuré. */
export function buildUssd(template: string, number: string, amount: number): string | null {
  const t = template.trim();
  if (!t) return null;
  return t.replaceAll("{NUMERO}", number).replaceAll("{MONTANT}", String(Math.round(amount)));
}

/** Lien `tel:` qui ouvre le composeur avec le code (# encodé). */
export function ussdTelHref(code: string): string {
  return `tel:${code.replaceAll("#", "%23")}`;
}

// ── Référence de transaction ────────────────────────────────────────────

/** Majuscules, sans espaces ; null si le format ne ressemble pas à une référence. */
export function normalizeTransactionRef(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const ref = input.trim().replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9][A-Z0-9.\-_/:]{3,59}$/.test(ref) ? ref : null;
}

/** Référence interne lisible : PAY-XXXXXXXX ou DON-XXXXXXXX (alphabet sans 0/O/1/I). */
export function internalReference(purpose: PaymentPurpose, random: () => number = Math.random): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 8; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
  return `${purpose === "PREMIUM" ? "PAY" : "DON"}-${out}`;
}

// ── Période Premium ─────────────────────────────────────────────────────

const DAY = 86_400_000;

export interface CurrentPremium {
  isPremium: boolean;
  premiumLevel: number;
  premiumExpiresAt: Date | null;
}

export function activeLevel(user: CurrentPremium, now: Date): number {
  if (!user.isPremium) return 0;
  if (user.premiumExpiresAt && user.premiumExpiresAt <= now) return 0;
  return Math.max(1, user.premiumLevel || 0);
}

/**
 * Début et fin de l'abonnement accordé par un paiement validé :
 * - même niveau encore actif : prolongation à partir de l'échéance en cours ;
 * - sinon (nouveau, expiré ou niveau supérieur) : à partir de maintenant.
 * Un niveau inférieur au niveau actif est refusé (null).
 */
export function premiumPeriod(
  user: CurrentPremium,
  tier: { level: number; durationDays: number },
  now: Date,
): { startsAt: Date; expiresAt: Date } | null {
  const current = activeLevel(user, now);
  if (current > tier.level) return null;
  const startsAt =
    current === tier.level && user.premiumExpiresAt && user.premiumExpiresAt > now ? user.premiumExpiresAt : now;
  return { startsAt, expiresAt: new Date(startsAt.getTime() + tier.durationDays * DAY) };
}

// ── Affichage ───────────────────────────────────────────────────────────

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** "2027-02-01" → "février 2027". */
export function launchLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(isoDate);
  if (!m) return isoDate;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : isoDate;
}

export function fillDate(text: string, label: string): string {
  return text.replaceAll("{DATE}", label);
}

/** 12 500 (espace normale : identique sur tous les navigateurs et lecteurs d'écran). */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n).replace(/ | /g, " ");
}

export function formatCfa(amount: number): string {
  return `${formatNumber(amount)} FCFA`;
}

// ── Intérêts commerciaux ────────────────────────────────────────────────

/** Fonctionnalités Premium dont on mesure l'intérêt (liste fermée). */
export const INTEREST_FEATURES = {
  PREMIUM_OFFER: "Offre Premium (choix d’un niveau)",
  ADVANCED_STATS: "Statistiques avancées",
  OPPONENT_STATS: "Statistiques de l’adversaire",
  HISTORY: "Historique complet des parties",
  UNLIMITED_GAMES: "Parties illimitées",
  TOURNAMENT_ORGANIZATION: "Organisation de tournois",
  PRIVATE_ROOMS: "Salons privés",
  CLUBS: "Clubs et interclubs",
  AD_FREE: "Navigation sans publicité",
  AI_LEVELS: "Niveaux 4 et 5 de l’IA d’entraînement",
  DONATION: "Dons internationaux",
} as const;
export type InterestFeature = keyof typeof INTEREST_FEATURES;

export function isInterestFeature(value: unknown): value is InterestFeature {
  return typeof value === "string" && Object.hasOwn(INTEREST_FEATURES, value);
}

/** Contexte des messages Premium existants → fonctionnalité mesurée. */
export function featureFromContext(context: string): InterestFeature {
  switch (context) {
    case "stats": return "ADVANCED_STATS";
    case "history": return "HISTORY";
    case "quota": return "UNLIMITED_GAMES";
    case "opponent": return "OPPONENT_STATS";
    case "tournament": return "TOURNAMENT_ORGANIZATION";
    case "rooms": return "PRIVATE_ROOMS";
    case "clubs": return "CLUBS";
    default: return "PREMIUM_OFFER";
  }
}
