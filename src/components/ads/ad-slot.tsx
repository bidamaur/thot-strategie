"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AdPlacement } from "@/lib/settings/registry";

interface AdConfig {
  enabled: boolean;
  clientId: string | null;
  slots: Record<string, string>;
  placements: string[];
  showPlaceholder: boolean;
  hidden: boolean;
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

// Configuration partagée par tous les emplacements d'une même page.
let configPromise: Promise<AdConfig | null> | null = null;
let configLoadedAt = 0;
function loadConfig(): Promise<AdConfig | null> {
  if (!configPromise || Date.now() - configLoadedAt > 60_000) {
    configLoadedAt = Date.now();
    configPromise = fetch("/api/ads/config", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AdConfig>) : null))
      .catch(() => null);
  }
  return configPromise;
}

function ensureAdSenseScript(clientId: string) {
  if (document.querySelector("script[data-adsense]")) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
  script.crossOrigin = "anonymous";
  script.dataset.adsense = "1";
  document.head.appendChild(script);
}

const HEIGHTS = {
  banner: "min-h-[100px] sm:min-h-[90px]",
  rectangle: "min-h-[250px]",
} as const;

/**
 * Emplacement publicitaire Google AdSense.
 * - jamais rendu en salle de jeu ni dans l'administration ;
 * - masqué pour les niveaux Premium « sans publicité » ;
 * - hauteur réservée à l'avance pour éviter les sauts de mise en page.
 */
export function AdSlot({
  placement,
  format = "banner",
  className = "",
  reserve = false,
}: {
  placement: AdPlacement;
  format?: keyof typeof HEIGHTS;
  className?: string;
  /** Espace toujours visible (publicité exigée avant une récompense) : réservé même si l'emplacement est inactif. */
  reserve?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const [config, setConfig] = useState<AdConfig | null>(null);
  const insRef = useRef<HTMLModElement>(null);
  const pushed = useRef(false);

  const forbidden = pathname.startsWith("/admin") || /^\/match\/(?!en-ligne|ia)[^/]+$/.test(pathname);

  useEffect(() => {
    if (forbidden) return;
    let active = true;
    void loadConfig().then((c) => {
      if (active) setConfig(c);
    });
    return () => {
      active = false;
    };
  }, [forbidden]);

  const slot = config?.slots[placement] ?? "";
  const live = Boolean(config?.enabled && config.clientId && slot && config.placements.includes(placement));

  useEffect(() => {
    if (!live || !config?.clientId || pushed.current || !insRef.current) return;
    ensureAdSenseScript(config.clientId);
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch {
      // bloqueur de publicité ou script indisponible : l'espace reste vide
    }
  }, [live, config?.clientId]);

  if (forbidden || !config || config.hidden) return null;
  if (!reserve && (!config.enabled || !config.placements.includes(placement))) return null;
  if (!live && !config.showPlaceholder && !reserve) return null;

  return (
    <aside aria-label="Publicité" className={`w-full ${className}`}>
      <p className="mb-1 text-center text-[10px] uppercase tracking-[0.18em] text-ink-muted/70">Publicité</p>
      <div className={`flex w-full items-center justify-center overflow-hidden rounded-xl ${HEIGHTS[format]} ${live ? "" : "border border-dashed border-line-strong bg-surface-2/50"}`}>
        {live ? (
          <ins
            ref={insRef}
            className="adsbygoogle block w-full"
            style={{ display: "block" }}
            data-ad-client={config.clientId!}
            data-ad-slot={slot}
            data-ad-format={format === "rectangle" ? "rectangle" : "auto"}
            data-full-width-responsive="true"
          />
        ) : (
          <span className="px-4 text-center text-xs text-ink-muted">Espace publicitaire · {placement}</span>
        )}
      </div>
    </aside>
  );
}
