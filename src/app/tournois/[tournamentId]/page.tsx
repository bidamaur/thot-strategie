import { TournamentDetailClient } from "@/components/tournaments/tournament-detail-client";

export default async function TournamentPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params;
  return <TournamentDetailClient tournamentId={tournamentId} />;
}
