import type { MetadataRoute } from "next";
import { getSettings } from "@/lib/settings/service";

// Les noms et couleurs sont administrables : manifeste calculé à la demande.
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const s = await getSettings(["pwa.appName", "pwa.shortName", "pwa.themeColor", "pwa.backgroundColor"] as const).catch(() => null);
  return {
    id: "/",
    name: s?.["pwa.appName"] || "Thot Stratégie — Dames & Échecs",
    short_name: s?.["pwa.shortName"] || "Thot",
    description: "Dames et échecs en ligne : parties classées, tournois, clubs et communauté.",
    lang: "fr",
    dir: "ltr",
    start_url: "/?source=app",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: s?.["pwa.themeColor"] || "#0f1513",
    background_color: s?.["pwa.backgroundColor"] || "#0f1513",
    categories: ["games", "board", "sports"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Jouer en ligne", short_name: "Jouer", url: "/match/en-ligne", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Tournois", url: "/tournois", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Mes parties", url: "/mes-parties", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
