import { Prisma } from "@/generated/prisma-client";
import { writeAuditLog } from "@/lib/audit";
import { trackServer } from "@/lib/analytics";
import { notify } from "@/lib/community/notifications";
import { decodeFromDb, encodeBounded } from "@/lib/community/text";
import { prisma } from "@/lib/prisma";
import { getSettings, getSetting } from "@/lib/settings/service";
import type { PremiumTier } from "@/lib/settings/registry";
import {
  activeLevel,
  buildUssd,
  fillDate,
  formatCfa,
  internalReference,
  isProvider,
  launchLabel,
  normalizeCameroonMobile,
  normalizeTransactionRef,
  paymentCountryCode,
  premiumPeriod,
  PROVIDER_LABELS,
  REJECT_REASONS,
  type PaymentPurpose,
  type PaymentStatus,
  type Provider,
  type RejectReason,
} from "./rules";

/**
 * Paiements manuels Mobile Money (Orange Money, MTN) : le joueur déclare un
 * transfert, un administrateur le vérifie sur son compte puis le valide ou le
 * rejette. Une déclaration n'active JAMAIS rien par elle-même.
 *
 * Toutes les valeurs (montant attendu, numéro, niveau, durée) sont recalculées
 * ici à partir des paramètres : rien n'est repris du navigateur.
 */

export class PaymentError extends Error {
  constructor(message: string, public status = 400, public code = "INVALID") {
    super(message);
    this.name = "PaymentError";
  }
}

const PAYMENT_SETTINGS = [
  "payments.cm.enabled",
  "payments.international.enabled",
  "payments.internationalLaunchDate",
  "payments.orange.enabled",
  "payments.orange.number",
  "payments.orange.ussd",
  "payments.orange.instructions",
  "payments.mtn.enabled",
  "payments.mtn.number",
  "payments.mtn.ussd",
  "payments.mtn.instructions",
  "payments.proofImageEnabled",
  "payments.submittedMessage",
  "payments.comingSoonTitle",
  "payments.comingSoonBody",
  "waitlist.enabled",
  "donations.enabled",
  "donations.amounts",
  "donations.customAmountEnabled",
  "donations.minAmount",
  "donations.maxAmount",
  "donations.submittedMessage",
  "donations.internationalMessage",
  "premium.tiers",
] as const;

type Settings = Awaited<ReturnType<typeof loadSettings>>;
const loadSettings = () => getSettings(PAYMENT_SETTINGS);

export interface ProviderInfo {
  id: Provider;
  label: string;
  number: string;
  ussdTemplate: string;
  instructions: string;
}

function providers(s: Settings): ProviderInfo[] {
  const list: ProviderInfo[] = [];
  if (s["payments.orange.enabled"]) {
    list.push({ id: "ORANGE_MONEY", label: PROVIDER_LABELS.ORANGE_MONEY, number: s["payments.orange.number"], ussdTemplate: s["payments.orange.ussd"], instructions: s["payments.orange.instructions"] });
  }
  if (s["payments.mtn.enabled"]) {
    list.push({ id: "MTN_MOMO", label: PROVIDER_LABELS.MTN_MOMO, number: s["payments.mtn.number"], ussdTemplate: s["payments.mtn.ussd"], instructions: s["payments.mtn.instructions"] });
  }
  return list;
}

/** Niveaux réellement en vente (tarif > 0, durée > 0, non retirés). */
export function sellableTiers(tiers: PremiumTier[]): PremiumTier[] {
  return tiers.filter((t) => t.level > 0 && t.priceCfa > 0 && t.durationDays > 0 && t.available !== false);
}

interface PayerRow {
  id: string;
  username: string;
  isAdmin: boolean;
  isPremium: boolean;
  premiumLevel: number;
  premiumExpiresAt: Date | null;
  country: string | null;
  verifiedCountryCode: string | null;
}

const PAYER_SELECT = {
  id: true, username: true, isAdmin: true, isPremium: true, premiumLevel: true, premiumExpiresAt: true, country: true, verifiedCountryCode: true,
} as const;

