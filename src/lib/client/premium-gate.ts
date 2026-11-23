"use client";

import type { InterestFeature } from "@/lib/monetization/rules";

/**
 * Point d'entrée unique de tous les boutons Premium et du bouton de don :
 * ouvre la fenêtre de paiement (Cameroun) ou de lancement (autres pays),
 * hébergée une seule fois dans la mise en page (CheckoutHost).
 */

export interface GateRequest {
  mode: "premium" | "donation";
  /** Fonctionnalité sollicitée (mesure de l'intérêt). */
  feature?: InterestFeature;
  /** Niveau déjà choisi (page des offres). */
  tierLevel?: number;
}

export const GATE_EVENT = "thot:checkout";

export function openPremiumGate(feature: InterestFeature = "PREMIUM_OFFER", tierLevel?: number) {
  window.dispatchEvent(new CustomEvent<GateRequest>(GATE_EVENT, { detail: { mode: "premium", feature, tierLevel } }));
}

export function openDonation() {
  window.dispatchEvent(new CustomEvent<GateRequest>(GATE_EVENT, { detail: { mode: "donation" } }));
}

/** Enregistre une sollicitation (agrégée côté serveur). Sans effet pour un visiteur non connecté. */
export function recordInterest(feature: InterestFeature, options: { tierLevel?: number; waitlist?: boolean } = {}) {
  return fetch("/api/monetization/interest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature, ...options }),
    keepalive: true,
  })
    .then(async (r) => (r.status === 204 ? null : ((await r.json().catch(() => ({}))) as { interest?: { waitlist: boolean }; error?: string })))
    .catch(() => null);
}
