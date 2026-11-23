import { describe, expect, it } from "vitest";
import { sessionScore } from "./match-session";

const g = (status: string, winnerId: string | null = null) => ({ id: Math.random().toString(36), status, winnerId });

describe("score de session d'un affront", () => {
  it("première partie en cours : 0 – 0, partie 1", () => {
    expect(sessionScore([g("IN_PROGRESS")], ["a", "b"])).toEqual({ played: 0, gameNumber: 1, wins: { a: 0, b: 0 }, draws: 0 });
  });

  it("victoire de a : 1 – 0", () => {
    expect(sessionScore([g("FINISHED", "a")], ["a", "b"]).wins).toEqual({ a: 1, b: 0 });
  });

  it("le score suit les joueurs (couleurs inversées à chaque revanche), nulles et abandons comptés", () => {
    const s = sessionScore([g("FINISHED", "a"), g("FINISHED", "b"), g("FINISHED", null), g("ABANDONED", "a"), g("IN_PROGRESS")], ["b", "a"]);
    expect(s).toEqual({ played: 4, gameNumber: 5, wins: { a: 2, b: 1 }, draws: 1 });
  });

  it("une partie annulée avant de commencer ne compte pas", () => {
    const s = sessionScore([g("FINISHED", "a"), g("ABORTED"), g("IN_PROGRESS")], ["a", "b"]);
    expect(s).toMatchObject({ played: 1, gameNumber: 2, wins: { a: 1, b: 0 } });
  });
});
