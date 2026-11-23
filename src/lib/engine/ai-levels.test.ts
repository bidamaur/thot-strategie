import { describe, expect, it } from "vitest";
import { SEARCH_SETTINGS as CHESS } from "./chess-ai";
import { chooseDraughtsMove, createDraughtsPosition, getLegalDraughtsMoves, SEARCH_SETTINGS as DRAUGHTS } from "./draughts";
import { AI_LEVELS, DIFFICULTIES, parseDifficulty } from "./game-settings";

describe("IA d'entraînement : 5 niveaux de difficulté croissante", () => {
  it("5 niveaux, numérotés de 1 à 5, chacun décrit", () => {
    expect(AI_LEVELS).toEqual([1, 2, 3, 4, 5]);
    expect(DIFFICULTIES.map((d) => d.value)).toEqual([1, 2, 3, 4, 5]);
  });

  it("chaque niveau calcule au moins aussi loin, avec plus de moyens, et se trompe moins que le précédent", () => {
    for (const table of [CHESS, DRAUGHTS] as const) {
      for (let level = 2; level <= 5; level += 1) {
        const lo = table[(level - 1) as 1 | 2 | 3 | 4];
        const hi = table[level as 2 | 3 | 4 | 5];
        expect(hi.depth, `profondeur ${level}`).toBeGreaterThanOrEqual(lo.depth);
        expect(hi.nodes, `nœuds ${level}`).toBeGreaterThan(lo.nodes);
        expect(hi.blunder, `erreurs ${level}`).toBeLessThanOrEqual(lo.blunder);
        // Strictement plus fort : plus profond, ou moins d'erreurs volontaires.
        expect(hi.depth > lo.depth || hi.blunder < lo.blunder).toBe(true);
      }
      expect(table[5].blunder).toBe(0);
      expect(table[3].blunder).toBe(0);
    }
  });

  it("les anciens liens (simple, moyen, expert, pro) restent valides", () => {
    expect(parseDifficulty("simple")).toBe(1);
    expect(parseDifficulty("moyen")).toBe(3);
    expect(parseDifficulty("expert")).toBe(4);
    expect(parseDifficulty("pro")).toBe(5);
    expect(parseDifficulty("5")).toBe(5);
    expect(parseDifficulty("9")).toBe(3);
    expect(parseDifficulty(undefined)).toBe(3);
  });

  it("niveau 1 : le coup « au hasard » reste un coup légal (prise obligatoire respectée)", () => {
    const start = createDraughtsPosition("ENGLISH");
    const legal = getLegalDraughtsMoves(start).map((m) => JSON.stringify(m));
    // Générateur forcé : déclenche toujours l'erreur volontaire.
    const move = chooseDraughtsMove(start, 1, () => 0);
    expect(legal).toContain(JSON.stringify(move));
  });
});
