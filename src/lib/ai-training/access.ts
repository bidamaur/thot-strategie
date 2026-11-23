import { Prisma } from "@/generated/prisma-client";
import { notify } from "@/lib/community/notifications";
import { DIFFICULTIES, SUPER_LEVEL, type Difficulty } from "@/lib/engine/game-settings";
import { getPrivileges } from "@/lib/premium/privileges";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";

/**
 * Accès aux niveaux de l'IA d'entraînement :
 *  - offre gratuite : niveaux 1 à `ai.freeMaxLevel` (3 par défaut) ;
 *  - Premium (tout niveau) et administrateurs : niveaux 1 à 5 ;
 *  - essai offert : une partie par jour contre le niveau 5, après une publicité
 *    dont la durée est contrôlée par le serveur (`ai.trialAdSeconds`).
 * Le jour est celui du Cameroun (Africa/Douala).
 */

export class AiAccessError extends Error {
  constructor(message: string, public status = 403, public code = "FORBIDDEN") {
    super(message);
    this.name = "AiAccessError";
  }
}

export function trialDay(now = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: "Africa/Douala" });
}

interface Subject {
  id: string;
  isAdmin: boolean;
  isPremium: boolean;
  premiumLevel: number;
  premiumExpiresAt: Date | null;
}

const SUBJECT_SELECT = { id: true, isAdmin: true, isPremium: true, premiumLevel: true, premiumExpiresAt: true } as const;

export interface AiAccess {
  loggedIn: boolean;
  premium: boolean;
  maxLevel: Difficulty;
  freeMaxLevel: Difficulty;
  trial: { enabled: boolean; available: boolean; usedToday: boolean; adSeconds: number };
}

async function loadSubject(userId: string | null): Promise<Subject | null> {
  return userId ? prisma.user.findUnique({ where: { id: userId }, select: SUBJECT_SELECT }) : null;
}

export async function getAiAccess(userId: string | null, now = new Date()): Promise<AiAccess> {
  const [s, user] = await Promise.all([getSettings(["ai.freeMaxLevel", "ai.dailyTrialEnabled", "ai.trialAdSeconds"] as const), loadSubject(userId)]);
  const freeMaxLevel = Math.min(5, Math.max(1, s["ai.freeMaxLevel"])) as Difficulty;
  const premium = user ? user.isAdmin || (await getPrivileges(user)).level > 0 : false;
  const trialRow = user && !premium ? await prisma.aiDailyTrial.findUnique({ where: { userId_day: { userId: user.id, day: trialDay(now) } }, select: { usedAt: true } }) : null;
  const usedToday = Boolean(trialRow?.usedAt);
  const enabled = s["ai.dailyTrialEnabled"] && freeMaxLevel < SUPER_LEVEL;
  return {
    loggedIn: Boolean(user),
    premium,
    maxLevel: premium ? 5 : freeMaxLevel,
    freeMaxLevel,
    trial: { enabled, available: Boolean(user) && !premium && enabled && !usedToday, usedToday, adSeconds: s["ai.trialAdSeconds"] },
  };
}

/** Démarre la publicité de l'essai du jour (horodatage serveur, conservé si déjà démarré). */
export async function startTrialAd(userId: string, now = new Date()) {
  const access = await getAiAccess(userId, now);
  if (access.premium) throw new AiAccessError("Votre niveau Premium donne déjà accès au niveau 5.", 409, "PREMIUM");
  if (!access.trial.enabled) throw new AiAccessError("L’essai offert n’est pas proposé actuellement.", 403, "DISABLED");
  if (access.trial.usedToday) throw new AiAccessError("Votre essai du jour a déjà été utilisé. Revenez demain !", 409, "USED");
  const day = trialDay(now);
  await prisma.aiDailyTrial.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, adStartedAt: now },
    update: {},
  });
  // Premier démarrage de la publicité uniquement (un rechargement ne la relance pas à zéro).
  await prisma.aiDailyTrial.updateMany({ where: { userId, day, adStartedAt: null }, data: { adStartedAt: now } });
  const row = await prisma.aiDailyTrial.findUniqueOrThrow({ where: { userId_day: { userId, day } }, select: { adStartedAt: true } });
  const endsAt = new Date(row.adStartedAt!.getTime() + access.trial.adSeconds * 1000);
  return { adSeconds: access.trial.adSeconds, adEndsAt: endsAt.toISOString(), remainingMs: Math.max(0, endsAt.getTime() - now.getTime()) };
}

/**
 * Consomme l'essai : refusé tant que la publicité n'a pas duré le temps prévu,
 * et une seule fois par jour (mise à jour conditionnelle : deux onglets ne
 * peuvent pas lancer deux parties).
 */
export async function consumeTrial(userId: string, gameType: "CHESS" | "CHECKERS", now = new Date()) {
  const access = await getAiAccess(userId, now);
  if (access.premium) return { premium: true };
  if (!access.trial.enabled) throw new AiAccessError("L’essai offert n’est pas proposé actuellement.", 403, "DISABLED");
  const day = trialDay(now);
  const row = await prisma.aiDailyTrial.findUnique({ where: { userId_day: { userId, day } } });
  if (!row?.adStartedAt) throw new AiAccessError("Regardez d’abord la publicité pour débloquer votre partie.", 409, "AD_REQUIRED");
  if (row.usedAt) throw new AiAccessError("Votre essai du jour a déjà été utilisé. Revenez demain !", 409, "USED");
  const waitMs = row.adStartedAt.getTime() + access.trial.adSeconds * 1000 - now.getTime();
  // Tolérance d'une seconde (décalage d'horloge et latence réseau).
  if (waitMs > 1000) throw new AiAccessError(`Encore ${Math.ceil(waitMs / 1000)} s de publicité avant de jouer.`, 409, "AD_NOT_FINISHED");
  const claimed = await prisma.aiDailyTrial.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now, gameType } });
  if (claimed.count !== 1) throw new AiAccessError("Votre essai du jour a déjà été utilisé. Revenez demain !", 409, "USED");
  return { premium: false, usedAt: now.toISOString() };
}

const noticeChecked = new Map<string, string>();

/**
 * Notification quotidienne « une partie contre le niveau 5 vous attend » pour
 * les joueurs gratuits. Au plus une par jour (garanti par la base) ; appelée
 * lors du relevé des notifications, avec un mémo en mémoire pour éviter une
 * requête à chaque relevé.
 */
export async function ensureDailyTrialNotice(userId: string, now = new Date()): Promise<boolean> {
  const day = trialDay(now);
  if (noticeChecked.get(userId) === day) return false;
  const access = await getAiAccess(userId, now);
  noticeChecked.set(userId, day);
  if (noticeChecked.size > 50_000) noticeChecked.clear();
  if (!access.trial.available) return false;
  try {
    await prisma.aiDailyTrial.create({ data: { userId, day } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }
  const claimed = await prisma.aiDailyTrial.updateMany({ where: { userId, day, notifiedAt: null, usedAt: null }, data: { notifiedAt: now } });
  if (claimed.count !== 1) return false;
  const label = DIFFICULTIES.find((d) => d.value === SUPER_LEVEL)?.label ?? "Niveau 5";
  await notify({
    userId,
    type: "AI_TRIAL",
    title: "Votre partie offerte contre le niveau super vous attend",
    body: `Aujourd’hui, affrontez l’IA ${label} gratuitement (une partie par jour).`,
    link: "/match/ia",
  });
  return true;
}
