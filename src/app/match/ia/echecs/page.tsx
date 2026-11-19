import { LocalChessGame } from "@/components/chess/local-chess-game";
import { Suspense } from "react";
import { parseFirstPlayer, type Difficulty } from "@/lib/engine/game-settings";

const DIFFICULTY_VALUES = new Set<Difficulty>([
  "simple",
  "moyen",
  "expert",
  "pro",
]);

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
  const selectedDifficulty = DIFFICULTY_VALUES.has(difficulty as Difficulty)
    ? (difficulty as Difficulty)
    : "moyen";

  return <LocalChessGame initialDifficulty={selectedDifficulty} firstPlayer={parseFirstPlayer(first)} />;
}
