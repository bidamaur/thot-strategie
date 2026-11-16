"use client";

import { Check, Crown, Minus } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import type { PremiumPrivileges, PremiumTier } from "@/lib/settings/registry";

const SCOPE_LABELS: Record<string, string> = {
  NEIGHBORHOOD: "Quartier",
  CITY: "Ville",
  REGION: "Région",
  COUNTRY: "National",
  CONTINENT: "Continental",
  INTERNATIONAL: "International",
};

const FORMAT_LABELS: Record<string, string> = {
  SURVIVAL_BANK: "Survival",
  ARENA: "Arena",
  SWISS: "Suisse",
  ROUND_ROBIN: "Toutes rondes",
  ELIMINATION: "Élimination",
  DOUBLE_ELIMINATION: "Double élim.",
  GROUPS_ELIMINATION: "Groupes + finales",
  LEAGUE: "Ligue",
};

type Row = { label: string; group: string; render: (p: PremiumPrivileges) => React.ReactNode };

const yes = (v: boolean) =>
  v ? <Check className="mx-auto size-4 text-accent" aria-label="Inclus" /> : <Minus className="mx-auto size-4 text-ink-muted/50" aria-label="Non inclus" />;

const ROWS: Row[] = [
  { group: "Organisation", label: "Tournois actifs simultanés", render: (p) => p.maxActiveTournaments },
  { group: "Organisation", label: "Joueurs par tournoi", render: (p) => p.maxTournamentPlayers },
  { group: "Organisation", label: "Portée maximale", render: (p) => SCOPE_LABELS[p.maxScope] ?? p.maxScope },
  { group: "Organisation", label: "Formats", render: (p) => p.tournamentFormats.map((f) => FORMAT_LABELS[f] ?? f).join(", ") },
  { group: "Organisation", label: "Tournois privés", render: (p) => yes(p.privateTournaments) },
  { group: "Organisation", label: "Tournois payants", render: (p) => yes(p.paidTournaments) },
  { group: "Organisation", label: "Personnalisation visuelle", render: (p) => yes(p.customTournamentBranding) },
  { group: "Communauté", label: "Créer un club", render: (p) => (p.clubCreate ? `${p.maxClubsOwned} club${p.maxClubsOwned > 1 ? "s" : ""}` : yes(false)) },
  { group: "Communauté", label: "Membres par club", render: (p) => p.maxClubMembers },
  { group: "Communauté", label: "Championnats de club", render: (p) => yes(p.clubChampionships) },
  { group: "Joueur", label: "Statistiques avancées", render: (p) => yes(p.advancedStats) },
  { group: "Joueur", label: "Historique consultable", render: (p) => (p.historyDays === 0 ? "Illimité" : `${p.historyDays} jours`) },
  { group: "Joueur", label: "Thèmes de profil", render: (p) => yes(p.profileThemes) },
  { group: "Joueur", label: "Badge Premium", render: (p) => yes(p.badge) },
];

export function PremiumClient() {
  const [tiers, setTiers] = useState<PremiumTier[]>([]);
  const [me, setMe] = useState<{ level: number; tierName: string; expiresAt: string | null } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const load = () =>
    fetch("/api/premium/tiers", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        setTiers(json.tiers ?? []);
        setMe(json.me ?? null);
      });

  useEffect(() => {
    void load();
  }, []);

  async function activate(level: number) {
    setBusy(level);
    setMessage("");
    const response = await fetch("/api/premium/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level }),
    });
    const json = await response.json().catch(() => ({}));
    setBusy(null);
    setMessage(response.ok ? `Niveau ${json.payment?.name ?? level} activé (paiement simulé).` : json.error ?? "Activation impossible.");
    if (response.ok) void load();
  }

  const groups = [...new Set(ROWS.map((r) => r.group))];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Premium"
        title="Des outils pour organiser, animer et progresser"
        description="Le Premium n’offre aucun avantage sur le plateau : il débloque l’organisation de compétitions, les clubs, les statistiques et la personnalisation. Le Survival reste ouvert à tous."
      />

      {me && (
        <div className="card-muted flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
          <Crown className="size-4 text-gold" />
          Votre niveau : <strong>{me.tierName}</strong>
          {me.expiresAt && <span className="text-ink-muted">· jusqu’au {new Date(me.expiresAt).toLocaleDateString("fr-FR")}</span>}
        </div>
      )}
      {message && <p className="text-sm text-ink-soft">{message}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiers.map((tier) => {
          const current = me?.level === tier.level;
          return (
            <article key={tier.level} className={`card flex flex-col p-5 ${current ? "ring-1 ring-accent/50" : ""}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{tier.name}</h2>
                {current && <span className="chip chip-rated">Actuel</span>}
              </div>
              <p className="mt-1 text-sm text-ink-muted">{tier.tagline}</p>
              <p className="tabular mt-4 text-2xl font-semibold">
                {tier.priceCfa === 0 ? "Gratuit" : `${new Intl.NumberFormat("fr-FR").format(tier.priceCfa)} FCFA`}
                {tier.priceCfa > 0 && tier.durationDays > 0 && <span className="text-sm font-normal text-ink-muted"> / {tier.durationDays} j</span>}
              </p>
              <ul className="mt-4 space-y-1.5 text-sm text-ink-soft">
                <li>• {tier.privileges.maxActiveTournaments} tournoi(s) actif(s), jusqu’à {tier.privileges.maxTournamentPlayers} joueurs</li>
                <li>• Portée {SCOPE_LABELS[tier.privileges.maxScope]?.toLowerCase()}</li>
                <li>• {tier.privileges.clubCreate ? `Jusqu’à ${tier.privileges.maxClubsOwned} club(s)` : "Rejoindre des clubs"}</li>
                {tier.privileges.advancedStats && <li>• Statistiques avancées</li>}
              </ul>
              {tier.level > 0 && !current && (
                <div className="mt-auto pt-5">
                  <button type="button" onClick={() => activate(tier.level)} disabled={busy !== null} className="btn btn-primary w-full">
                    {busy === tier.level ? "Activation…" : "Choisir ce niveau"}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {tiers.length > 0 && (
        <section className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-muted">
                <th className="px-4 py-3 text-left font-medium">Comparatif</th>
                {tiers.map((t) => (
                  <th key={t.level} className="px-3 py-3 text-center font-medium">{t.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group}>
                  <tr>
                    <td colSpan={tiers.length + 1} className="eyebrow bg-surface-2 px-4 py-2">{group}</td>
                  </tr>
                  {ROWS.filter((r) => r.group === group).map((row) => (
                    <tr key={row.label} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 text-ink-soft">{row.label}</td>
                      {tiers.map((t) => (
                        <td key={t.level} className="tabular px-3 py-2.5 text-center text-xs">{row.render(t.privileges)}</td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="text-xs text-ink-muted">
        Paiement réel non encore branché : l’activation est simulée en environnement de développement (compte administrateur).
      </p>
    </PageShell>
  );
}
