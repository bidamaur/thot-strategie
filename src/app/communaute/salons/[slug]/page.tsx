import type { Metadata } from "next";
import { RoomPage } from "@/components/community/pages";
import { PageShell } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Salon — Communauté" };

export default async function CommunityRoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <PageShell>
      <RoomPage slug={slug} />
    </PageShell>
  );
}
