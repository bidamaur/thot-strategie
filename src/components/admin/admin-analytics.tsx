"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface Kpis {
  generatedAt: string;
  users: { total: number; signups7: number; signups30: number; dau: number; wau: number; mau: number; stickiness: number | null };
  retention: { cohort: number; returnedD7: number; rateD7: number | null };
  games: { played30: number; perActiveUser30: number | null; abortedRate30: number | null; resignedRate30: number | null };
  engagement: { tournamentJoins30: number; friendsPerUser: number; avgSessionSeconds: number | null; sessionsMeasured: number };
  premium: { active: number; activated30: number; conversionRate30: number | null; expiredNotRenewed30: number; pageViews30: number; ctaClicks30: number };
  pwa: { promptsShown30: number; accepted30: number; installed30: number; standaloneShare30: number | null };
  featureUsage30: Record<string, number>;
  experiments: { experiment: string | null; variant: string | null; event: string; count: number }[];
}

const n = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${new Intl.NumberFormat("fr-FR").format(v)}${suffix}`);

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-muted">{hint}</p>}
    </div>
  );
}

/** Indicateurs d'audience, de fidélisation et de conversion (30 derniers jours sauf mention). */
export function AdminAnalytics() {
  const [data, setData] = useState<Kpis | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    void fetch("/api/admin/analytics", { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Erreur");
        setData(json);
        setError("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handle = setTimeout(load, 0);
    return () => clearTimeout(handle);
  }, [load]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="flex items-center gap-2 text-sm text-ink-muted"><LoaderCircle size={15} className="animate-spin" /> Calcul des indicateurs…</p>;

  // Regroupe les tests A/B : affichages vs actions par variante.
  const ab = new Map<string, Map<string, Record<string, number>>>();
  for (const row of data.experiments) {
    if (!row.experiment || !row.variant) continue;
    const exp = ab.get(row.experiment) ?? new Map();
    const v = exp.get(row.variant) ?? {};
    v[row.event] = (v[row.event] ?? 0) + row.count;
    exp.set(row.variant, v);
    ab.set(row.experiment, exp);
  }
  const SHOWN = ["premium_view", "prompt_shown", "pwa_install_prompt_shown"];
  const ACTED = ["premium_cta_click", "prompt_clicked", "pwa_install_accepted"];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Audience et conversion</h2>
          <p className="text-xs text-ink-muted">30 derniers jours sauf mention · données anonymisées, conservation limitée (Paramètres › Mesure d’audience)</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Actualiser</button>
      </div>

      <section className="space-y-2">
        <h3 className="eyebrow">Utilisateurs</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Inscrits" value={n(data.users.total)} hint={`+${n(data.users.signups7)} en 7 j · +${n(data.users.signups30)} en 30 j`} />
          <Tile label="Actifs aujourd’hui" value={n(data.users.dau)} />
          <Tile label="Actifs sur 30 jours" value={n(data.users.mau)} hint={`${n(data.users.wau)} sur 7 jours`} />
          <Tile label="Fidélité (actifs jour / mois)" value={n(data.users.stickiness, " %")} />
          <Tile label="Retour à 7 jours" value={n(data.retention.rateD7, " %")} hint={`${n(data.retention.returnedD7)} sur ${n(data.retention.cohort)} inscrits il y a 8 à 14 j`} />
          <Tile label="Durée moyenne de visite" value={data.engagement.avgSessionSeconds ? `${Math.round(data.engagement.avgSessionSeconds / 60)} min` : "—"} hint={`${n(data.engagement.sessionsMeasured)} visites mesurées`} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="eyebrow">Jeu et communauté</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Parties jouées" value={n(data.games.played30)} hint={`${n(data.games.perActiveUser30)} par joueur actif`} />
          <Tile label="Parties annulées" value={n(data.games.abortedRate30, " %")} hint="Avant le 2e coup" />
          <Tile label="Parties abandonnées" value={n(data.games.resignedRate30, " %")} />
          <Tile label="Inscriptions en tournoi" value={n(data.engagement.tournamentJoins30)} />
          <Tile label="Amis par joueur" value={n(data.engagement.friendsPerUser)} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="eyebrow">Premium</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Abonnés actifs" value={n(data.premium.active)} />
          <Tile label="Activations" value={n(data.premium.activated30)} hint={`Conversion : ${n(data.premium.conversionRate30, " %")} des actifs`} />
          <Tile label="Expirés non renouvelés" value={n(data.premium.expiredNotRenewed30)} />
          <Tile label="Visites de la page Premium" value={n(data.premium.pageViews30)} hint={`${n(data.premium.ctaClicks30)} clics sur un niveau`} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="eyebrow">Application installable</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Propositions affichées" value={n(data.pwa.promptsShown30)} />
          <Tile label="Acceptées" value={n(data.pwa.accepted30)} />
          <Tile label="Installations confirmées" value={n(data.pwa.installed30)} hint="iPhone : non détectable par le navigateur" />
          <Tile label="Ouvertures en mode application" value={n(data.pwa.standaloneShare30, " %")} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="eyebrow">Tests A/B</h3>
        {ab.size === 0 ? (
          <p className="text-sm text-ink-muted">Pas encore de données.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-xs text-ink-muted">
                <tr className="border-b border-line"><th className="px-4 py-2 text-left">Expérience</th><th className="px-3 py-2">Variante</th><th className="px-3 py-2">Affichages</th><th className="px-3 py-2">Actions</th><th className="px-3 py-2">Taux</th></tr>
              </thead>
              <tbody>
                {[...ab.entries()].flatMap(([exp, variants]) =>
                  [...variants.entries()].map(([variant, events]) => {
                    const shown = SHOWN.reduce((a, k) => a + (events[k] ?? 0), 0);
                    const acted = ACTED.reduce((a, k) => a + (events[k] ?? 0), 0);
                    return (
                      <tr key={`${exp}:${variant}`} className="border-b border-line last:border-0">
                        <td className="px-4 py-2">{exp}</td>
                        <td className="px-3 py-2 text-center">{variant}</td>
                        <td className="tabular px-3 py-2 text-center">{n(shown)}</td>
                        <td className="tabular px-3 py-2 text-center">{n(acted)}</td>
                        <td className="tabular px-3 py-2 text-center">{shown ? `${Math.round((acted / shown) * 1000) / 10} %` : "—"}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-ink-muted">Attendez quelques centaines d’affichages par variante avant de conclure : un écart sur de petits volumes n’est pas significatif.</p>
      </section>

      <section className="space-y-2">
        <h3 className="eyebrow">Utilisation des fonctionnalités (événements)</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.featureUsage30).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
            <span key={name} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs"><span className="text-ink-muted">{name}</span> <strong className="tabular">{n(count)}</strong></span>
          ))}
        </div>
      </section>
    </div>
  );
}
