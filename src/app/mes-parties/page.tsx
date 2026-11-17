import type { Metadata } from "next";
import { MyGames } from "@/components/player/my-games";
import { PageHeader, PageShell } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Mes parties" };

export default function MyGamesPage() {
  return (
    <PageShell>
      <PageHeader eyebrow="Progression" title="Mes parties" description="Votre historique, vos résultats et votre évolution." />
      <MyGames />
    </PageShell>
  );
}
