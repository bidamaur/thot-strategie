import { LocalChessGame } from "@/components/chess/local-chess-game";
import { AiLevelLocked, AiTrialGate } from "@/components/games/ai-level-gate";
import { Suspense } from "react";
import { decideAiPage } from "@/lib/ai-training/page-access";
import { parseDifficulty, parseFirstPlayer } from "@/lib/engine/game-settings";

interface ChessGamePageProps {
  searchParams: Promise<{ difficulty?: string; first?: string }>;
}

export default async function ChessGamePage({
  searchParams,
}: ChessGamePageProps) {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-canvas p-8 text-white/60">
          Préparation de l’échiquier…
        </main>
      }
    >
      <ChessGame searchParams={searchParams} />
    </Suspense>
  );
}

async function ChessGame({ searchParams }: ChessGamePageProps) {
  const { difficulty, first } = await searchParams;
  const level = parseDifficulty(difficulty);
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
    <LocalChessGame
      initialDifficulty={level}
      firstPlayer={parseFirstPlayer(first)}
      maxLevel={decision.maxLevel}
      trial={decision.kind === "trial"}
    />
  );
  return decision.kind === "trial" ? <AiTrialGate gameType="CHESS">{game}</AiTrialGate> : game;
}
