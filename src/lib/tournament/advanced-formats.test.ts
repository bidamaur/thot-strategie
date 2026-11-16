import { describe, expect, it } from "vitest";
import {
  arenaStandings,
  doubleElimShape,
  groupLayout,
  knockoutFromGroups,
  losersRoundSources,
  pairMixed,
  pickArenaOpponent,
  snakeGroups,
} from "./advanced-formats";

describe("groupes", () => {
  it("valide les configurations possibles", () => {
    expect(groupLayout(8, 4, 2)).toEqual({ groups: 2, qualifiers: 4 });
    expect(groupLayout(16, 4, 2)).toEqual({ groups: 4, qualifiers: 8 });
    expect(groupLayout(12, 4, 2)).toHaveProperty("error");
    expect(groupLayout(6, 4, 2)).toEqual({ groups: 2, qualifiers: 4 }); // 2 groupes de 3
    expect(groupLayout(5, 4, 2)).toHaveProperty("error"); // un groupe de 2 : pas de place pour 2 qualifiés
  });

  it("répartit en serpentin", () => {
    expect(snakeGroups([1, 2, 3, 4, 5, 6, 7, 8], 2)).toEqual([[1, 4, 5, 8], [2, 3, 6, 7]]);
  });

  it("n'oppose pas deux qualifiés du même groupe au premier tour", () => {
    const pairs = knockoutFromGroups([
      { userId: "A1", group: 1, rank: 1 },
      { userId: "A2", group: 1, rank: 2 },
      { userId: "B1", group: 2, rank: 1 },
      { userId: "B2", group: 2, rank: 2 },
      { userId: "C1", group: 3, rank: 1 },
      { userId: "C2", group: 3, rank: 2 },
      { userId: "D1", group: 4, rank: 1 },
      { userId: "D2", group: 4, rank: 2 },
    ]);
    expect(pairs).toHaveLength(4);
    for (const p of pairs) expect(p.whiteId[0]).not.toBe(p.blackId[0]);
    // Chaque premier affronte un deuxième.
    for (const p of pairs) expect(p.whiteId.endsWith("1") !== p.blackId.endsWith("1")).toBe(true);
  });
});

describe("double élimination", () => {
  it("calcule la forme du tableau", () => {
    expect(doubleElimShape(4)).toEqual({ winnersRounds: 2, losersRounds: 2 });
    expect(doubleElimShape(8)).toEqual({ winnersRounds: 3, losersRounds: 4 });
  });
  it("décrit l'alimentation du tableau des perdants", () => {
    expect(losersRoundSources(1)).toEqual({ kind: "WB_LOSERS", wbRound: 1 });
    expect(losersRoundSources(2)).toEqual({ kind: "MIX", lbRound: 1, wbRound: 2 });
    expect(losersRoundSources(3)).toEqual({ kind: "LB_WINNERS", lbRound: 2 });
    expect(losersRoundSources(4)).toEqual({ kind: "MIX", lbRound: 3, wbRound: 3 });
  });
  it("croise les perdants du haut", () => {
    expect(pairMixed(["l1", "l2"], ["w1", "w2"])).toEqual([
      { whiteId: "w2", blackId: "l1" },
      { whiteId: "w1", blackId: "l2" },
    ]);
  });
});

describe("Arena", () => {
  const t = (n: number) => new Date(2026, 0, 1, 0, n);
  it("applique le barème et le bonus de série", () => {
    const table = arenaStandings(
      ["a", "b", "c"],
      [
        { whiteId: "a", blackId: "b", winnerId: "a", finishedAt: t(1) },
        { whiteId: "a", blackId: "c", winnerId: "a", finishedAt: t(2) },
        { whiteId: "a", blackId: "b", winnerId: "a", finishedAt: t(3) },
        { whiteId: "b", blackId: "c", winnerId: null, finishedAt: t(4) },
      ],
    );
    const a = table.find((r) => r.userId === "a")!;
    expect(a.score).toBe(2 + 2 + 4);
    expect(a.onFire).toBe(true);
    expect(table[0]!.userId).toBe("a");
    expect(table.find((r) => r.userId === "b")!.score).toBe(1);
  });
  it("une défaite casse la série", () => {
    const table = arenaStandings(
      ["a", "b"],
      [
        { whiteId: "a", blackId: "b", winnerId: "a", finishedAt: t(1) },
        { whiteId: "a", blackId: "b", winnerId: "a", finishedAt: t(2) },
        { whiteId: "a", blackId: "b", winnerId: "b", finishedAt: t(3) },
        { whiteId: "a", blackId: "b", winnerId: "a", finishedAt: t(4) },
      ],
    );
    expect(table.find((r) => r.userId === "a")!.score).toBe(2 + 2 + 0 + 2);
  });
  it("choisit le plus ancien en attente et évite la revanche immédiate", () => {
    const now = Date.now();
    const waiting = [
      { userId: "b", since: new Date(now - 5000), lastOpponentId: "a" },
      { userId: "c", since: new Date(now - 1000), lastOpponentId: null },
    ];
    expect(pickArenaOpponent({ userId: "a", lastOpponentId: "b" }, waiting)).toBe("c");
    expect(pickArenaOpponent({ userId: "a", lastOpponentId: null }, [waiting[1]!])).toBe("c");
  });
});
