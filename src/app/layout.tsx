import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ActiveMatchBanner } from "@/components/match/active-match-banner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Thot Stratégie | Jeux de plateau",
  description: "Jouez aux échecs et aux dames avec Thot Stratégie.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ActiveMatchBanner />
      </body>
    </html>
  );
}
