import { Prisma } from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import {
  buildHeatmap,
  DAY_KEYS,
  isValidTimeZone,
  normalizeWeekly,
  readWeekly,
  type PlayerSchedule,
  type Weekly,
} from "./compute";

export class AvailabilityError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "AvailabilityError";
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const emptyWeek = (): Weekly => Object.fromEntries(DAY_KEYS.map((k) => [k, []]));

export async function getMyAvailability(userId: string) {
  const row = await prisma.playerAvailability.findUnique({ where: { userId } });
  if (!row) return { saved: false, timeZone: null, weekly: emptyWeek(), override: null, updatedAt: null };
  return {
    saved: true,
    timeZone: row.timeZone,
    weekly: readWeekly(row.weekly),
    override:
      row.overrideFrom && row.overrideTo && row.overrideWeekly
        ? { from: isoOf(row.overrideFrom)!, to: isoOf(row.overrideTo)!, weekly: readWeekly(row.overrideWeekly) }
        : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveAvailability(
  userId: string,
  input: { timeZone: unknown; weekly: unknown; override?: { from?: unknown; to?: unknown; weekly?: unknown } | null },
) {
  if (!isValidTimeZone(input.timeZone)) throw new AvailabilityError("Fuseau horaire inconnu.");
  const weekly = normalizeWeekly(input.weekly);
  if (!weekly.ok) throw new AvailabilityError(weekly.error);

  let override: { from: Date; to: Date; weekly: Weekly } | null = null;
  if (input.override) {
    const { from, to } = input.override;
    if (typeof from !== "string" || typeof to !== "string" || !DATE.test(from) || !DATE.test(to)) {
      throw new AvailabilityError("Modification temporaire : dates de début et de fin requises.");
    }
    if (to < from) throw new AvailabilityError("Modification temporaire : la date de fin doit suivre la date de début.");
    const span = (toDate(to).getTime() - toDate(from).getTime()) / 86_400_000;
    if (span > 90) throw new AvailabilityError("Modification temporaire : 90 jours au maximum.");
    const w = normalizeWeekly(input.override.weekly ?? {});
    if (!w.ok) throw new AvailabilityError(`Modification temporaire — ${w.error}`);
    override = { from: toDate(from), to: toDate(to), weekly: w.value };
  }

  const data = {
    timeZone: input.timeZone,
    weekly: weekly.value,
    overrideFrom: override?.from ?? null,
    overrideTo: override?.to ?? null,
    overrideWeekly: override ? override.weekly : Prisma.DbNull,
  };
  await prisma.playerAvailability.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return getMyAvailability(userId);
}

export async function clearAvailability(userId: string) {
  await prisma.playerAvailability.deleteMany({ where: { userId } });
}

/**
 * Synthèse des disponibilités des participants d'un tournoi qui n'a pas encore
 * commencé. Réservée aux participants, à l'organisateur et aux administrateurs.
 * Ne renvoie que des nombres ; n'agit jamais sur les horaires du tournoi.
 */
export async function tournamentAvailability(tournamentId: string, viewer: { id: string; isAdmin: boolean }, viewerTz: unknown, now = new Date()) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, status: true, creatorId: true, participants: { select: { userId: true, status: true } } },
  });
  if (!tournament) throw new AvailabilityError("Tournoi introuvable.", 404);
  // Filtre en mémoire : la colonne de statut est stockée en texte sur certaines bases (écart historique).
  const ids = tournament.participants.filter((p) => String(p.status) !== "WITHDRAWN").map((p) => p.userId);
  if (!viewer.isAdmin && tournament.creatorId !== viewer.id && !ids.includes(viewer.id)) {
    throw new AvailabilityError("Réservé aux participants et à l’organisateur du tournoi.", 403);
  }
  if (tournament.status !== "DRAFT" && tournament.status !== "OPEN") {
    return { available: false as const, reason: "Le tournoi a déjà commencé." };
  }
  const tz = isValidTimeZone(viewerTz) ? viewerTz : "Africa/Douala";
  const rows = ids.length ? await prisma.playerAvailability.findMany({ where: { userId: { in: ids } } }) : [];
  const schedules: PlayerSchedule[] = rows
    .filter((r) => isValidTimeZone(r.timeZone))
    .map((r) => ({
      timeZone: r.timeZone,
      weekly: readWeekly(r.weekly),
      overrideFrom: isoOf(r.overrideFrom),
      overrideTo: isoOf(r.overrideTo),
      overrideWeekly: r.overrideWeekly ? readWeekly(r.overrideWeekly) : null,
    }));
  return { available: true as const, heatmap: buildHeatmap(schedules, ids.length, tz, now.getTime()) };
}
