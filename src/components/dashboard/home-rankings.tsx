"use client";

import { Crown, Info, Medal, Trophy } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CountryFlag } from "@/components/ui/country";
import type { HomeRankingEntry, HomeRankings as Data } from "@/lib/rankings/home";

const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n).replace(/ | /g, " ");

function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src && (src.startsWith("/") || src.startsWith("http"))) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="size-8 shrink-0 rounded-full object-cover" loading="lazy" />;
  }
  return (
    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-sm">
      {src || name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function RankBadge({ rank, gold }: { rank: number; gold?: boolean }) {
  const podium = rank <= 3;
  return (
    <span
      className={`tabular flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        podium ? (gold || rank === 1 ? "bg-gold/20 text-gold" : rank === 2 ? "bg-white/10 text-ink" : "bg-[#c08457]/20 text-[#e0a47a]") : "text-ink-muted"
      }`}
      aria-label={`${rank}e`}
    >
      {rank}
    </span>
  );
}

function Row({ e, gold }: { e: HomeRankingEntry; gold?: boolean }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2 sm:px-4">
      <RankBadge rank={e.rank} gold={gold} />
      <Avatar src={e.avatar} name={e.username} />
      <div className="min-w-0 flex-1">
        <Link href={`/joueurs/${encodeURIComponent(e.username)}`} className="flex items-center gap-1.5 truncate text-sm font-medium text-ink hover:underline">
          <CountryFlag country={e.country} className="text-base" />
          <span className="truncate">{e.username}</span>
        </Link>
        <p className="tabular truncate text-[11px] text-ink-muted">
          {e.elo} ELO · {e.eloLabel}
          {e.points !== null && <> · {fmt(e.points)} pts</>}
        </p>
      </div>
      <span className="tabular text-right" title="Indice Thot (0 à 1000)">
        <span className={`block text-sm font-semibold ${gold ? "text-gold" : "text-ink"}`}>{e.index}</span>
        <span className="block text-[10px] text-ink-muted">indice</span>
      </span>
    </li>
  );
}

/** Top 20 des joueurs et Top 10 Or (comptes monétisés) de la page d'accueil. */
export function HomeRankings() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/rankings/home")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: Data) => active && setData(d))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  if (failed || (data && !data.top && !data.gold)) return null;
  if (!data) return <section className="h-72 animate-pulse rounded-3xl border border-white/10 bg-white/[0.03]" aria-busy="true" aria-label="Chargement des classements" />;

  return (
    <section aria-labelledby="home-rankings" className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      {data.top && (
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035]">
          <header className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-3 sm:px-5">
            <div>
              <h2 id="home-rankings" className="flex items-center gap-2 text-base font-semibold">
                <Trophy className="size-4 text-accent" /> Top 20 des joueurs
              </h2>
              <p className="mt-0.5 text-[11px] text-ink-muted">
                Indice Thot : {data.eloWeight} % ELO + {100 - data.eloWeight} % points classiques, sur 1000
              </p>
            </div>
            <Link href="/classements" className="shrink-0 text-xs text-accent hover:underline">Tous les classements</Link>
          </header>
          {data.top.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">Le classement apparaîtra dès que des joueurs auront joué {data.minGames} parties classées.</p>
          ) : (
            <ol className="grid divide-y divide-white/[0.05] sm:grid-cols-2 sm:divide-y-0">
              {data.top.map((e) => <Row key={e.id} e={e} />)}
            </ol>
          )}
        </div>
      )}
      {data.gold && (
        <div className="overflow-hidden rounded-3xl border border-gold/25 bg-gradient-to-b from-gold/[0.07] to-transparent">
          <header className="border-b border-gold/15 px-4 py-3 sm:px-5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gold">
              <Crown className="size-4" /> Top 10 Or
            </h2>
            <p className="mt-0.5 flex items-start gap-1 text-[11px] text-ink-muted">
              <Info className="mt-px size-3 shrink-0" />
              Comptes monétisés · {data.goldEloWeight} % ELO + {100 - data.goldEloWeight} % points argent. Les soldes ne sont jamais affichés.
            </p>
          </header>
          {data.gold.length === 0 ? (
            <p className="flex items-center gap-2 px-5 py-6 text-sm text-ink-muted"><Medal className="size-4" /> Aucun compte monétisé classé pour le moment.</p>
          ) : (
            <ol className="divide-y divide-gold/10">{data.gold.map((e) => <Row key={e.id} e={e} gold />)}</ol>
          )}
        </div>
      )}
    </section>
  );
}
