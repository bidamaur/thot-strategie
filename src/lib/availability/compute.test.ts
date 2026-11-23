import { describe, expect, it } from "vitest";
import { buildHeatmap, normalizeWeekly, zonedToUtc, type PlayerSchedule, type Weekly } from "./compute";

const week = (slots: Partial<Record<string, [string, string][]>>): Weekly => ({ "1": [], "2": [], "3": [], "4": [], "5": [], "6": [], "7": [], ...slots }) as Weekly;
// Mercredi 18 novembre 2026, 08:00 UTC (09:00 à Douala).
const NOW = Date.UTC(2026, 10, 18, 8, 0);

describe("disponibilités : saisie", () => {
  it("plusieurs plages par jour, triées et fusionnées si elles se chevauchent", () => {
    const r = normalizeWeekly(week({ "6": [["15:00", "20:00"], ["09:00", "12:00"], ["11:00", "13:00"]] }));
    expect(r.ok && r.value["6"]).toEqual([["09:00", "13:00"], ["15:00", "20:00"]]);
  });
  it("refuse une fin avant le début, une heure invalide, trop de plages", () => {
    expect(normalizeWeekly(week({ "1": [["21:00", "18:00"]] })).ok).toBe(false);
    expect(normalizeWeekly(week({ "1": [["25:00", "26:00"]] })).ok).toBe(false);
    expect(normalizeWeekly(week({ "1": Array.from({ length: 7 }, (_, i) => [`0${i}:00`, `0${i}:30`] as [string, string]) })).ok).toBe(false);
    expect(normalizeWeekly(week({ "5": [["20:00", "24:00"]] })).ok).toBe(true);
  });
});

describe("disponibilités : fuseaux horaires", () => {
  it("heure locale → instant UTC (Douala UTC+1, Paris UTC+1 en hiver, New York UTC-5)", () => {
    expect(zonedToUtc(2026, 11, 23, 18 * 60, "Africa/Douala")).toBe(Date.UTC(2026, 10, 23, 17, 0));
    expect(zonedToUtc(2026, 11, 23, 18 * 60, "America/New_York")).toBe(Date.UTC(2026, 10, 23, 23, 0));
    // Été à Paris : UTC+2.
    expect(zonedToUtc(2026, 7, 1, 18 * 60, "Europe/Paris")).toBe(Date.UTC(2026, 6, 1, 16, 0));
  });
});

describe("disponibilités : synthèse d'un tournoi", () => {
  const douala = (w: Weekly, extra: Partial<PlayerSchedule> = {}): PlayerSchedule => ({ timeZone: "Africa/Douala", weekly: w, ...extra });

  it("compte les joueurs disponibles par jour et par heure ; meilleurs créneaux en tête", () => {
    const players = [
      douala(week({ "1": [["18:00", "21:00"]] })),
      douala(week({ "1": [["19:00", "22:00"]] })),
      douala(week({ "1": [["20:00", "21:00"]], "4": [["18:00", "20:00"]] })),
    ];
    const m = buildHeatmap(players, 5, "Africa/Douala", NOW);
    const monday = m.rows.find((r) => r.weekday === 1)!;
    expect(monday.counts.slice(17, 23)).toEqual([0, 1, 2, 3, 1, 0]);
    expect(m.rows.find((r) => r.weekday === 4)!.counts.slice(18, 20)).toEqual([1, 1]);
    expect(m.participants).toBe(5);
    expect(m.withAvailability).toBe(3);
    expect(m.best[0]).toMatchObject({ weekday: 1, from: 20, to: 21, count: 3 });
    expect(m.rows.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("deux fuseaux différents sont comparés sur le même instant", () => {
    // 13:00–15:00 à New York = 19:00–21:00 à Douala.
    const players = [
      douala(week({ "2": [["19:00", "21:00"]] })),
      { timeZone: "America/New_York", weekly: week({ "2": [["13:00", "15:00"]] }) },
    ];
    const m = buildHeatmap(players, 2, "Africa/Douala", NOW);
    expect(m.rows.find((r) => r.weekday === 2)!.counts.slice(18, 22)).toEqual([0, 2, 2, 0]);
    // Vu depuis New York, le même créneau apparaît à 13h–15h.
    const ny = buildHeatmap(players, 2, "America/New_York", NOW);
    expect(ny.rows.find((r) => r.weekday === 2)!.counts.slice(12, 16)).toEqual([0, 2, 2, 0]);
  });

  it("la modification temporaire remplace la semaine habituelle sur sa période", () => {
    const p = douala(week({ "5": [["18:00", "22:00"]] }), {
      overrideFrom: "2026-11-20",
      overrideTo: "2026-11-20",
      overrideWeekly: week({}), // indisponible ce vendredi-là
    });
    const m = buildHeatmap([p], 1, "Africa/Douala", NOW);
    expect(m.rows.find((r) => r.weekday === 5)!.counts.every((c) => c === 0)).toBe(true);
    expect(m.max).toBe(0);
  });
});
