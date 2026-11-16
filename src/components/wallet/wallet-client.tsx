"use client";

import { AdSlot } from "@/components/ads/ad-slot";
import { Coins, Lock, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page-header";

interface WalletData {
  classic: {
    balance: number;
    transactions: { id: string; transactionType: string; amount: number; description: string; createdAt: string }[];
  };
  rating: {
    global: number;
    provisionalGames: number;
    pools: {
      variant: string;
      variantLabel: string;
      cadence: string | null;
      cadenceLabel: string;
      rating: number;
      gamesPlayed: number;
      wins: number;
      losses: number;
      draws: number;
      provisional: boolean;
      level: string;
    }[];
  };
  money: {
    enabled: boolean;
    verified: boolean;
    requireVerification: boolean;
    available: string;
    locked: string;
    transactions: { id: string; transactionType: string; amount: string; description: string; createdAt: string }[];
  };
}

const TX_LABELS: Record<string, string> = {
  GAME_POINTS_WON: "Victoire",
  GAME_POINTS_LOST: "Défaite",
  BET_PLACED: "Défi engagé",
  BET_WON: "Défi gagné",
  BET_REFUNDED: "Défi remboursé",
  TOURNAMENT_POINTS_ENTRY: "Inscription tournoi",
  TOURNAMENT_POINTS_PRIZE: "Gain tournoi",
  TOURNAMENT_POINTS_REBUY: "Réintégration Survival",
  MOCK_PURCHASE: "Dépôt (simulé)",
  TOURNAMENT_ENTRY: "Inscription tournoi payant",
  TOURNAMENT_PRIZE: "Gain tournoi",
  MONEY_STAKE_LOCKED: "Mise bloquée",
  MONEY_STAKE_WON: "Gain de partie",
  MONEY_STAKE_LOST: "Mise perdue",
  MONEY_STAKE_REFUNDED: "Mise rendue",
  MONEY_COMMISSION: "Commission",
  ADMIN_ADJUSTMENT: "Ajustement administrateur",
};

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const df = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

export function WalletClient() {
  const [data, setData] = useState<WalletData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"classic" | "money">("classic");

  useEffect(() => {
    fetch("/api/wallet", { cache: "no-store" })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? "Erreur de chargement.");
        setData(json);
      })
      .catch((caught: Error) => setError(caught.message));
  }, []);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Mes soldes"
        title="Portefeuille & classements"
        description="Trois systèmes indépendants : vos points classiques (sans valeur monétaire), vos classements ALO/ELO et, si activé, vos points argent."
      />

      {error && (
        <div className="card-muted px-4 py-3 text-sm text-danger">
          {error}{" "}
          {error.includes("Connexion") && <Link href="/" className="underline">Se connecter</Link>}
        </div>
      )}

      {!data && !error && <div className="card h-40 animate-pulse" />}

      {data && (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <article className="card p-5">
              <p className="eyebrow flex items-center gap-1.5"><Sparkles className="size-3.5 text-info" /> Points classiques</p>
              <p className="tabular mt-3 text-3xl font-semibold">{nf.format(data.classic.balance)}</p>
              <p className="mt-1 text-xs text-ink-muted">Parties amicales/classées, tournois et Survival. Non convertibles en argent.</p>
            </article>
            <article className="card p-5">
              <p className="eyebrow flex items-center gap-1.5"><TrendingUp className="size-3.5 text-accent" /> ALO/ELO</p>
              <p className="tabular mt-3 text-3xl font-semibold">{data.rating.global}</p>
              <p className="mt-1 text-xs text-ink-muted">
                Classement général · {data.rating.pools.length} classement{data.rating.pools.length > 1 ? "s" : ""} par jeu et cadence ci-dessous.
              </p>
            </article>
            <article className="card p-5">
              <p className="eyebrow flex items-center gap-1.5"><Coins className="size-3.5 text-money" /> Points argent</p>
              <p className="tabular mt-3 text-3xl font-semibold">{nf.format(Number(data.money.available))} <span className="text-base font-medium text-ink-muted">FCFA</span></p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                <Lock className="size-3" /> {nf.format(Number(data.money.locked))} FCFA bloqués en partie
              </p>
              <p className="mt-2 text-xs">
                {!data.money.enabled ? (
                  <span className="text-ink-muted">Mode rémunéré fermé actuellement.</span>
                ) : data.money.requireVerification && !data.money.verified ? (
                  <span className="text-gold">Compte non vérifié pour le mode rémunéré.</span>
                ) : (
                  <span className="flex items-center gap-1 text-accent"><ShieldCheck className="size-3.5" /> Éligible aux parties rémunérées</span>
                )}
              </p>
            </article>
          </section>

          <section className="card p-5">
            <h2 className="text-base font-semibold">Classements par jeu et cadence</h2>
            <p className="mt-1 text-xs text-ink-muted">
              Un classement est « provisoire » pendant ses {data.rating.provisionalGames} premières parties : il évolue plus vite.
            </p>
            {data.rating.pools.length === 0 ? (
              <div className="mt-4">
                <EmptyState title="Aucune partie classée">
                  Jouez en mode <Link href="/match/en-ligne" className="text-accent underline">Classé</Link> pour obtenir vos premiers classements.
                </EmptyState>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.rating.pools.map((pool) => (
                  <div key={`${pool.variant}-${pool.cadence}`} className="card-muted p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{pool.variantLabel}</p>
                        <p className="text-xs text-ink-muted">{pool.cadenceLabel}</p>
                      </div>
                      <span className={`chip ${pool.provisional ? "" : "chip-rated"}`}>{pool.provisional ? "Provisoire" : pool.level}</span>
                    </div>
                    <p className="tabular mt-3 text-2xl font-semibold">
                      {pool.rating}{pool.provisional && <span className="text-ink-muted">?</span>}
                    </p>
                    <p className="tabular mt-1 text-xs text-ink-muted">
                      {pool.gamesPlayed} parties · {pool.wins} V · {pool.draws} N · {pool.losses} D
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Historique des mouvements</h2>
              <div role="tablist" className="flex rounded-xl border border-line p-1">
                {([
                  ["classic", "Points classiques"],
                  ["money", "Points argent"],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tab === id ? "bg-surface-3 text-ink" : "text-ink-muted hover:text-ink"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <TransactionList
              rows={(tab === "classic" ? data.classic.transactions : data.money.transactions).map((t) => ({
                id: t.id,
                label: TX_LABELS[t.transactionType] ?? t.transactionType,
                description: t.description,
                amount: Number(t.amount),
                date: t.createdAt,
              }))}
              unit={tab === "classic" ? "pts" : "FCFA"}
            />
          </section>
        </>
      )}
      <AdSlot placement="wallet" />
    </PageShell>
  );
}

function TransactionList({
  rows,
  unit,
}: {
  rows: { id: string; label: string; description: string; amount: number; date: string }[];
  unit: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState title="Aucun mouvement pour l’instant." />
      </div>
    );
  }
  return (
    <ul className="mt-4 divide-y divide-line">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium">{row.label}</p>
            <p className="truncate text-xs text-ink-muted">{df.format(new Date(row.date))} · {row.description}</p>
          </div>
          <span className={`tabular shrink-0 text-sm font-semibold ${row.amount > 0 ? "text-accent" : row.amount < 0 ? "text-danger" : "text-ink-muted"}`}>
            {row.amount > 0 ? "+" : ""}
            {nf.format(row.amount)} {unit}
          </span>
        </li>
      ))}
    </ul>
  );
}
