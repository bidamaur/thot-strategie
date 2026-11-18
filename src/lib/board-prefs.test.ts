import { describe, expect, it } from "vitest";
import { animationMs, DEFAULT_BOARD_PREFS, sanitizeBoardPrefs } from "./board-prefs";

describe("préférences de plateau", () => {
  it("bois par défaut, glisser ou toucher, aides visibles", () => {
    expect(sanitizeBoardPrefs(null)).toEqual(DEFAULT_BOARD_PREFS);
    expect(DEFAULT_BOARD_PREFS.theme).toBe("wood");
    expect(DEFAULT_BOARD_PREFS.input).toBe("both");
  });

  it("ramène toute valeur inconnue ou piégée à la valeur par défaut", () => {
    const prefs = sanitizeBoardPrefs({ theme: "red;background:url(x)", animation: "spin", input: 3, coordinates: "no", extra: 1 });
    expect(prefs).toEqual(DEFAULT_BOARD_PREFS);
    expect(Object.keys(prefs)).not.toContain("extra");
  });

  it("garde les choix valides et calcule la durée d'animation", () => {
    const prefs = sanitizeBoardPrefs({ theme: "marble", animation: "lift", speed: "slow", input: "tap", lastMove: false });
    expect(prefs).toMatchObject({ theme: "marble", animation: "lift", speed: "slow", input: "tap", lastMove: false });
    expect(animationMs(prefs)).toBe(360);
    expect(animationMs({ ...prefs, animation: "none" })).toBe(0);
  });
});
