import { LocalDraughtsGame } from "@/components/checkers/local-draughts-game";
import { AiLevelLocked, AiTrialGate } from "@/components/games/ai-level-gate";
import { Suspense } from "react";
import { decideAiPage } from "@/lib/ai-training/page-access";
import { parseDifficulty, parseFirstPlayer, type DraughtsVariant } from "@/lib/engine/game-settings";

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
  const level = parseDifficulty(difficulty);
  const selectedVariant = VARIANT_VALUES.has(variant as DraughtsVariant)
    ? (variant as DraughtsVariant)
    : "INTERNATIONAL";
  // Accès au niveau vérifié par le serveur (Premium, essai offert du jour).
  const decision = await decideAiPage(level);
  if (decision.kind === "locked") {
    return (
      <main className="flex min-h-[70dvh] items-center px-4 py-10">
        <AiLevelLocked level={level} reason={decision.reason} maxLevel={decision.maxLevel} />
      </main>
    );
  }
  const game = (
    <LocalDraughtsGame
      initialDifficulty={level}
      initialVariant={selectedVariant}
      firstPlayer={parseFirstPlayer(first)}
      maxLevel={decision.maxLevel}
      trial={decision.kind === "trial"}
    />
  );
  return decision.kind === "trial" ? <AiTrialGate gameType="CHECKERS">{game}</AiTrialGate> : game;
}
