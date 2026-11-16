import { describe, expect, it } from "vitest";
import { DEFAULT_PREMIUM_TIERS, getSettingDefault, SETTING_DEFINITIONS, validateSettingValue } from "./registry";

describe("registre des paramètres", () => {
  it("n'a pas de clé en double", () => {
    const keys = SETTING_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a des valeurs par défaut valides", () => {
    for (const def of SETTING_DEFINITIONS) {
      const result = validateSettingValue(def.key, def.default);
      expect(result.ok, def.key).toBe(true);
    }
  });

  it("garde le mode rémunéré désactivé par défaut", () => {
    expect(getSettingDefault("money.enabled")).toBe(false);
    expect(getSettingDefault("money.requireVerification")).toBe(true);
  });

  it("garde la réintégration Survival désactivée par défaut", () => {
    expect(getSettingDefault("survival_bank_rebuy_enabled")).toBe(false);
  });

  it("refuse les valeurs hors bornes ou du mauvais type", () => {
    expect(validateSettingValue("money.commissionPercent", 80).ok).toBe(false);
    expect(validateSettingValue("points.classic.winBase", 2.5).ok).toBe(false);
    expect(validateSettingValue("money.enabled", "oui").ok).toBe(false);
    expect(validateSettingValue("points.classic.winBase", "7")).toEqual({ ok: true, value: 7 });
  });

  it("valide la structure des niveaux Premium", () => {
    expect(validateSettingValue("premium.tiers", DEFAULT_PREMIUM_TIERS).ok).toBe(true);
    expect(validateSettingValue("premium.tiers", DEFAULT_PREMIUM_TIERS.filter((t) => t.level !== 0)).ok).toBe(false);
    expect(validateSettingValue("premium.tiers", [...DEFAULT_PREMIUM_TIERS, DEFAULT_PREMIUM_TIERS[1]]).ok).toBe(false);
  });

  it("normalise les montants de mise proposés", () => {
    expect(validateSettingValue("money.stakePresets", [500, 100, 500])).toEqual({ ok: true, value: [100, 500] });
    expect(validateSettingValue("money.stakePresets", [0, 100]).ok).toBe(false);
  });

  it("n'accorde aucun avantage de format payant ou privé au niveau gratuit", () => {
    const free = DEFAULT_PREMIUM_TIERS.find((t) => t.level === 0)!;
    expect(free.privileges.tournamentFormats).toEqual(["SURVIVAL_BANK"]);
    expect(free.privileges.paidTournaments).toBe(false);
    expect(free.privileges.privateTournaments).toBe(false);
  });
});