/** Qui peut payer, et par quel canal. */
function eligibility(user: PayerRow | null, s: Settings) {
  const countryCode = user ? paymentCountryCode(user) : null;
  const cameroon = countryCode === "CM";
  const channels = providers(s);
  const cmOpen = s["payments.cm.enabled"] && channels.length > 0;
  return {
    countryCode,
    cameroon,
    /** Paiement Mobile Money possible maintenant. */
    mobileMoney: Boolean(user) && cameroon && cmOpen,
    /** Aucun prestataire international branché : toujours false à ce stade. */
    international: false,
    reason: !user
      ? "LOGIN"
      : !cmOpen
        ? "CLOSED"
        : !countryCode
          ? "COUNTRY_MISSING"
          : !cameroon
            ? "INTERNATIONAL"
            : null,
  } as const;
}

/** Configuration envoyée à l'interface (aucun secret, aucune donnée d'autres joueurs). */
export async function getCheckoutConfig(userId: string | null) {
  const [s, user] = await Promise.all([
    loadSettings(),
    userId ? prisma.user.findUnique({ where: { id: userId }, select: PAYER_SELECT }) : null,
  ]);
  const label = launchLabel(s["payments.internationalLaunchDate"]);
  const pending = userId
    ? await prisma.payment.findMany({
        where: { userId, status: "PENDING" },
        select: { purpose: true, reference: true, createdAt: true, tierName: true, expectedAmount: true },
      })
    : [];
  return {
    eligibility: eligibility(user, s),
    providers: providers(s),
    tiers: sellableTiers(s["premium.tiers"]).map((t) => ({ level: t.level, name: t.name, priceCfa: t.priceCfa, durationDays: t.durationDays, tagline: t.tagline })),
    currentLevel: user ? (user.isAdmin ? 0 : activeLevel(user, new Date())) : 0,
    currentExpiresAt: user?.premiumExpiresAt?.toISOString() ?? null,
    pending: pending.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
    proofImageEnabled: s["payments.proofImageEnabled"],
    launchLabel: label,
    messages: {
      comingSoonTitle: fillDate(s["payments.comingSoonTitle"], label),
      comingSoonBody: fillDate(s["payments.comingSoonBody"], label),
      premiumSubmitted: s["payments.submittedMessage"],
      donationSubmitted: s["donations.submittedMessage"],
      donationInternational: fillDate(s["donations.internationalMessage"], label),
    },
    waitlistEnabled: s["waitlist.enabled"],
    donations: {
      enabled: s["donations.enabled"],
      amounts: s["donations.amounts"],
      custom: s["donations.customAmountEnabled"],
      min: s["donations.minAmount"],
      max: s["donations.maxAmount"],
    },
  };
}

export type CheckoutConfig = Awaited<ReturnType<typeof getCheckoutConfig>>;

/** Instructions de paiement pour un montant donné (le code USSD est construit ici). */
export async function paymentInstructions(input: { purpose: PaymentPurpose; tierLevel?: number; amount?: number }) {
  const s = await loadSettings();
  const amount = resolveExpectedAmount(s, input).amount;
  return providers(s).map((p) => ({ ...p, amount, ussd: buildUssd(p.ussdTemplate, p.number, amount) }));
}

function resolveExpectedAmount(s: Settings, input: { purpose: PaymentPurpose; tierLevel?: number; amount?: number }) {
  if (input.purpose === "PREMIUM") {
    const tier = sellableTiers(s["premium.tiers"]).find((t) => t.level === input.tierLevel);
    if (!tier) throw new PaymentError("Ce niveau Premium n’est pas proposé à l’achat.", 400, "TIER");
    return { amount: tier.priceCfa, tier };
  }
  if (!s["donations.enabled"]) throw new PaymentError("Les dons sont fermés pour le moment.", 403, "CLOSED");
  const amount = input.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount)) throw new PaymentError("Montant du don invalide.");
  const preset = s["donations.amounts"].includes(amount);
  if (!preset && !s["donations.customAmountEnabled"]) throw new PaymentError("Choisissez l’un des montants proposés.");
  if (!preset && (amount < s["donations.minAmount"] || amount > s["donations.maxAmount"])) {
    throw new PaymentError(`Le don doit être compris entre ${formatCfa(s["donations.minAmount"])} et ${formatCfa(s["donations.maxAmount"])}.`);
  }
  return { amount, tier: null };
}

