export interface MedalTier {
  label: string;
  min: number;
  max: number | null;
  emoji: string;
}

export const MEDAL_TIERS: MedalTier[] = [
  { label: "Débutant", min: 1, max: 100, emoji: "🥉" },
  { label: "Intermédiaire", min: 101, max: 200, emoji: "🥈" },
  { label: "Professionnel", min: 201, max: 350, emoji: "🥇" },
  { label: "Diamant 1", min: 360, max: 450, emoji: "💎" },
  { label: "Diamant 2", min: 451, max: 550, emoji: "💎" },
  { label: "Diamant 3", min: 551, max: 650, emoji: "💎" },
  { label: "Or 1", min: 651, max: 750, emoji: "🏅" },
  { label: "Or 2", min: 751, max: 850, emoji: "🏅" },
  { label: "Or 3", min: 851, max: 950, emoji: "🏅" },
  { label: "BITJE Gold 1", min: 951, max: 1050, emoji: "🏆" },
  { label: "BITJE Gold 2", min: 1051, max: 1150, emoji: "🏆" },
  { label: "BITJE Gold 3", min: 1151, max: 1250, emoji: "🏆" },
  { label: "Expert", min: 1251, max: 1350, emoji: "👑" },
  { label: "Pro-Max", min: 1351, max: null, emoji: "🔥" },
];

export function getMedal(points: number): MedalTier | null {
  if (points <= 0) return null;
  return (
    MEDAL_TIERS.find(
      (tier) => points >= tier.min && (tier.max === null || points <= tier.max),
    ) ?? null
  );
}

export function getMedalEmoji(points: number): string {
  const medal = getMedal(points);
  return medal ? medal.emoji : "";
}

export function getMedalLabel(points: number): string {
  const medal = getMedal(points);
  return medal ? medal.label : "";
}
