/**
 * Disponibilités hebdomadaires (strictement indicatives) — calculs purs.
 *
 * Chaque joueur saisit ses plages dans SON fuseau horaire. La synthèse d'un
 * tournoi convertit toutes les plages en instants réels (UTC) sur les 7
 * prochains jours, puis les compte dans les cases horaires du fuseau du LECTEUR :
 * deux joueurs de fuseaux différents sont donc comparés correctement.
 */

export type Slot = [string, string]; // ["18:00", "21:00"], fin "24:00" autorisée
export type Weekly = Record<string, Slot[]>; // "1" = lundi … "7" = dimanche

export const DAY_KEYS = ["1", "2", "3", "4", "5", "6", "7"] as const;
export const DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
export const MAX_SLOTS_PER_DAY = 6;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

export function toMinutes(time: string): number {
  if (time === "24:00") return 1440;
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + m!;
}

export function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length > 64 || !/^[A-Za-z_+\-/0-9]+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Valide et normalise une semaine : heures valides, début < fin, plages
 * triées et fusionnées si elles se chevauchent, au plus 6 plages par jour.
 */
export function normalizeWeekly(input: unknown): { ok: true; value: Weekly } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "Semaine invalide." };
  const out: Weekly = {};
  for (const key of DAY_KEYS) {
    const raw = (input as Record<string, unknown>)[key] ?? [];
    if (!Array.isArray(raw)) return { ok: false, error: `${DAY_LABELS[Number(key) - 1]} : liste de plages attendue.` };
    if (raw.length > MAX_SLOTS_PER_DAY) return { ok: false, error: `${DAY_LABELS[Number(key) - 1]} : ${MAX_SLOTS_PER_DAY} plages au maximum.` };
    const slots: [number, number][] = [];
    for (const slot of raw) {
      if (!Array.isArray(slot) || slot.length !== 2 || typeof slot[0] !== "string" || typeof slot[1] !== "string" || !TIME.test(slot[0]) || !TIME.test(slot[1])) {
        return { ok: false, error: `${DAY_LABELS[Number(key) - 1]} : heure invalide (format HH:MM).` };
      }
      const start = toMinutes(slot[0]);
      const end = toMinutes(slot[1]);
      if (start >= end) return { ok: false, error: `${DAY_LABELS[Number(key) - 1]} : l’heure de fin doit suivre l’heure de début (${slot[0]} – ${slot[1]}).` };
      slots.push([start, end]);
    }
    slots.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const s of slots) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
      else merged.push([...s]);
    }
    out[key] = merged.map(([a, b]) => [fromMinutes(a), fromMinutes(b)]);
  }
  return { ok: true, value: out };
}

/** Semaine stockée → semaine utilisable (invalide = vide, jamais d'erreur à la lecture). */
export function readWeekly(raw: unknown): Weekly {
  const r = normalizeWeekly(raw ?? {});
  return r.ok ? r.value : Object.fromEntries(DAY_KEYS.map((k) => [k, []]));
}

// ── Fuseaux horaires (Intl, sans dépendance) ────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function zonedParts(utcMs: number, tz: string) {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second),
    weekday: WEEKDAY[p.weekday as string] ?? 1,
  };
}

