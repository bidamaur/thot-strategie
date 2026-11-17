import type { Metadata } from "next";
import { ClubMatchPage } from "@/components/community/interclub";
import { PageShell } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Rencontre interclubs" };

export default async function InterclubPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return (
    <PageShell width="max-w-5xl">
      <ClubMatchPage matchId={matchId} />
    </PageShell>
  );
}
