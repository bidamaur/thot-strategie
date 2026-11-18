import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppExperience } from "@/components/app/app-experience";
import { BoardPrefsBoot } from "@/components/board/board-prefs-boot";
import { BOARD_PREFS_BOOT_SCRIPT } from "@/lib/board-prefs";
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
  applicationName: "Thot Stratégie",
  appleWebApp: {
    capable: true,
    title: "Thot",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
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
      data-board-theme="wood"
      suppressHydrationWarning
    >
      <head>
        {/* Thème du plateau appliqué avant l'affichage (préférence enregistrée sur l'appareil). */}
        <script dangerouslySetInnerHTML={{ __html: BOARD_PREFS_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col pb-16 lg:pb-0">
        <SiteNav />
        {children}
        <ActiveMatchBanner />
        <AppExperience />
        <BoardPrefsBoot />
      </body>
    </html>
  );
}
