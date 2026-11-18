import type { Metadata } from "next";
import { BoardSettings } from "@/components/board/board-settings";
import { PageHeader, PageShell } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Paramètres de jeu" };

export default function GameSettingsPage() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Préférences"
        title="Paramètres de jeu"
        description="Choisissez l’apparence du plateau, l’animation des pièces et votre manière de jouer. Vos choix vous suivent sur tous vos appareils."
      />
      <div className="card p-4 sm:p-6">
        <BoardSettings />
      </div>
    </PageShell>
  );
}
