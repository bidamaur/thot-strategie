import { describe, expect, it } from "vitest";
import { outcomeFor, placementLabel, streaks, summarizeTournaments, tally, type Participation } from "./compute";

const part = (over: Partial<Participation>): Participation => ({
  tournamentId: "t",
  name: "Tournoi",
  date: new Date("2026-11-01"),
  type: "SWISS",
  gameType: "CHECKERS",
  draughtsVariant: "INTERNATIONAL",
  status: "COMPLETED",
  placement: null,
  participants: 8,
  rewarded: false,
  ...over,
});

describe("profil de l'adversaire : calculs", () => {
  it("résultat d'une partie du point de vue du joueur", () => {
    expect(outcomeFor("a", "a")).toBe("WIN");
    expect(outcomeFor("a", "b")).toBe("LOSS");
    expect(outcomeFor("a", null)).toBe("DRAW");
  });

  it("bilan et pourcentages", () => {
    expect(tally(["WIN", "WIN", "LOSS", "DRAW"])).toEqual({
      played: 4, wins: 2, losses: 1, draws: 1, winRate: 50, lossRate: 25, drawRate: 25,
    });
    expect(tally([]).winRate).toBeNull();
  });

  it("séries : en cours (plus récent d'abord) et plus longue série de victoires", () => {
    expect(streaks(["WIN", "WIN", "DRAW", "LOSS", "WIN", "WIN", "WIN"])).toEqual({
      current: { kind: "WIN", length: 2 },
      longestWin: 3,
    });
    expect(streaks(["LOSS", "LOSS", "WIN"]).current).toEqual({ kind: "LOSS", length: 2 });
    expect(streaks(["DRAW", "WIN"]).current).toBeNull();
    expect(streaks([])).toEqual({ current: null, longestWin: 0 });
  });

  it("tournois : podiums, finales (élimination directe), meilleure performance", () => {
    const s = summarizeTournaments([
      part({ placement: 1, type: "ELIMINATION", name: "A", participants: 16 }),
      part({ placement: 2, type: "ELIMINATION", name: "B" }),
      part({ placement: 2, type: "SWISS", name: "C" }),
      part({ placement: 3, name: "D" }),
      part({ placement: 7, name: "E" }),
      part({ placement: null, status: "IN_PROGRESS", name: "F" }),
    ]);
    expect(s).toMatchObject({ participated: 6, completed: 5, wins: 1, second: 2, third: 1, podiums: 4, finals: 2 });
    expect(s.best).toEqual({ placement: 1, name: "A", participants: 16 });
  });

  it("libellés de résultat", () => {
    expect(placementLabel(part({ placement: 1 }))).toBe("Vainqueur");
    expect(placementLabel(part({ placement: 2, type: "ELIMINATION" }))).toBe("Finaliste");
    expect(placementLabel(part({ placement: 2 }))).toBe("2e place");
    expect(placementLabel(part({ status: "IN_PROGRESS" }))).toBe("En cours");
    expect(placementLabel(part({ status: "OPEN" }))).toBe("Inscrit");
  });

  it("historique des participations : du plus récent au plus ancien, limité", () => {
    const list = Array.from({ length: 7 }, (_, i) => part({ name: `T${i}`, date: new Date(2026, 0, i + 1) }));
    expect(summarizeTournaments(list).recent.map((r) => r.name)).toEqual(["T6", "T5", "T4", "T3", "T2"]);
  });
});