function offsetMs(utcMs: number, tz: string): number {
  const p = zonedParts(utcMs, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** Instant UTC d'une heure locale (minutes depuis minuit) à une date locale donnée. */
export function zonedToUtc(year: number, month: number, day: number, minutes: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  const first = offsetMs(guess, tz);
  let t = guess - first;
  const second = offsetMs(t, tz);
  if (second !== first) t = guess - second;
  return t;
}

/** "YYYY-MM-DD" d'un jour civil (calcul en UTC, sans fuseau). */
function isoDay(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(year: number, month: number, day: number, n: number) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: ((d.getUTCDay() + 6) % 7) + 1 };
}

export interface PlayerSchedule {
  timeZone: string;
  weekly: Weekly;
  overrideFrom?: string | null; // YYYY-MM-DD
  overrideTo?: string | null;
  overrideWeekly?: Weekly | null;
}

/** Plages effectives d'un jour local (modification temporaire prioritaire). */
export function slotsForDay(s: PlayerSchedule, date: string, weekday: number): Slot[] {
  const inOverride = s.overrideFrom && s.overrideTo && s.overrideWeekly && date >= s.overrideFrom && date <= s.overrideTo;
  const week = inOverride ? s.overrideWeekly! : s.weekly;
  return week[String(weekday)] ?? [];
}

/** Intervalles UTC [début, fin) où le joueur est disponible sur les `days` prochains jours. */
export function utcIntervals(s: PlayerSchedule, nowMs: number, days = 8): [number, number][] {
  const today = zonedParts(nowMs, s.timeZone);
  const out: [number, number][] = [];
  // On part de la veille pour couvrir les fuseaux en avance sur le lecteur.
  for (let i = -1; i < days; i += 1) {
    const d = addDays(today.year, today.month, today.day, i);
    for (const [a, b] of slotsForDay(s, isoDay(d.year, d.month, d.day), d.weekday)) {
      out.push([zonedToUtc(d.year, d.month, d.day, toMinutes(a), s.timeZone), zonedToUtc(d.year, d.month, d.day, toMinutes(b), s.timeZone)]);
    }
  }
  return out;
}

export interface HeatmapRow {
  weekday: number; // 1 = lundi
  label: string;
  date: string; // date locale du lecteur
  counts: number[]; // 24 cases horaires
}

export interface Heatmap {
  timeZone: string;
  participants: number;
  withAvailability: number;
  rows: HeatmapRow[];
  /** Heures affichées (au moins une disponibilité, sinon 8h–23h). */
  hours: number[];
  max: number;
  best: { weekday: number; label: string; date: string; from: number; to: number; count: number }[];
}

/** Présence comptée dans une case horaire si la disponibilité la couvre au moins 30 minutes. */
const MIN_OVERLAP_MS = 30 * 60_000;

/**
 * Synthèse collective, dans le fuseau du lecteur, pour les 7 prochains jours
 * (classés du lundi au dimanche). Ne contient que des nombres, jamais d'identité.
 */
export function buildHeatmap(schedules: PlayerSchedule[], participants: number, viewerTz: string, nowMs: number): Heatmap {
  const intervals = schedules.map((s) => utcIntervals(s, nowMs));
  const today = zonedParts(nowMs, viewerTz);
  const rows: HeatmapRow[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(today.year, today.month, today.day, i);
    const counts = Array.from({ length: 24 }, (_, hour) => {
      const start = zonedToUtc(d.year, d.month, d.day, hour * 60, viewerTz);
      const end = zonedToUtc(d.year, d.month, d.day, hour * 60 + 60, viewerTz);
      let n = 0;
      for (const list of intervals) {
        let covered = 0;
        for (const [a, b] of list) covered += Math.max(0, Math.min(b, end) - Math.max(a, start));
        if (covered >= Math.min(MIN_OVERLAP_MS, end - start)) n += 1;
      }
      return n;
    });
    rows.push({ weekday: d.weekday, label: DAY_LABELS[d.weekday - 1]!, date: isoDay(d.year, d.month, d.day), counts });
  }
  rows.sort((a, b) => a.weekday - b.weekday);

  const max = Math.max(0, ...rows.flatMap((r) => r.counts));
  const used = Array.from({ length: 24 }, (_, h) => h).filter((h) => rows.some((r) => r.counts[h]! > 0));
  const hours = used.length ? Array.from({ length: used[used.length - 1]! - used[0]! + 1 }, (_, i) => used[0]! + i) : Array.from({ length: 16 }, (_, i) => i + 8);

  // Meilleurs créneaux : heures consécutives d'un même jour au niveau de disponibilité le plus élevé.
  const ranges: Heatmap["best"] = [];
  for (const r of rows) {
    let h = 0;
    while (h < 24) {
      const c = r.counts[h]!;
      if (c === 0) {
        h += 1;
        continue;
      }
      let e = h + 1;
      while (e < 24 && r.counts[e] === c) e += 1;
      ranges.push({ weekday: r.weekday, label: r.label, date: r.date, from: h, to: e, count: c });
      h = e;
    }
  }
  ranges.sort((a, b) => b.count - a.count || b.to - b.from - (a.to - a.from) || a.weekday - b.weekday || a.from - b.from);

  return {
    timeZone: viewerTz,
    participants,
    withAvailability: schedules.length,
    rows,
    hours,
    max,
    best: ranges.slice(0, 5),
  };
}
