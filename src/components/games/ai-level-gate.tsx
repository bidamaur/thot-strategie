"use client";

import { Crown, Gift, Lock, Play, Timer } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AdSlot } from "@/components/ads/ad-slot";
import { openPremiumGate } from "@/lib/client/premium-gate";

/**
 * Essai offert du jour contre le niveau 5 : publicité pendant la durée fixée
 * par l'administration (contrôlée par le serveur), puis lancement de la partie.
 */
export function AiTrialGate({ gameType, children }: { gameType: "CHESS" | "CHECKERS"; children: React.ReactNode }) {
  const [phase, setPhase] = useState<"loading" | "ad" | "ready" | "playing" | "error">("loading");
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/ai/trial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "ad" }) })
      .then(async (r) => {
        const json = await r.json().catch(() => ({}));
        if (!active) return;
        if (!r.ok) {
          setError(json.error ?? "Essai indisponible.");
          setPhase("error");
          return;
        }
        setEndsAt(Date.now() + (json.remainingMs as number));
        setPhase("ad");
      })
      .catch(() => {
        if (active) {
          setError("Connexion impossible.");
          setPhase("error");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== "ad" || endsAt === null) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= endsAt) {
        window.clearInterval(timer);
        setPhase("ready");
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase, endsAt]);

  async function start() {
    setBusy(true);
    setError("");
    const r = await fetch("/api/ai/trial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "start", gameType }) });
    const json = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(json.error ?? "Lancement impossible.");
    setPhase("playing");
  }

  if (phase === "playing") return <>{children}</>;
  const remaining = endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));

  return (
    <main className="mx-auto flex min-h-[70dvh] w-full max-w-2xl flex-col justify-center gap-5 px-4 py-10">
      <section className="rounded-3xl border border-gold/25 bg-gradient-to-b from-gold/[0.08] to-transparent p-6 text-center">
        <Gift className="mx-auto size-8 text-gold" aria-hidden />
        <h1 className="mt-3 text-2xl font-semibold">Votre partie offerte contre le niveau 5</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Une partie par jour contre l’IA la plus forte, offerte aux joueurs gratuits. Elle démarre juste après ce message publicitaire.
        </p>
      </section>

      {phase !== "error" && <AdSlot placement="ai_trial" format="rectangle" reserve />}

      {phase === "error" ? (
        <AiLevelLocked level={5} reason={error} />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <button type="button" onClick={start} disabled={phase !== "ready" || busy} className="btn btn-primary min-w-60">
            {phase === "ready" ? (
              <>
                <Play className="size-4" /> {busy ? "Lancement…" : "Lancer ma partie"}
              </>
            ) : (
              <>
                <Timer className="size-4" /> {remaining === null ? "Préparation…" : `Votre partie commence dans ${remaining} s`}
              </>
            )}
          </button>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button type="button" onClick={() => openPremiumGate("AI_LEVELS")} className="text-xs text-gold hover:underline">
            Sans publicité et sans limite avec Premium →
          </button>
        </div>
      )}
    </main>
  );
}

/** Niveau non accessible : explication et alternatives. */
export function AiLevelLocked({ level, reason, maxLevel = 3, setupHref = "/match/ia" }: { level: number; reason?: string; maxLevel?: number; setupHref?: string }) {
  return (
    <section className="mx-auto w-full max-w-lg rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-center">
      <Lock className="mx-auto size-7 text-gold" aria-hidden />
      <h2 className="mt-3 text-lg font-semibold">Niveau {level} réservé au Premium</h2>
      <p className="mt-2 text-sm text-ink-soft">
        {reason ?? `L’offre gratuite donne accès aux niveaux 1 à ${maxLevel}, et à une partie offerte par jour contre le niveau 5.`}
      </p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => openPremiumGate("AI_LEVELS")} className="btn btn-primary">
          <Crown className="size-4" /> Débloquer avec Premium
        </button>
        <Link href={setupHref} className="btn btn-ghost border border-line-strong">
          Choisir un autre niveau
        </Link>
      </div>
    </section>
  );
}
