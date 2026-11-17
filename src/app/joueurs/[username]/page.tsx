import type { Metadata } from "next";
import { PlayerProfile } from "@/components/community/pages";
import { PageShell } from "@/components/ui/page-header";

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  return { title: `${decodeURIComponent(username)} — Profil` };
}

export default async function PlayerPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return (
    <PageShell>
      <PlayerProfile username={decodeURIComponent(username)} />
    </PageShell>
  );
}
