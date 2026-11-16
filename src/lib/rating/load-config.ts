import { getSettings } from "@/lib/settings/service";
import type { CadenceThresholds, PoolRatingConfig } from "./pools";

export async function loadRatingSettings(): Promise<{
  config: PoolRatingConfig;
  cadences: CadenceThresholds;
  levels: { label: string; minRating: number }[];
}> {
  const s = await getSettings([
    "rating.initial",
    "rating.floor",
    "rating.provisionalGames",
    "rating.kProvisional",
    "rating.kBeginner",
    "rating.kAmateur",
    "rating.kConfirmed",
    "rating.kExpert",
    "rating.kProfessional",
    "rating.bandBeginner",
    "rating.bandAmateur",
    "rating.bandConfirmed",
    "rating.bandExpert",
    "rating.cadenceBulletMax",
    "rating.cadenceBlitzMax",
    "rating.cadenceRapidMax",
    "rating.levels",
  ] as const);
  return {
    config: {
      initialRating: s["rating.initial"],
      floor: s["rating.floor"],
      provisionalGames: s["rating.provisionalGames"],
      kProvisional: s["rating.kProvisional"],
      kBeginner: s["rating.kBeginner"],
      kAmateur: s["rating.kAmateur"],
      kConfirmed: s["rating.kConfirmed"],
      kExpert: s["rating.kExpert"],
      kProfessional: s["rating.kProfessional"],
      ratingBands: {
        beginner: s["rating.bandBeginner"],
        amateur: s["rating.bandAmateur"],
        confirmed: s["rating.bandConfirmed"],
        expert: s["rating.bandExpert"],
        professional: s["rating.bandExpert"] + 400,
      },
    },
    cadences: {
      bulletMax: s["rating.cadenceBulletMax"],
      blitzMax: s["rating.cadenceBlitzMax"],
      rapidMax: s["rating.cadenceRapidMax"],
    },
    levels: s["rating.levels"],
  };
}
