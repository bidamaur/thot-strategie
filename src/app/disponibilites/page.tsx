import type { Metadata } from "next";
import { AvailabilityEditor } from "@/components/availability/availability-editor";

export const metadata: Metadata = { title: "Mes disponibilités" };

export default function AvailabilityPage() {
  return <AvailabilityEditor />;
}
