"use client";

import { CalendarCheck, Check, Flame, Gift, LoaderCircle, Target, X, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PremiumHint } from "@/components/premium/premium-hint";
import { track } from "@/lib/client/telemetry";

interface Objective {
  id: string;
  period: "daily" | "weekly";
  label: string;
  target: number;
  progress: number;
  rewardPoints: number;
  completed: boolean;
  claimed: boolean;
  endsAt: string;
}
interface Data {
  quota?: { limited: boolean; limit: number; used: number; remaining: number | null; resetsAt: string; exemptReason: string | null; discoveryEndsAt: string | null };
  objectives?: Objective[];
  streaks?: { playDays: number; playedToday: boolean; winStreak: number };
  onboarding?: { steps: { id: string; label: string; href: string; done: boolean }[]; done: number; total: number } | null;
  config?: { warnAtRemaining: number };
}

function timeLeft(iso: string) {
  const ms = Date.parse(iso) - Date.now();
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)} j`;
  if (h >= 1) return `${h} h`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}

/**
 * Accueil du joueur connecté : premiers pas (nouveaux joueurs), objectifs du
 * jour et de la semaine, séries et parties gratuites restantes. Tout est
 * calculé par le serveur ; la récompense est en points classiques uniquement.
 */
export function EngagementPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    void fetch("/api/engagement?path=/", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: Data | null) => json && setData(json))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const handle = setTimeout(load, 0);
    return () => clearTimeout(handle);
  }, [load]);

  async function claim(o: Objective) {
    setClaiming(o.id);
    setMessage("");
    const r = await fetch("/api/engagement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "claim", objectiveId: o.id }) });
    const json = await r.json().catch(() => ({}));
    setClaiming(null);
    if (r.ok) {
      track("objective_claimed", { id: o.id, points: json.rewardPoints ?? 0 });
      setMessage(json.rewardPoints > 0 ? `+${json.rewardPoints} points classiques` : "Objectif validé");
      load();
    } else setMessage(json.error ?? "Impossible pour le moment.");
  }

  async function hideOnboarding() {
    await fetch("/api/engagement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dismissOnboarding" }) }).catch(() => undefined);
    setData((d) => (d ? { ...d, onboarding: null } : d));
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-white/40">
        <LoaderCircle size={14} className="animate-spin" /> Chargement de vos objectifs…
      </div>
    );
  }

  const daily = (data.objectives ?? []).filter((o) => o.period === "daily");
  const weekly = (data.objectives ?? []).filter((o) => o.period === "weekly");
  const quota = data.quota;
  const warn = quota?.limited && quota.remaining !== null && quota.remaining <= (data.config?.warnAtRemaining ?? 2);

  return (
    <section aria-label="Votre progression" className="grid gap-4 lg:grid-cols-3">
      {data.onboarding && (
        <div className="card p-5 lg:col-span-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Premiers pas · {data.onboarding.done}/{data.onboarding.total}</p>
              <h2 className="mt-1 text-lg font-semibold">Bien démarrer sur Thot</h2>
            </div>
            <button type="button" onClick={() => void hideOnboarding()} className="btn btn-ghost min-h-0 px-2 py-1" aria-label="Masquer les premiers pas">
              <X size={15} />
            </button>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full bg-accent transition-all" style={{ width: `${(data.onboarding.done / data.onboarding.total) * 100}%` }} />
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.onboarding.steps.map((step) => {
              const content = (
                <>
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${step.done ? "border-accent bg-accent text-accent-ink" : "border-line-strong"}`}>
                    {step.done && <Check size={13} />}
                  </span>
                  <span className={step.done ? "text-ink-muted line-through" : "text-ink-soft"}>{step.label}</span>
                </>
              );
              const cls = "flex min-h-11 w-full items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2 text-left text-sm hover:border-line-strong";
              return (
                <li key={step.id}>
                  {step.done ? (
                    <span className={cls}>{content}</span>
                  ) : step.href === "#installer" ? (
                    <button type="button" className={cls} onClick={() => window.dispatchEvent(new Event("thot:install"))}>{content}</button>
                  ) : (
                    <Link href={step.href} className={cls}>{content}</Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="card space-y-4 p-5">
        <div className="flex items-center gap-2"><Zap size={16} className="text-accent" /><h2 className="text-sm font-semibold">Aujourd’hui</h2></div>
        {quota?.limited ? (
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-ink-soft">Parties en ligne gratuites</span>
              <span className={`tabular font-semibold ${warn ? "text-gold" : ""}`}>{quota.remaining} / {quota.limit}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <span className={`block h-full ${warn ? "bg-gold" : "bg-accent"}`} style={{ width: `${Math.min(100, (quota.used / quota.limit) * 100)}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">Remise à zéro dans {timeLeft(quota.resetsAt)}. Tournois et entraînement contre l’IA illimités.</p>
          </div>
        ) : quota?.exemptReason === "discovery" && quota.discoveryEndsAt ? (
          <p className="text-xs text-ink-muted">Période de découverte : parties illimitées encore {timeLeft(quota.discoveryEndsAt)}.</p>
        ) : quota?.exemptReason === "premium" ? (
          <p className="text-xs text-ink-muted">Parties illimitées avec votre niveau Premium.</p>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="flex items-center gap-1.5 text-xs text-ink-muted"><CalendarCheck size={13} /> Jours d’affilée</p>
            <p className="tabular mt-1 text-xl font-semibold">{data.streaks?.playDays ?? 0}</p>
            {data.streaks && !data.streaks.playedToday && data.streaks.playDays > 0 && <p className="text-[11px] text-gold">Jouez aujourd’hui pour la prolonger</p>}
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="flex items-center gap-1.5 text-xs text-ink-muted"><Flame size={13} /> Victoires de suite</p>
            <p className="tabular mt-1 text-xl font-semibold">{data.streaks?.winStreak ?? 0}</p>
          </div>
        </div>
        <Link href="/mes-parties" className="block text-xs font-semibold text-accent hover:underline">Mes parties et statistiques →</Link>
        {quota?.limited && quota.remaining === 0 && (
          <PremiumHint context="quota" title="Parties du jour terminées">
            Revenez demain, jouez un tournoi ou entraînez-vous contre l’IA. Avec Premium, les parties en ligne sont illimitées.
          </PremiumHint>
        )}
      </div>

      {[{ title: "Objectifs du jour", list: daily }, { title: "Objectifs de la semaine", list: weekly }].map(({ title, list }) =>
        list.length === 0 ? null : (
          <div key={title} className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2"><Target size={16} className="text-accent" /><h2 className="text-sm font-semibold">{title}</h2></div>
              <span className="text-[11px] text-ink-muted">encore {timeLeft(list[0]!.endsAt)}</span>
            </div>
            <ul className="mt-3 space-y-3">
              {list.map((o) => (
                <li key={o.id}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className={o.claimed ? "text-ink-muted line-through" : "text-ink-soft"}>{o.label}</span>
                    {o.completed && !o.claimed ? (
                      <button type="button" disabled={claiming === o.id} onClick={() => void claim(o)} className="btn btn-primary min-h-0 shrink-0 px-2.5 py-1 text-xs">
                        <Gift size={13} /> {o.rewardPoints > 0 ? `+${o.rewardPoints}` : "Valider"}
                      </button>
                    ) : (
                      <span className="tabular shrink-0 text-xs text-ink-muted">{o.claimed ? <Check size={14} className="text-accent" /> : `${o.progress}/${o.target}`}</span>
                    )}
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
                    <span className="block h-full bg-accent/80" style={{ width: `${(o.progress / o.target) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-ink-muted">Récompenses en points classiques (sans valeur monétaire, sans effet sur l’ELO).</p>
          </div>
        ),
      )}
      {message && <p role="status" className="text-sm text-accent lg:col-span-3">{message}</p>}
    </section>
  );
}
