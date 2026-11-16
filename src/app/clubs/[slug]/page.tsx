import { ClubDetailClient } from "@/components/clubs/club-detail-client";

export default async function ClubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ClubDetailClient slug={slug} />;
}