export interface DeclareInput {
  purpose: unknown;
  provider: unknown;
  tierLevel?: unknown;
  /** Don : montant choisi. */
  amount?: unknown;
  senderPhone: unknown;
  declaredAmount: unknown;
  transactionRef: unknown;
  paidAt: unknown;
}

function asInt(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() ? Number(value.replace(/\s/g, "")) : value;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
}

/** Contrôle complet d'une déclaration (sans écriture). Exporté pour les tests. */
export async function checkDeclaration(userId: string, input: DeclareInput, now = new Date()) {
  const [s, user] = await Promise.all([loadSettings(), prisma.user.findUnique({ where: { id: userId }, select: PAYER_SELECT })]);
  if (!user) throw new PaymentError("Compte introuvable.", 404);
  const purpose: PaymentPurpose | null = input.purpose === "PREMIUM" || input.purpose === "DONATION" ? input.purpose : null;
  if (!purpose) throw new PaymentError("Objet du paiement invalide.");
  const elig = eligibility(user, s);
  if (!elig.mobileMoney) {
    if (elig.reason === "COUNTRY_MISSING") throw new PaymentError("Indiquez votre pays dans votre profil pour payer par Mobile Money.", 403, "COUNTRY_MISSING");
    if (elig.reason === "INTERNATIONAL") {
      throw new PaymentError(`Les paiements internationaux seront disponibles à partir de ${launchLabel(s["payments.internationalLaunchDate"])}.`, 403, "INTERNATIONAL");
    }
    throw new PaymentError("Les paiements Mobile Money sont fermés pour le moment.", 403, "CLOSED");
  }
  if (!isProvider(input.provider)) throw new PaymentError("Choisissez Orange Money ou MTN Mobile Money.");
  const provider = providers(s).find((p) => p.id === input.provider);
  if (!provider) throw new PaymentError("Cet opérateur n’est pas disponible pour le moment.");

  const tierLevel = asInt(input.tierLevel);
  const { amount: expectedAmount, tier } = resolveExpectedAmount(s, {
    purpose,
    tierLevel: tierLevel ?? undefined,
    amount: asInt(input.amount) ?? undefined,
  });
  if (tier) {
    if (user.isAdmin) throw new PaymentError("Le compte administrateur dispose déjà de tous les privilèges.");
    if (activeLevel(user, now) > tier.level) {
      throw new PaymentError("Vous avez déjà un niveau Premium supérieur en cours : choisissez ce niveau ou un niveau plus élevé.", 409, "LOWER_TIER");
    }
  }

  const senderPhone = normalizeCameroonMobile(typeof input.senderPhone === "string" ? input.senderPhone : null);
  if (!senderPhone) throw new PaymentError("Numéro expéditeur invalide : un numéro mobile camerounais de 9 chiffres (6XX XX XX XX) est attendu.");
  const declaredAmount = asInt(input.declaredAmount);
  if (declaredAmount === null || declaredAmount <= 0 || declaredAmount > 100_000_000) throw new PaymentError("Montant envoyé invalide.");
  const transactionRef = normalizeTransactionRef(input.transactionRef);
  if (!transactionRef) throw new PaymentError("Référence de transaction invalide : recopiez-la telle qu’elle figure dans le SMS de votre opérateur.");
  const paidAt = typeof input.paidAt === "string" ? new Date(input.paidAt) : null;
  if (!paidAt || Number.isNaN(paidAt.getTime())) throw new PaymentError("Date du paiement invalide.");
  if (paidAt.getTime() > now.getTime() + 10 * 60_000) throw new PaymentError("La date du paiement ne peut pas être dans le futur.");
  if (paidAt.getTime() < now.getTime() - 60 * 86_400_000) throw new PaymentError("Paiement trop ancien (plus de 60 jours) : contactez l’administration.");

  const used = await prisma.payment.findFirst({
    where: { provider: provider.id, transactionRef, status: { in: ["PENDING", "VALIDATED"] } },
    select: { status: true },
  });
  if (used) throw new PaymentError("Cette référence de transaction a déjà été déclarée.", 409, "REFERENCE_USED");
  const pending = await prisma.payment.findFirst({ where: { userId, purpose, status: "PENDING" }, select: { reference: true } });
  if (pending) {
    throw new PaymentError(`Une déclaration (${pending.reference}) est déjà en attente de validation : patientez avant d’en envoyer une autre.`, 409, "ALREADY_PENDING");
  }

  return { user, purpose, provider, tier, expectedAmount, declaredAmount, senderPhone, transactionRef, paidAt };
}

