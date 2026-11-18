import type { Metadata } from "next";
import { ActiveGamesClient } from "@/components/match/active-games-client";
import { PageHeader, PageShell } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Partie en cours" };

export default function ActiveGamesPage() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Jouer"
        title="Partie en cours"
        description="Reprenez votre partie, quittez-la, ou répondez aux joueurs qui attendent que vous soyez disponible."
      />
      <ActiveGamesClient />
    </PageShell>
  );
}
