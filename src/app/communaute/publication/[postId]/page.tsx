import type { Metadata } from "next";
import { PostPage } from "@/components/community/pages";
import { PageShell } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Publication — Communauté" };

export default async function CommunityPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  return (
    <PageShell>
      <PostPage postId={postId} />
    </PageShell>
  );
}
