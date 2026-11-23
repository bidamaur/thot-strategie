import { describe, expect, it } from "vitest";
import { percentiles, rankComposite } from "./composite";

const p = (id: string, elo: number, points: number, day = 1) => ({ id, elo, points, createdAt: new Date(2026, 0, day) });

describe("classement composite (indice Thot)", () => {
  it("rang-centile : 0 pour le dernier, 1 pour le premier, ex æquo au rang moyen", () => {
    expect(percentiles([10, 20, 30])).toEqual([0, 0.5, 1]);
    expect(percentiles([5, 5, 9])).toEqual([0.25, 0.25, 1]);
    expect(percentiles([42])).toEqual([1]);
    expect(percentiles([])).toEqual([]);
  });

  it("combine ELO et points selon les poids, indice sur 1000", () => {
    const players = [p("a", 1600, 100), p("b", 1400, 900), p("c", 1200, 500)];
    // 60 % ELO : b (2e ELO, 1er aux points) = 0,6×0,5 + 0,4×1 = 700 ; a = 0,6×1 + 0,4×0 = 600 ; c = 0,4×0,5 = 200.
    const balanced = rankComposite(players, 60);
    expect(balanced.map((r) => [r.player.id, r.index])).toEqual([["b", 700], ["a", 600], ["c", 200]]);
    // 100 % ELO : l'ordre de l'ELO pur.
    expect(rankComposite(players, 100).map((r) => r.player.id)).toEqual(["a", "b", "c"]);
    // 0 % ELO : l'ordre des points pur.
    expect(rankComposite(players, 0).map((r) => r.player.id)).toEqual(["b", "c", "a"]);
  });

  it("insensible aux valeurs extrêmes : un énorme solde ne compte pas plus qu'être premier aux points", () => {
    const normal = rankComposite([p("a", 1500, 1000), p("b", 1450, 2000)], 50);
    const extreme = rankComposite([p("a", 1500, 1000), p("b", 1450, 2_000_000)], 50);
    expect(normal.map((r) => r.index)).toEqual(extreme.map((r) => r.index));
  });

  it("égalité d'indice : ELO, puis points, puis ancienneté", () => {
    const ranked = rankComposite([p("jeune", 1500, 10, 5), p("ancien", 1500, 10, 1)], 50);
    expect(ranked.map((r) => r.player.id)).toEqual(["ancien", "jeune"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("limite le nombre de joueurs renvoyés (Top 20, Top 10)", () => {
    const many = Array.from({ length: 30 }, (_, i) => p(`p${i}`, 1000 + i, i));
    expect(rankComposite(many, 60, 20)).toHaveLength(20);
    expect(rankComposite(many, 60, 20)[0]!.player.id).toBe("p29");
  });
});