/** Enregistre la déclaration (statut EN ATTENTE). N'active rien. */
export async function declarePayment(userId: string, input: DeclareInput, proofImage: string | null = null) {
  const c = await checkDeclaration(userId, input);
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          reference: internalReference(c.purpose),
          userId,
          purpose: c.purpose,
          provider: c.provider.id,
          tierLevel: c.tier?.level ?? null,
          tierName: c.tier ? encodeBounded(c.tier.name, 60) : null,
          durationDays: c.tier?.durationDays ?? null,
          expectedAmount: c.expectedAmount,
          declaredAmount: c.declaredAmount,
          senderPhone: c.senderPhone,
          recipientPhone: c.provider.number,
          transactionRef: c.transactionRef,
          paidAt: c.paidAt,
          proofImage,
          country: c.user.country ? encodeBounded(c.user.country, 80) : null,
          countryCode: paymentCountryCode(c.user),
        },
      });
      await writeAuditLog(tx, {
        actorId: userId,
        action: "PAYMENT_DECLARED",
        entity: "Payment",
        entityId: payment.id,
        after: { reference: payment.reference, purpose: payment.purpose, provider: payment.provider, tierLevel: payment.tierLevel, expectedAmount: payment.expectedAmount, declaredAmount: payment.declaredAmount, transactionRef: payment.transactionRef },
      });
      return payment;
    });
  } catch (error) {
    // Course entre deux envois : les index uniques partiels tranchent.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new PaymentError("Cette référence est déjà déclarée, ou une déclaration est déjà en attente.", 409, "REFERENCE_USED");
    }
    throw error;
  }

  const admins = await prisma.user.findMany({ where: { isAdmin: true }, select: { id: true } });
  void notify(
    admins.map((a) => ({
      userId: a.id,
      type: "PAYMENT" as const,
      title: c.purpose === "PREMIUM" ? `Paiement Premium à vérifier : ${created.reference}` : `Don à vérifier : ${created.reference}`,
      body: `${c.user.username} · ${PROVIDER_LABELS[c.provider.id]} · ${formatCfa(c.declaredAmount)} · réf. ${c.transactionRef}`,
      link: "/admin?view=monetization",
    })),
  );
  return { reference: created.reference, status: created.status as PaymentStatus, id: created.id };
}

// ── Administration ──────────────────────────────────────────────────────

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Valide un paiement : vérifie qu'il est encore en attente, marque la
 * transaction payée et, pour un paiement Premium, active le niveau — le tout
 * dans une seule transaction. Une seconde validation échoue (statut déjà changé),
 * une référence déjà validée est refusée par l'index unique de la base.
 */
