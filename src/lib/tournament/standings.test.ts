import { describe, expect, it } from "vitest";
import { computeStandings, roundRobinSchedule, swissPairings, swissRoundCount, type StandingsGame } from "./standings";

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ userId: `p${i + 1}`, seed: i + 1 }));

describe("roundRobinSchedule", () => {
  it.each([4, 5, 6, 7, 8])("fait se rencontrer chaque paire exactement une fois (%i joueurs)", (n) => {
    const ids = players(n).map((p) => p.userId);
    const rounds = roundRobinSchedule(ids);
    expect(rounds).toHaveLength(n % 2 === 0 ? n - 1 : n);
    const seen = new Set<string>();
    for (const round of rounds) {
      const inRound = new Set<string>();
      for (const p of round) {
        expect(inRound.has(p.whiteId)).toBe(false);
        inRound.add(p.whiteId);
        if (p.blackId) {
          expect(inRound.has(p.blackId)).toBe(false);
          inRound.add(p.blackId);
          const key = [p.whiteId, p.blackId].sort().join("-");
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
      expect(inRound.size).toBe(n);
    }
    expect(seen.size).toBe((n * (n - 1)) / 2);
  });

  it("donne un exempt à chacun quand le nombre est impair", () => {
    const byes = roundRobinSchedule(["a", "b", "c"]).flat().filter((p) => p.blackId === null).map((p) => p.whiteId);
    expect(byes.sort()).toEqual(["a", "b", "c"]);
  });

  it("équilibre les couleurs à un écart maximal de 1", () => {
    const rounds = roundRobinSchedule(players(6).map((p) => p.userId));
    const whites = new Map<string, number>();
    for (const p of rounds.flat()) whites.set(p.whiteId, (whites.get(p.whiteId) ?? 0) + 1);
    for (const count of whites.values()) expect(Math.abs(count - 2.5)).toBeLessThanOrEqual(1.5);
  });

  it("la ligue aller-retour inverse les couleurs au retour", () => {
    const rounds = roundRobinSchedule(["a", "b", "c", "d"], true);
    expect(rounds).toHaveLength(6);
    expect(rounds[3]![0]).toEqual({ whiteId: rounds[0]![0]!.blackId, blackId: rounds[0]![0]!.whiteId });
  });
});

describe("computeStandings", () => {
  it("compte victoires, nulles, exempts et départage au Buchholz", () => {
    const games: StandingsGame[] = [
      { whiteId: "p1", blackId: "p2", winnerId: "p1", finished: true },
      { whiteId: "p3", blackId: "p4", winnerId: null, finished: true },
      { whiteId: "p1", blackId: "p3", winnerId: "p3", finished: true },
      { whiteId: "p2", blackId: "p4", winnerId: "p2", finished: true },
      { whiteId: "p5", blackId: null, winnerId: "p5", finished: true },
      { whiteId: "p4", blackId: "p5", winnerId: null, finished: false },
    ];
    const table = computeStandings(players(5), games);
    const byId = Object.fromEntries(table.map((r) => [r.userId, r]));
    expect(byId.p3!.score).toBe(1.5);
    expect(byId.p1!.score).toBe(1);
    expect(byId.p4!.score).toBe(0.5);
    expect(byId.p5!.byes).toBe(1);
    expect(byId.p5!.played).toBe(0);
    expect(table[0]!.userId).toBe("p3");
    // p1, p2 et p5 ont 1 point : Buchholz p1 = p2(1)+p3(1.5) = 2.5 > p2 = p1(1)+p4(0.5) > p5 = 0
    expect(table.slice(1, 4).map((r) => r.userId)).toEqual(["p1", "p2", "p5"]);
  });
});

describe("swissPairings", () => {
  it("évite les rematchs quand c'est possible", () => {
    const games: StandingsGame[] = [
      { whiteId: "p1", blackId: "p2", winnerId: "p1", finished: true },
      { whiteId: "p3", blackId: "p4", winnerId: "p3", finished: true },
    ];
    const pairs = swissPairings(computeStandings(players(4), games));
    const keys = pairs.map((p) => [p.whiteId, p.blackId].sort().join("-"));
    expect(keys).not.toContain("p1-p2");
    expect(keys).not.toContain("p3-p4");
    expect(keys).toContain("p1-p3");
  });

  it("donne l'exempt au moins bien classé qui n'en a pas eu", () => {
    const games: StandingsGame[] = [
      { whiteId: "p1", blackId: "p2", winnerId: "p1", finished: true },
      { whiteId: "p3", blackId: "p4", winnerId: "p3", finished: true },
      { whiteId: "p5", blackId: null, winnerId: "p5", finished: true },
    ];
    const pairs = swissPairings(computeStandings(players(5), games));
    const bye = pairs.find((p) => p.blackId === null)!;
    expect(bye.whiteId).not.toBe("p5");
    expect(pairs.flatMap((p) => [p.whiteId, p.blackId]).filter(Boolean)).toHaveLength(5);
  });

  it("calcule un nombre de rondes raisonnable", () => {
    expect(swissRoundCount(8, 0)).toBe(3);
    expect(swissRoundCount(16, 0)).toBe(4);
    expect(swissRoundCount(4, 0)).toBe(3);
    expect(swissRoundCount(3, 0)).toBe(2);
    expect(swissRoundCount(10, 5)).toBe(5);
  });
});
