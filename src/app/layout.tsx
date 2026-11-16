import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ActiveMatchBanner } from "@/components/match/active-match-banner";
import { SiteNav } from "@/components/layout/site-nav";
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
  title: {
    default: "Thot Stratégie | Dames & Échecs en ligne",
    template: "%s · Thot Stratégie",
  },
  description:
    "Jouez aux dames et aux échecs en ligne : parties classées, tournois, Survival, clubs et classements ELO.",
};

export const viewport: Viewport = {
  themeColor: "#0f1513",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col pb-16 lg:pb-0">
        <SiteNav />
        {children}
        <ActiveMatchBanner />
      </body>
    </html>
  );
}
