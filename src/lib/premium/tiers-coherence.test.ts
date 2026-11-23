import { describe, expect, it } from "vitest";
import { DEFAULT_PREMIUM_TIERS } from "@/lib/settings/registry";
import { SCOPE_RANK } from "./privileges";

/**
 * Cohérence des niveaux par défaut : passer au niveau supérieur ne doit jamais
 * retirer une possibilité (incohérence corrigée : Bronze limité au quartier
 * alors que l'offre gratuite allait jusqu'à la ville).
 */
describe("niveaux Premium : progression cohérente", () => {
  const tiers = [...DEFAULT_PREMIUM_TIERS].sort((a, b) => a.level - b.level);
  const pairs = tiers.slice(1).map((t, i) => [tiers[i]!, t] as const);

  it("aucune limite numérique ne baisse d'un niveau au suivant", () => {
    for (const [lo, hi] of pairs) {
      for (const key of ["maxActiveTournaments", "maxTournamentPlayers", "maxClubsOwned", "maxClubMembers", "privateRooms", "maxBulkInvites"] as const) {
        expect(hi.privileges[key] ?? 0, `${key} ${lo.name} → ${hi.name}`).toBeGreaterThanOrEqual(lo.privileges[key] ?? 0);
      }
      expect(SCOPE_RANK[hi.privileges.maxScope]!, `portée ${lo.name} → ${hi.name}`).toBeGreaterThanOrEqual(SCOPE_RANK[lo.privileges.maxScope]!);
      // Historique : 0 = illimité.
      const days = (d: number) => (d === 0 ? Infinity : d);
      expect(days(hi.privileges.historyDays)).toBeGreaterThanOrEqual(days(lo.privileges.historyDays));
    }
  });

  it("aucun avantage acquis ne disparaît, aucun format n'est retiré", () => {
    for (const [lo, hi] of pairs) {
      for (const [key, value] of Object.entries(lo.privileges)) {
        if (value === true) expect((hi.privileges as unknown as Record<string, unknown>)[key], `${key} ${lo.name} → ${hi.name}`).toBe(true);
      }
      for (const f of lo.privileges.tournamentFormats) expect(hi.privileges.tournamentFormats).toContain(f);
    }
  });

  it("tarifs croissants, durée définie pour les niveaux payants", () => {
    for (const [lo, hi] of pairs) expect(hi.priceCfa).toBeGreaterThan(lo.priceCfa);
    for (const t of tiers.filter((x) => x.level > 0)) expect(t.durationDays).toBeGreaterThan(0);
  });
});
