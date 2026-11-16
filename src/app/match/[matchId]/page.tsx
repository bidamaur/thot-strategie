import { Suspense } from "react";
import { OnlineMatchClient } from "@/components/match/online-match-client";

interface MatchPageProps {
  params: Promise<{ matchId: string }>;
}

async function MatchContent({ params }: MatchPageProps) {
  const { matchId } = await params;

  return <OnlineMatchClient matchId={matchId} />;
}

export default function MatchPage({ params }: MatchPageProps) {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-3 text-ink sm:px-6 sm:py-5">
      <h1 className="sr-only">Partie en ligne</h1>
      <Suspense
        fallback={
          <p className="card mx-auto max-w-md p-8 text-center text-ink-muted">
            Chargement de la partie…
          </p>
        }
      >
        <MatchContent params={params} />
      </Suspense>
    </main>
  );
}
