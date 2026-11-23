import type { Metadata } from "next";
import { SupportClient } from "@/components/monetization/support-client";

export const metadata: Metadata = { title: "Soutenir la plateforme" };

export default function SupportPage() {
  return <SupportClient />;
}
