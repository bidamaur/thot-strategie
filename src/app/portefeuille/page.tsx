import type { Metadata } from "next";
import { WalletClient } from "@/components/wallet/wallet-client";

export const metadata: Metadata = { title: "Portefeuille" };

export default function WalletPage() {
  return <WalletClient />;
}
