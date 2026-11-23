"use client";

import { Crown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openPremiumGate } from "@/lib/client/premium-gate";
import { track } from "@/lib/client/telemetry";
import { featureFromContext } from "@/lib/monetization/rules";

let hintsEnabled: Promise<boolean> | null = null;

function loadHintsEnabled() {
  hintsEnabled ??= fetch("/api/engagement?scope=light&path=/hint", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { config?: { premiumHints?: boolean } } | null) => d?.config?.premiumHints !== false)
    .catch(() => false);
  return hintsEnabled;
}

/**
 * Message Premium contextuel, discret et lié à l'action en cours
 * (statistiques, historique, quota, organisation). Désactivable par
 * l'administrateur ; jamais utilisé en salle de jeu.
 */
export function PremiumHint({ context, title, children, cta = "Voir les niveaux Premium" }: { context: string; title: string; children: React.ReactNode; cta?: string }) {
  const [visible, setVisible] = useState(false);
  const sent = useRef(false);
  useEffect(() => {
    let active = true;
    void loadHintsEnabled().then((enabled) => {
      if (!active || !enabled) return;
      setVisible(true);
      if (!sent.current) {
        sent.current = true;
        track("premium_hint_shown", { context });
      }
    });
    return () => {
      active = false;
    };
  }, [context]);
  if (!visible) return null;
  return (
    <aside className="flex items-start gap-3 rounded-2xl border border-gold/20 bg-gold/[0.05] px-4 py-3 text-sm">
      <Crown size={16} className="mt-0.5 shrink-0 text-gold" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium text-ink">{title}</p>
        <div className="mt-0.5 text-xs leading-5 text-ink-muted">{children}</div>
        <button
          type="button"
          onClick={() => {
            track("premium_hint_click", { context });
            openPremiumGate(featureFromContext(context));
          }}
          className="mt-1.5 inline-block text-xs font-semibold text-gold hover:underline"
        >
          {cta} →
        </button>
      </div>
    </aside>
  );
}
