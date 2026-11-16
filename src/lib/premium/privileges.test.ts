import { describe, expect, it } from "vitest";
import { DEFAULT_PREMIUM_TIERS } from "@/lib/settings/registry";
import { effectiveLevel, tierFor } from "./privileges";

describe("niveau Premium effectif", () => {
  it("vaut 0 sans Premium et ignore un niveau orphelin", () => {
    expect(effectiveLevel({ isAdmin: false, isPremium: false, premiumLevel: 4 })).toBe(0);
  });
  it("traite un ancien Premium sans niveau comme niveau 1 (compatibilité)", () => {
    expect(effectiveLevel({ isAdmin: false, isPremium: true, premiumLevel: 0 })).toBe(1);
  });
  it("expire à la date prévue", () => {
    const past = new Date(Date.now() - 1000);
    expect(effectiveLevel({ isAdmin: false, isPremium: true, premiumLevel: 3, premiumExpiresAt: past })).toBe(0);
  });
  it("donne tous les droits à l'administrateur", () => {
    expect(effectiveLevel({ isAdmin: true, isPremium: false, premiumLevel: 0 })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("tierFor", () => {
  it("retient le niveau inférieur le plus proche", () => {
    expect(tierFor(DEFAULT_PREMIUM_TIERS, 3).name).toBe("Or");
    expect(tierFor(DEFAULT_PREMIUM_TIERS, 99).level).toBe(5);
    expect(tierFor(DEFAULT_PREMIUM_TIERS, 0).level).toBe(0);
  });
});
