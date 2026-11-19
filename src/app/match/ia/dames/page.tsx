import { LocalDraughtsGame } from "@/components/checkers/local-draughts-game";
import { Suspense } from "react";
import {
  parseFirstPlayer,
  type Difficulty,
  type DraughtsVariant,
} from "@/lib/engine/game-settings";

const DIFFICULTY_VALUES = new Set<Difficulty>([
  "simple",
  "moyen",
  "expert",
  "pro",
]);
const VARIANT_VALUES = new Set<DraughtsVariant>(["ENGLISH", "INTERNATIONAL"]);

interface DraughtsGamePageProps {
  searchParams: Promise<{ difficulty?: string; variant?: string; first?: string }>;
}

export default async function DraughtsGamePage({
  searchParams,
}: DraughtsGamePageProps) {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-canvas p-8 text-white/60">
          Préparation du damier…
        </main>
      }
    >
      <DraughtsGame searchParams={searchParams} />
    </Suspense>
  );
}

async function DraughtsGame({
  searchParams,
}: DraughtsGamePageProps) {
  const { difficulty, variant, first } = await searchParams;
  const selectedDifficulty = DIFFICULTY_VALUES.has(difficulty as Difficulty)
    ? (difficulty as Difficulty)
    : "moyen";
  const selectedVariant = VARIANT_VALUES.has(variant as DraughtsVariant)
    ? (variant as DraughtsVariant)
    : "INTERNATIONAL";

  return (
    <LocalDraughtsGame
      initialDifficulty={selectedDifficulty}
      initialVariant={selectedVariant}
      firstPlayer={parseFirstPlayer(first)}
    />
  );
}
