import { describe, expect, it } from "vitest";
import { getSettingDefault, validateSettingValue } from "@/lib/settings/registry";
import { assignVariant, DEFAULT_CAMPAIGNS, DEFAULT_OBJECTIVES, validateCampaigns, validateObjectives } from "./definitions";

describe("engagement : définitions administrables", () => {
  it("valide les objectifs et campagnes par défaut", () => {
    expect(validateObjectives(DEFAULT_OBJECTIVES)).toBeNull();
    expect(validateCampaigns(DEFAULT_CAMPAIGNS)).toBeNull();
  });

  it("refuse une récompense hors bornes ou une mesure inconnue", () => {
    expect(validateObjectives([{ ...DEFAULT_OBJECTIVES[0], rewardPoints: 5000 }])).toMatch(/récompense/);
    expect(validateObjectives([{ ...DEFAULT_OBJECTIVES[0], metric: "elo_gain" }])).toMatch(/mesure inconnue/);
    expect(validateObjectives([DEFAULT_OBJECTIVES[0], DEFAULT_OBJECTIVES[0]])).toMatch(/double/);
  });

  it("n'accepte que des liens internes dans les campagnes", () => {
    const base = DEFAULT_CAMPAIGNS[0]!;
    expect(validateCampaigns([{ ...base, ctaHref: "https://phishing.example" }])).toMatch(/lien interne/);
    expect(validateCampaigns([{ ...base, ctaHref: "javascript:alert(1)" }])).toMatch(/lien interne/);
    expect(validateCampaigns([{ ...base, ctaHref: "/tournois?type=ARENA" }])).toBeNull();
  });

  it("répartit les variantes de façon stable et équilibrée", () => {
    expect(assignVariant("visiteur-1", "premium_hero", ["A", "B"])).toBe(assignVariant("visiteur-1", "premium_hero", ["A", "B"]));
    const counts = { A: 0, B: 0 } as Record<string, number>;
    for (let i = 0; i < 2000; i += 1) counts[assignVariant(`v${i}`, "premium_hero", ["A", "B"])]! += 1;
    expect(counts.A).toBeGreaterThan(850);
    expect(counts.B).toBeGreaterThan(850);
  });

  it("quota quotidien de l'offre gratuite : 25 parties, actif par défaut (décision du 23/11/2026), bornes", () => {
    expect(getSettingDefault("freePlan.dailyGamesEnabled")).toBe(true);
    expect(getSettingDefault("freePlan.dailyGames")).toBe(25);
    expect(getSettingDefault("freePlan.newPlayerGraceDays")).toBe(0);
    expect(validateSettingValue("freePlan.dailyGames", 0).ok).toBe(false);
    expect(validateSettingValue("freePlan.dailyGames", 10).ok).toBe(true);
  });

  it("valide les couleurs de l'application installable", () => {
    expect(validateSettingValue("pwa.themeColor", "#0f1513").ok).toBe(true);
    expect(validateSettingValue("pwa.themeColor", "red;background:url(x)").ok).toBe(false);
  });
});