export async function validatePayment(adminId: string, paymentId: string, input: { receivedAmount: unknown }, now = new Date()) {
  const receivedAmount = asInt(input.receivedAmount);
  if (receivedAmount === null || receivedAmount <= 0) throw new PaymentError("Indiquez le montant réellement reçu sur le compte.");

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new PaymentError("Déclaration introuvable.", 404);
      if (payment.status !== "PENDING") throw new PaymentError("Cette déclaration a déjà été traitée.", 409, "ALREADY_PROCESSED");
      if (receivedAmount < payment.expectedAmount && payment.purpose === "PREMIUM") {
        throw new PaymentError(`Montant reçu inférieur au tarif (${formatCfa(payment.expectedAmount)}) : rejetez la déclaration avec le motif « Montant incorrect ».`, 409, "AMOUNT");
      }

      // Passage EN ATTENTE → VALIDÉ conditionnel : protège contre deux validations simultanées.
      const claimed = await tx.payment.updateMany({
        where: { id: paymentId, status: "PENDING" },
        data: { status: "VALIDATED", reviewedById: adminId, reviewedAt: now, receivedAmount },
      });
      if (claimed.count !== 1) throw new PaymentError("Cette déclaration a déjà été traitée.", 409, "ALREADY_PROCESSED");

      let period: { startsAt: Date; expiresAt: Date } | null = null;
      let before: Prisma.InputJsonValue | null = null;
      if (payment.purpose === "PREMIUM") {
        // Verrou de la ligne joueur : deux validations pour le même joueur s'enchaînent sans s'écraser.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${payment.userId} FOR UPDATE`;
        const user = await tx.user.findUniqueOrThrow({
          where: { id: payment.userId },
          select: { isPremium: true, premiumLevel: true, premiumExpiresAt: true },
        });
        if (!payment.tierLevel || !payment.durationDays) throw new PaymentError("Niveau Premium manquant sur la déclaration.", 409);
        period = premiumPeriod(user, { level: payment.tierLevel, durationDays: payment.durationDays }, now);
        if (!period) {
          throw new PaymentError("Le joueur a désormais un niveau supérieur actif : rejetez cette déclaration (motif « Autre ») et remboursez-le si nécessaire.", 409, "LOWER_TIER");
        }
        before = { isPremium: user.isPremium, premiumLevel: user.premiumLevel, premiumExpiresAt: user.premiumExpiresAt?.toISOString() ?? null };
        await tx.user.update({
          where: { id: payment.userId },
          data: { isPremium: true, premiumLevel: payment.tierLevel, premiumExpiresAt: period.expiresAt },
        });
        await tx.payment.update({
          where: { id: paymentId },
          data: { premiumStartsAt: period.startsAt, premiumExpiresAt: period.expiresAt },
        });
      }

      await writeAuditLog(tx, {
        actorId: adminId,
        action: payment.purpose === "PREMIUM" ? "PAYMENT_VALIDATED_PREMIUM" : "PAYMENT_VALIDATED_DONATION",
        entity: "Payment",
        entityId: paymentId,
        before: { status: "PENDING", user: before },
        after: {
          status: "VALIDATED",
          reference: payment.reference,
          transactionRef: payment.transactionRef,
          receivedAmount,
          tierLevel: payment.tierLevel,
          premiumStartsAt: period?.startsAt.toISOString() ?? null,
          premiumExpiresAt: period?.expiresAt.toISOString() ?? null,
        },
      });
      return { payment, period };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PaymentError("Cette référence de transaction a déjà été validée sur un autre paiement.", 409, "REFERENCE_USED");
    }
    throw error;
  }

  const { payment, period } = result;
  const fmtDate = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Douala" });
  await notify({
    userId: payment.userId,
    type: "PAYMENT",
    actorId: null,
    title: payment.purpose === "PREMIUM" ? `Paiement validé : Premium ${decodeFromDb(payment.tierName ?? "")} activé` : "Merci : votre don a été reçu",
    body:
      payment.purpose === "PREMIUM" && period
        ? `Votre abonnement est actif jusqu’au ${fmtDate(period.expiresAt)}. Référence ${payment.reference}.`
        : `Don de ${formatCfa(receivedAmount)} confirmé. Merci pour votre soutien ! Référence ${payment.reference}.`,
    link: payment.purpose === "PREMIUM" ? "/premium" : "/soutenir",
  });
  if (payment.purpose === "PREMIUM") void trackServer("premium_activated", payment.userId, { level: payment.tierLevel ?? 0 });
  return { status: "VALIDATED" as const, premiumStartsAt: period?.startsAt ?? null, premiumExpiresAt: period?.expiresAt ?? null };
}

