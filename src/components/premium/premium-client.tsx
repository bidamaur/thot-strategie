"use client";

import { BarChart3, Check, Crown, Infinity as InfinityIcon, Minus, ShieldCheck, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { PageShell } from "@/components/ui/page-header";
import { MyPayments } from "@/components/monetization/my-payments";
import { openPremiumGate } from "@/lib/client/premium-gate";
import { configureTelemetry, track, variantOf } from "@/lib/client/telemetry";
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

type Row = { label: string; group: string; render: (p: PremiumPrivileges, ctx: { dailyGames: number | null }) => React.ReactNode };

const yes = (v: boolean) =>
  v ? <Check className="mx-auto size-4 text-accent" aria-label="Inclus" /> : <Minus className="mx-auto size-4 text-ink-muted/50" aria-label="Non inclus" />;

const ROWS: Row[] = [
  { group: "Jouer", label: "Parties en ligne", render: (p, c) => (p.unlimitedGames || c.dailyGames === null ? "Illimitées" : `${c.dailyGames} / jour`) },
  { group: "Jouer", label: "Tournois, Survival, entraînement IA", render: () => "Illimités" },
  { group: "Jouer", label: "Classement ELO et matchmaking", render: () => yes(true) },
  { group: "Progresser", label: "Statistiques avancées", render: (p) => yes(p.advancedStats) },
  { group: "Progresser", label: "Historique des parties", render: (p) => (p.historyDays === 0 ? "Complet" : `${p.historyDays} jours`) },
  { group: "Progresser", label: "Thèmes de profil", render: (p) => yes(p.profileThemes) },
  { group: "Progresser", label: "Badge Premium", render: (p) => yes(p.badge) },
  { group: "Progresser", label: "Navigation sans publicité", render: (p) => yes(Boolean(p.adFree)) },
  { group: "Organiser", label: "Tournois actifs simultanés", render: (p) => p.maxActiveTournaments },
  { group: "Organiser", label: "Joueurs par tournoi", render: (p) => p.maxTournamentPlayers },
  { group: "Organiser", label: "Portée maximale", render: (p) => SCOPE_LABELS[p.maxScope] ?? p.maxScope },
  { group: "Organiser", label: "Formats", render: (p) => p.tournamentFormats.map((f) => FORMAT_LABELS[f] ?? f).join(", ") },
  { group: "Organiser", label: "Tournois privés", render: (p) => yes(p.privateTournaments) },
  { group: "Organiser", label: "Tournois payants", render: (p) => yes(p.paidTournaments) },
  { group: "Organiser", label: "Personnalisation visuelle", render: (p) => yes(p.customTournamentBranding) },
  { group: "Organiser", label: "Invitations groupées", render: (p) => `${p.maxBulkInvites ?? 5} amis` },
  { group: "Clubs et communauté", label: "Créer un club", render: (p) => (p.clubCreate ? `${p.maxClubsOwned} club${p.maxClubsOwned > 1 ? "s" : ""}` : yes(false)) },
  { group: "Clubs et communauté", label: "Membres par club", render: (p) => p.maxClubMembers },
  { group: "Clubs et communauté", label: "Rencontres interclubs", render: (p) => yes(p.clubChampionships) },
  { group: "Clubs et communauté", label: "Logo et couleurs du club", render: (p) => yes(Boolean(p.clubCustomization)) },
  { group: "Clubs et communauté", label: "Salons privés", render: (p) => (p.privateRooms ? p.privateRooms : yes(false)) },
  { group: "Clubs et communauté", label: "Épingler dans vos espaces", render: (p) => yes(Boolean(p.pinInOwnSpaces)) },
  { group: "Clubs et communauté", label: "Statistiques communautaires", render: (p) => yes(Boolean(p.communityStats)) },
  { group: "Clubs et communauté", label: "Amis, discussions, défis", render: () => yes(true) },
];

const HERO = {
  A: {
    title: "Organisez, animez, rassemblez",
    description: "Créez vos tournois et vos clubs, lancez des rencontres interclubs et faites vivre votre communauté. Le jeu reste gratuit et équitable pour tous.",
  },
  B: {
    title: "Progressez plus vite, jouez sans limite",
    description: "Parties illimitées, statistiques avancées et historique complet pour comprendre vos parties. Aucun avantage sur le plateau : seulement des outils.",
  },
} as const;

const BENEFITS = [
  { icon: InfinityIcon, title: "Parties illimitées", text: "Aucun quota quotidien sur les parties en ligne." },
  { icon: BarChart3, title: "Statistiques et historique", text: "Courbe ELO, résultats par couleur et cadence, adversaires fréquents, historique jusqu’à complet." },
  { icon: Trophy, title: "Organisation de tournois", text: "Formats avancés, tournois privés, portée nationale à internationale selon le niveau." },
  { icon: Users, title: "Clubs et interclubs", text: "Créez votre club, personnalisez-le et défiez les autres clubs." },
  { icon: ShieldCheck, title: "Jeu équitable garanti", text: "Le Premium ne donne aucun avantage sur le plateau, ni sur l’ELO, ni sur les gains." },
  { icon: Crown, title: "Sans publicité", text: "Navigation sans annonces dès le premier niveau." },
];

/** Niveau mis en avant : le premier niveau qui inclut les rencontres interclubs (bon compromis pour un joueur régulier). */
function recommendedLevel(tiers: PremiumTier[]) {
  return tiers.find((t) => t.level > 0 && t.privileges.clubChampionships)?.level ?? tiers.find((t) => t.level > 0)?.level ?? null;
}

type ShownTier = PremiumTier & { available: boolean };

export function PremiumClient() {
  const [tiers, setTiers] = useState<ShownTier[]>([]);
  const [me, setMe] = useState<{ level: number; tierName: string; expiresAt: string | null } | null>(null);
  const [dailyGames, setDailyGames] = useState<number | null>(null);
  const [variant, setVariant] = useState<"A" | "B">("A");
  const viewed = useRef(false);

  const load = () =>
    fetch("/api/premium/tiers", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        setTiers(json.tiers ?? []);
        setMe(json.me ?? null);
        setDailyGames(json.freePlan?.dailyGames ?? null);
      });

  useEffect(() => {
    void load();
    // Expérience A/B sur l'accroche, puis mesure de la visite.
    void fetch("/api/engagement?scope=light&path=/premium", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.config) configureTelemetry({ enabled: d.config.analytics, experiments: d.config.experiments });
        const v = variantOf("premium_hero") === "B" ? "B" : "A";
        setVariant(v);
        if (!viewed.current) {
          viewed.current = true;
          const from = new URLSearchParams(window.location.search).get("from") ?? "direct";
          track("premium_view", { from }, { id: "premium_hero", variant: variantOf("premium_hero") });
        }
      })
      .catch(() => undefined);
  }, []);

  /** Choix d'un niveau : fenêtre de paiement Mobile Money (Cameroun) ou de lancement (autres pays). */
  function choose(level: number) {
    track("premium_cta_click", { level }, { id: "premium_hero", variant: variantOf("premium_hero") });
    openPremiumGate("PREMIUM_OFFER", level);
  }

  const groups = [...new Set(ROWS.map((r) => r.group))];
  const recommended = recommendedLevel(tiers);
  const hero = HERO[variant];
  const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n);

  return (
    <PageShell>
      <section className="relative overflow-hidden rounded-3xl border border-gold/15 bg-gradient-to-br from-gold/[0.08] via-surface to-surface p-6 sm:p-10">
        <p className="eyebrow flex items-center gap-2 text-gold"><Crown size={14} /> Premium</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{hero.title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-soft sm:text-base">{hero.description}</p>
        {me && (
          <p className="mt-5 inline-flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
            Votre niveau : <strong>{me.tierName}</strong>
            {me.expiresAt && <span className="text-ink-muted">· jusqu’au {new Date(me.expiresAt).toLocaleDateString("fr-FR")}</span>}
          </p>
        )}
      </section>

      <section aria-label="Ce que vous gagnez" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BENEFITS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card-muted flex gap-3 p-4">
            <Icon size={18} className="mt-0.5 shrink-0 text-gold" aria-hidden />
            <div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-0.5 text-xs leading-5 text-ink-muted">{text}</p>
            </div>
          </div>
        ))}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiers.map((tier) => {
          const current = me?.level === tier.level;
          const highlight = tier.level === recommended;
          const p = tier.privileges;
          return (
            <article key={tier.level} className={`card relative flex flex-col p-5 ${highlight ? "ring-1 ring-gold/50" : current ? "ring-1 ring-accent/50" : ""}`}>
              {highlight && <span className="absolute -top-2.5 left-5 rounded-full bg-gold px-2.5 py-0.5 text-[11px] font-semibold text-accent-ink">Recommandé</span>}
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {tier.level > 0 && <span className="mr-1.5 align-middle text-xs font-semibold text-gold">P{tier.level}</span>}
                  {tier.name}
                </h2>
                {current && <span className="chip chip-rated">Actuel</span>}
              </div>
              <p className="mt-1 text-sm text-ink-muted">{tier.tagline}</p>
              <p className="tabular mt-4 text-2xl font-semibold">
                {tier.priceCfa === 0 ? "Gratuit" : `${fmt(tier.priceCfa)} FCFA`}
                {tier.priceCfa > 0 && tier.durationDays > 0 && <span className="text-sm font-normal text-ink-muted"> / {tier.durationDays} jours</span>}
              </p>
              {tier.priceCfa > 0 && tier.durationDays >= 28 && (
                <p className="tabular text-xs text-ink-muted">soit environ {fmt(Math.round(tier.priceCfa / tier.durationDays))} FCFA par jour</p>
              )}
              <ul className="mt-4 space-y-1.5 text-sm text-ink-soft">
                <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-accent" />{p.unlimitedGames || dailyGames === null ? "Parties en ligne illimitées" : `${dailyGames} parties en ligne par jour`}</li>
                <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-accent" />Historique {p.historyDays === 0 ? "complet" : `de ${p.historyDays} jours`}{p.advancedStats ? " et statistiques avancées" : ""}</li>
                <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-accent" />{p.maxActiveTournaments} tournoi(s) organisé(s), jusqu’à {p.maxTournamentPlayers} joueurs</li>
                <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-accent" />{p.clubCreate ? `Jusqu’à ${p.maxClubsOwned} club(s) de ${p.maxClubMembers} membres` : "Rejoindre des clubs"}</li>
                {p.clubChampionships && <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-accent" />Rencontres interclubs</li>}
                {(p.privateRooms ?? 0) > 0 && <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-accent" />{p.privateRooms} salon(s) privé(s)</li>}
                {p.adFree && <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-accent" />Sans publicité</li>}
              </ul>
              {tier.level > 0 && current && tier.available && (
                <div className="mt-auto pt-5">
                  <button type="button" onClick={() => choose(tier.level)} className="btn btn-ghost w-full border border-line-strong">Prolonger {tier.name}</button>
                </div>
              )}
              {tier.level > 0 && !current && (
                <div className="mt-auto pt-5">
                  <button
                    type="button"
                    onClick={() => choose(tier.level)}
                    disabled={!tier.available || (me?.level ?? 0) > tier.level}
                    className={`btn w-full ${highlight ? "btn-primary" : "btn-ghost border border-line-strong"}`}
                  >
                    {!tier.available ? "Bientôt disponible" : (me?.level ?? 0) > tier.level ? "Inclus dans votre niveau" : `Choisir ${tier.name}`}
                  </button>
                </div>
              )}
              {tier.level === 0 && !me && (
                <div className="mt-auto pt-5">
                  <Link href="/" className="btn btn-ghost w-full border border-line-strong">Créer un compte gratuit</Link>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {tiers.length > 0 && (
        <section className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Comparatif des niveaux</caption>
            <thead>
              <tr className="border-b border-line text-xs text-ink-muted">
                <th scope="col" className="sticky left-0 bg-surface px-4 py-3 text-left font-medium">Comparatif</th>
                {tiers.map((t) => (
                  <th key={t.level} scope="col" className={`px-3 py-3 text-center font-medium ${t.level === recommended ? "text-gold" : ""}`}>{t.name}</th>
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
                      <th scope="row" className="sticky left-0 bg-surface px-4 py-2.5 text-left font-normal text-ink-soft">{row.label}</th>
                      {tiers.map((t) => (
                        <td key={t.level} className="tabular px-3 py-2.5 text-center text-xs">{row.render(t.privileges, { dailyGames })}</td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <MyPayments purpose="PREMIUM" title="Mes paiements Premium" />

      <section className="card space-y-3 p-5 text-sm leading-6 text-ink-soft">
        <h2 className="text-base font-semibold text-ink">Conditions, en clair</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong className="text-ink">Paiement unique</strong> pour la durée indiquée : <strong className="text-ink">aucun renouvellement automatique</strong>, aucun prélèvement sans votre action.</li>
          <li>Au Cameroun, le paiement se fait par <strong className="text-ink">Orange Money</strong> ou <strong className="text-ink">MTN Mobile Money</strong>. Après votre transfert, vous déclarez la référence du SMS : l’abonnement est activé dès que l’administration a vérifié la réception du paiement.</li>
          <li>Renouveler le même niveau prolonge l’abonnement à partir de sa date d’échéance.</li>
          <li>À l’échéance, votre compte repasse simplement à l’offre gratuite : vos parties, votre classement, vos clubs et vos amis sont conservés.</li>
          <li>Passer à un niveau supérieur remplace le niveau en cours à partir du jour de la validation du paiement.</li>
          <li>Le Premium ne donne <strong className="text-ink">aucun avantage de jeu</strong> : même matchmaking, même calcul ELO, mêmes règles et mêmes gains pour tous.</li>
          <li>Les points classiques, le classement ELO et les points argent restent strictement séparés : le Premium ne s’achète pas avec des points et n’en donne pas.</li>
          <li>Hors du Cameroun, les paiements internationaux ouvriront prochainement : vous pouvez demander à être prévenu.</li>
        </ul>
      </section>
    </PageShell>
  );
}
