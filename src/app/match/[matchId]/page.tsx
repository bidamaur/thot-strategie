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
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 text-white sm:p-8">
      <h1 className="text-3xl font-semibold">Partie en ligne</h1>
      <Suspense
        fallback={
          <p className="rounded-3xl border border-white/10 bg-[#101713] p-8 text-center text-zinc-400">
            Chargement de la partie…
          </p>
        }
      >
        <MatchContent params={params} />
      </Suspense>
    </main>
  );
}
