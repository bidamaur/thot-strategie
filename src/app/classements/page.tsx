import type { Metadata } from "next";
import { LeaderboardClient } from "@/components/leaderboard/leaderboard-client";

export const metadata: Metadata = { title: "Classements" };

export default function LeaderboardPage() {
  return <LeaderboardClient />;
}
