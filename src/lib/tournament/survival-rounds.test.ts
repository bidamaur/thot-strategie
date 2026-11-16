import { describe, expect, it } from "vitest";
import { survivalPairings, survivalPayout, survivalRanking, survivalStake } from "./survival-rounds";

const p = (userId: string, capital: number, lastOpponentId: string | null = null, byes = 0) => ({
  userId,
  capital,
  lastOpponentId,
  byes,
});

describe("survivalStake", () => {
  it("mise fixe = mise minimale", () => {
    expect(survivalStake("FIXED", 10, 100, 500, 40)).toBe(10);
  });
  it("mise variable plafonnée au plus petit capital et à la mise max", () => {
    expect(survivalStake("VARIABLE", 10, 100, 500, 40)).toBe(40);
    expect(survivalStake("VARIABLE", 10, 100, 500, 400)).toBe(100);
  });
});

describe("survivalPairings", () => {
  const rules = { mode: "FIXED" as const, minBet: 10, maxBet: 50 };

  it("n'apparie que les joueurs qui peuvent encore miser", () => {
    const pairs = survivalPairings([p("a", 50), p("b", 50), p("c", 5)], rules);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.blackId).not.toBeNull();
  });

  it("donne le repos au plus petit capital en cas de nombre impair", () => {
    const pairs = survivalPairings([p("a", 90), p("b", 60), p("c", 30)], rules);
    expect(pairs.find((x) => x.blackId === null)?.whiteId).toBe("c");
  });

  it("répartit les repos équitablement", () => {
    const pairs = survivalPairings([p("a", 90), p("b", 60), p("c", 30, null, 1)], rules);
    expect(pairs.find((x) => x.blackId === null)?.whiteId).toBe("b");
  });

  it("évite de rejouer aussitôt le même adversaire", () => {
    const pairs = survivalPairings([p("a", 100, "b"), p("b", 90, "a"), p("c", 80, "d"), p("d", 70, "c")], rules);
    const keys = pairs.map((x) => [x.whiteId, x.blackId].sort().join("-"));
    expect(keys).not.toContain("a-b");
    expect(keys).not.toContain("c-d");
  });
});

describe("clôture", () => {
  it("classe par capital puis par élimination la plus tardive", () => {
    const ranking = survivalRanking([
      { userId: "a", capital: 0, eliminatedAt: new Date(1000) },
      { userId: "b", capital: 120, eliminatedAt: null },
      { userId: "c", capital: 0, eliminatedAt: new Date(2000) },
    ]);
    expect(ranking.map((r) => r.userId)).toEqual(["b", "c", "a"]);
  });
  it("ne prélève de commission que sur le gain net", () => {
    expect(survivalPayout(150, 50, 10)).toEqual({ payout: 140, commission: 10 });
    expect(survivalPayout(30, 50, 10)).toEqual({ payout: 30, commission: 0 });
  });
});