export async function rejectPayment(adminId: string, paymentId: string, input: { reason: unknown; note?: unknown }, now = new Date()) {
  const reason = typeof input.reason === "string" && Object.hasOwn(REJECT_REASONS, input.reason) ? (input.reason as RejectReason) : null;
  if (!reason) throw new PaymentError("Le motif du rejet est obligatoire.");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) : "";
  if (reason === "OTHER" && note.length < 3) throw new PaymentError("Précisez le motif du rejet.");

  const payment = await prisma.$transaction(async (tx) => {
    const current = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!current) throw new PaymentError("Déclaration introuvable.", 404);
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "REJECTED", reviewedById: adminId, reviewedAt: now, rejectReason: reason, rejectNote: note ? encodeBounded(note, 300) : null },
    });
    if (claimed.count !== 1) throw new PaymentError("Cette déclaration a déjà été traitée.", 409, "ALREADY_PROCESSED");
    await writeAuditLog(tx, {
      actorId: adminId,
      action: "PAYMENT_REJECTED",
      entity: "Payment",
      entityId: paymentId,
      before: { status: "PENDING" },
      after: { status: "REJECTED", reason, note: note || null, reference: current.reference, transactionRef: current.transactionRef },
    });
    return current;
  });

  await notify({
    userId: payment.userId,
    type: "PAYMENT",
    actorId: null,
    title: payment.purpose === "PREMIUM" ? "Paiement Premium non validé" : "Don non confirmé",
    body: `${REJECT_REASONS[reason]}${note ? ` : ${note}` : ""}. Référence ${payment.reference}. Vous pouvez envoyer une nouvelle déclaration.`,
    link: payment.purpose === "PREMIUM" ? "/premium" : "/soutenir",
  });
  return { status: "REJECTED" as const };
}

// ── Lecture ─────────────────────────────────────────────────────────────

const LIST_SELECT = {
  id: true, reference: true, purpose: true, provider: true, status: true, tierLevel: true, tierName: true, durationDays: true,
  expectedAmount: true, declaredAmount: true, receivedAmount: true, currency: true, senderPhone: true, recipientPhone: true,
  transactionRef: true, paidAt: true, proofImage: true, country: true, countryCode: true, createdAt: true, reviewedAt: true,
  rejectReason: true, rejectNote: true, premiumStartsAt: true, premiumExpiresAt: true,
  user: { select: { id: true, username: true, email: true, country: true, verifiedCountryCode: true } },
  reviewedBy: { select: { username: true } },
} satisfies Prisma.PaymentSelect;

type ListRow = Prisma.PaymentGetPayload<{ select: typeof LIST_SELECT }>;

function serialize(row: ListRow) {
  return {
    ...row,
    tierName: row.tierName ? decodeFromDb(row.tierName) : null,
    country: row.country ? decodeFromDb(row.country) : null,
    rejectNote: row.rejectNote ? decodeFromDb(row.rejectNote) : null,
    hasProof: Boolean(row.proofImage),
    proofImage: undefined,
    user: { ...row.user, country: row.user.country ? decodeFromDb(row.user.country) : null },
    paidAt: row.paidAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    premiumStartsAt: row.premiumStartsAt?.toISOString() ?? null,
    premiumExpiresAt: row.premiumExpiresAt?.toISOString() ?? null,
    reviewedBy: row.reviewedBy?.username ?? null,
    amountMismatch: row.declaredAmount !== row.expectedAmount,
  };
}

export type AdminPayment = ReturnType<typeof serialize>;

