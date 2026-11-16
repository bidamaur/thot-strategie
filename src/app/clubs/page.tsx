import type { Metadata } from "next";
import { ClubsClient } from "@/components/clubs/clubs-client";

export const metadata: Metadata = { title: "Clubs" };

export default function ClubsPage() {
  return <ClubsClient />;
}
