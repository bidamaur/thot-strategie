import { describe, expect, it } from "vitest";
import { DEFAULT_RATING_CONFIG } from "./elo";
import { cadenceOf, computePoolElo, isProvisional, levelFor, ratingVariantOf, type PoolRatingConfig } from "./pools";

const config: PoolRatingConfig = {
  ...DEFAULT_RATING_CONFIG,
  provisionalGames: 15,
  kProvisional: 40,
  floor: 100,
};

describe("cadenceOf", () => {
  it("classe les cadences selon les seuils", () => {
    expect(cadenceOf(null)).toBe("UNLIMITED");
    expect(cadenceOf(0)).toBe("UNLIMITED");
    expect(cadenceOf(1)).toBe("BULLET");
    expect(cadenceOf(3)).toBe("BLITZ");
    expect(cadenceOf(5)).toBe("BLITZ");
    expect(cadenceOf(10)).toBe("RAPID");
    expect(cadenceOf(30)).toBe("CLASSICAL");
  });
  it("respecte des seuils personnalisés", () => {
    expect(cadenceOf(5, { bulletMax: 1, blitzMax: 3, rapidMax: 10 })).toBe("RAPID");
  });
});

describe("ratingVariantOf", () => {
  it("sépare échecs et variantes de dames", () => {
    expect(ratingVariantOf("CHESS", null)).toBe("CHESS");
    expect(ratingVariantOf("CHECKERS", "ENGLISH")).toBe("ENGLISH");
    expect(ratingVariantOf("CHECKERS", null)).toBe("INTERNATIONAL");
  });
});

describe("computePoolElo", () => {
  it("est à somme nulle entre deux joueurs confirmés de même K", () => {
    const { deltaWhite, deltaBlack } = computePoolElo(
      { rating: 1500, gamesPlayed: 50 },
      { rating: 1500, gamesPlayed: 50 },
      1,
      config,
    );
    expect(deltaWhite).toBeGreaterThan(0);
    expect(deltaWhite + deltaBlack).toBe(0);
  });

  it("donne plus de points en battant un joueur plus fort", () => {
    const upset = computePoolElo({ rating: 1300, gamesPlayed: 50 }, { rating: 1700, gamesPlayed: 50 }, 1, config);
    const expected = computePoolElo({ rating: 1700, gamesPlayed: 50 }, { rating: 1300, gamesPlayed: 50 }, 1, config);
    expect(upset.deltaWhite).toBeGreaterThan(expected.deltaWhite);
  });

  it("fait évoluer plus vite un joueur provisoire et protège l'adversaire confirmé", () => {
    const provisional = computePoolElo({ rating: 1500, gamesPlayed: 2 }, { rating: 1500, gamesPlayed: 80 }, 1, config);
    const confirmed = computePoolElo({ rating: 1500, gamesPlayed: 80 }, { rating: 1500, gamesPlayed: 80 }, 1, config);
    expect(provisional.deltaWhite).toBeGreaterThan(confirmed.deltaWhite);
    expect(Math.abs(provisional.deltaBlack)).toBeLessThan(Math.abs(confirmed.deltaBlack));
  });

  it("ne descend jamais sous le plancher", () => {
    const { deltaWhite } = computePoolElo({ rating: 105, gamesPlayed: 50 }, { rating: 900, gamesPlayed: 50 }, 0, config);
    expect(105 + deltaWhite).toBeGreaterThanOrEqual(config.floor);
  });

  it("une nulle entre égaux ne change rien", () => {
    const { deltaWhite, deltaBlack } = computePoolElo({ rating: 1500, gamesPlayed: 50 }, { rating: 1500, gamesPlayed: 50 }, 0.5, config);
    expect(deltaWhite).toBe(0);
    expect(deltaBlack).toBe(0);
  });
});

describe("statut et niveau", () => {
  it("détermine le statut provisoire", () => {
    expect(isProvisional(14, 15)).toBe(true);
    expect(isProvisional(15, 15)).toBe(false);
  });
  it("retourne la catégorie correspondante", () => {
    const levels = [
      { label: "Débutant", minRating: 0 },
      { label: "Expert", minRating: 1400 },
    ];
    expect(levelFor(1200, levels)).toBe("Débutant");
    expect(levelFor(1400, levels)).toBe("Expert");
  });
});
