import type { Metadata } from "next";
import { Suspense } from "react";
import { CommunityHub } from "@/components/community/community-hub";
import { PageShell } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Communauté" };

export default function CommunityPage() {
  return (
    <PageShell>
      <Suspense fallback={<p className="py-10 text-center text-sm text-ink-muted">Chargement…</p>}>
        <CommunityHub />
      </Suspense>
    </PageShell>
  );
}