export interface PaymentFilters {
  purpose?: string | null;
  status?: string | null;
  provider?: string | null;
  tierLevel?: number | null;
  from?: Date | null;
  to?: Date | null;
  q?: string | null;
  cursor?: string | null;
}

export async function listPayments(filters: PaymentFilters, limit = 30) {
  const where: Prisma.PaymentWhereInput = {};
  if (filters.purpose === "PREMIUM" || filters.purpose === "DONATION") where.purpose = filters.purpose;
  if (filters.status && ["PENDING", "VALIDATED", "REJECTED"].includes(filters.status)) where.status = filters.status;
  if (isProvider(filters.provider)) where.provider = filters.provider;
  if (filters.tierLevel) where.tierLevel = filters.tierLevel;
  if (filters.from || filters.to) where.createdAt = { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) };
  const q = filters.q?.trim();
  if (q) {
    const ref = q.replace(/\s+/g, "").toUpperCase();
    where.OR = [
      { reference: { contains: ref } },
      { transactionRef: { contains: ref } },
      { senderPhone: { contains: q.replace(/\D/g, "") || "__none__" } },
      { user: { username: { contains: q, mode: "insensitive" } } },
    ];
  }
  const rows = await prisma.payment.findMany({
    where,
    select: LIST_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(serialize);
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export async function getPaymentForAdmin(id: string) {
  const row = await prisma.payment.findUnique({ where: { id }, select: LIST_SELECT });
  if (!row) return null;
  const [sameRef, userHistory] = await Promise.all([
    prisma.payment.findMany({
      where: { transactionRef: row.transactionRef, NOT: { id } },
      select: { reference: true, status: true, provider: true, createdAt: true, user: { select: { username: true } } },
      take: 10,
    }),
    prisma.payment.groupBy({ by: ["status"], where: { userId: row.user.id, NOT: { id } }, _count: { _all: true } }),
  ]);
  return {
    ...serialize(row),
    sameReference: sameRef.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), username: r.user.username, user: undefined })),
    userHistory: Object.fromEntries(userHistory.map((g) => [g.status, g._count._all])),
  };
}

export async function getPaymentProofName(id: string) {
  const row = await prisma.payment.findUnique({ where: { id }, select: { proofImage: true } });
  return row?.proofImage ?? null;
}

/** Déclarations du joueur lui-même (suivi). */
export async function myPayments(userId: string) {
  const rows = await prisma.payment.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      reference: true, purpose: true, provider: true, status: true, tierName: true, expectedAmount: true, declaredAmount: true,
      transactionRef: true, createdAt: true, reviewedAt: true, rejectReason: true, rejectNote: true, premiumExpiresAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    tierName: r.tierName ? decodeFromDb(r.tierName) : null,
    rejectNote: r.rejectNote ? decodeFromDb(r.rejectNote) : null,
    rejectLabel: r.rejectReason && Object.hasOwn(REJECT_REASONS, r.rejectReason) ? REJECT_REASONS[r.rejectReason as RejectReason] : null,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    premiumExpiresAt: r.premiumExpiresAt?.toISOString() ?? null,
  }));
}

/** Pays confirmé par l'administration (contrôle du pays déclaré). */
export async function setVerifiedCountry(adminId: string, userId: string, code: unknown) {
  const value = code === null || code === "" ? null : typeof code === "string" && /^[A-Z]{2}$/.test(code) ? code : undefined;
  if (value === undefined) throw new PaymentError("Code pays ISO à deux lettres attendu (ex. CM).");
  await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: userId }, select: { verifiedCountryCode: true } });
    if (!before) throw new PaymentError("Joueur introuvable.", 404);
    await tx.user.update({ where: { id: userId }, data: { verifiedCountryCode: value } });
    await writeAuditLog(tx, { actorId: adminId, action: "USER_COUNTRY_VERIFIED", entity: "User", entityId: userId, before, after: { verifiedCountryCode: value } });
  });
  return { verifiedCountryCode: value };
}

export async function launchSettings() {
  const date = await getSetting("payments.internationalLaunchDate");
  return { date, label: launchLabel(date) };
}
