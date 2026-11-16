import type { Metadata } from "next";
import { PremiumClient } from "@/components/premium/premium-client";

export const metadata: Metadata = { title: "Premium" };

export default function PremiumPage() {
  return <PremiumClient />;
}
