"use client";

import { LoaderCircle, Lock, Trophy } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PremiumHint } from "@/components/premium/premium-hint";

type Result = "WIN" | "LOSS" | "DRAW";
interface Game {
  id: string;
  gameType: "CHESS" | "CHECKERS";
  draughtsVariant: string | null;
  mode: "CASUAL" | "RATED" | "MONEY";
  timeControlMinutes: number | null;
  createdAt: string;
  color: "WHITE" | "BLACK";
  opponent: { username: string; avatar: string | null } | null;
  result: Result;
  eloDelta: number | null;
  tournament: boolean;
}
interface Tally { played: number; wins: number; losses: number; draws: number; winRate: number | null }
interface Stats {
  essential: { overall: { all: Tally; CHESS: Tally; CHECKERS: Tally }; ratings: { variant: string; timeControl: string | null; eloRating: number; gamesPlayed: number }[] };
  advancedLocked: boolean;
  advanced: null | {
    sample: number;
    byColor: Record<string, Tally>;
    byMode: Record<string, Tally>;
    byCadence: Record<string, Tally>;
    byVariant: Record<string, Tally>;
    topOpponents: (Tally & { username: string })[];
    averagePlies: number | null;
    activityByMonth: { month: string; games: number }[];
    ratingTrend: { variant: string; timeControl: string | null; newRating: number; change: number; createdAt: string }[];
    bestWin: { opponent: string | null; opponentRating: number | null; matchId: string | null; date: string; variant: string } | null;
  };
}

const LABELS: Record<string, string> = {
  WHITE: "Blancs", BLACK: "Noirs", CASUAL: "Amicales", RATED: "Classées", MONEY: "Rémunérées",
  BULLET: "Bullet", BLITZ: "Blitz", RAPID: "Rapide", CLASSICAL: "Classique", UNLIMITED: "Sans pendule",
  CHESS: "Échecs", INTERNATIONAL: "Dames internationales", ENGLISH: "Dames anglaises",
};
const RESULT_STYLE: Record<Result, string> = { WIN: "text-accent", LOSS: "text-danger", DRAW: "text-ink-muted" };
const RESULT_LABEL: Record<Result, string> = { WIN: "Victoire", LOSS: "Défaite", DRAW: "Nulle" };

function TallyBar({ label, t }: { label: string; t: Tally }) {
  const pct = (n: number) => (t.played ? (n / t.played) * 100 : 0);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ink-soft">{label}</span>
        <span className="tabular text-ink-muted">{t.played} parties · {t.winRate ?? 0} %</span>
      </div>
      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-surface-3" aria-label={`${t.wins} victoires, ${t.draws} nulles, ${t.losses} défaites`}>
        <span className="bg-accent" style={{ width: `${pct(t.wins)}%` }} />
        <span className="bg-ink-muted/50" style={{ width: `${pct(t.draws)}%` }} />
        <span className="bg-danger/70" style={{ width: `${pct(t.losses)}%` }} />
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <p className="text-xs text-ink-muted">Jouez des parties classées pour voir votre courbe.</p>;
  const min = Math.min(...points), max = Math.max(...points), span = Math.max(1, max - min);
  const d = points.map((p, i) => `${(i / (points.length - 1)) * 300},${60 - ((p - min) / span) * 56 - 2}`).join(" ");
  return (
    <svg viewBox="0 0 300 60" className="h-16 w-full" role="img" aria-label={`Classement de ${points[0]} à ${points[points.length - 1]}`}>
      <polyline points={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function MyGames() {
  const [tab, setTab] = useState<"history" | "stats">("history");
  const [games, setGames] = useState<Game[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ historyDays: number; hiddenOlder: number } | null>(null);
  const [type, setType] = useState<"" | "CHESS" | "CHECKERS">("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadGames = useCallback(async (reset: boolean, from: string | null) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (!reset && from) params.set("cursor", from);
    if (type) params.set("type", type);
    const r = await fetch(`/api/player/games?${params}`, { cache: "no-store" });
    const json = await r.json().catch(() => ({}));
    setLoading(false);
    if (r.status === 401) return setError("Connectez-vous pour retrouver vos parties.");
    if (!r.ok) return setError(json.error ?? "Chargement impossible.");
    setGames((current) => (reset ? json.items : [...current, ...json.items]));
    setCursor(json.nextCursor);
    if (reset) setMeta({ historyDays: json.historyDays, hiddenOlder: json.hiddenOlder });
  }, [type]);

  useEffect(() => {
    const handle = setTimeout(() => void loadGames(true, null), 0);
    return () => clearTimeout(handle);
  }, [loadGames]);

  useEffect(() => {
    if (tab !== "stats" || stats) return;
    const handle = setTimeout(() => {
      void fetch("/api/player/stats", { cache: "no-store" })
        .then((r) => r.json())
        .then((json) => (json.essential ? setStats(json) : setError(json.error ?? "Statistiques indisponibles.")))
        .catch(() => setError("Statistiques indisponibles."));
    }, 0);
    return () => clearTimeout(handle);
  }, [tab, stats]);

  if (error) return <p className="card p-6 text-sm text-ink-soft">{error} <Link href="/" className="text-accent underline">Accueil</Link></p>;

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex gap-1 rounded-xl border border-line bg-surface p-1 text-sm sm:w-fit">
        {(["history", "stats"] as const).map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)}
            className={`flex-1 rounded-lg px-4 py-2 sm:flex-none ${tab === id ? "bg-surface-3 text-ink" : "text-ink-muted hover:text-ink"}`}>
            {id === "history" ? "Historique" : "Statistiques"}
          </button>
        ))}
      </div>

      {tab === "history" && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(["", "CHESS", "CHECKERS"] as const).map((t) => (
              <button key={t || "all"} type="button" onClick={() => setType(t)} className={`chip ${type === t ? "chip-rated" : ""}`}>
                {t === "" ? "Tous les jeux" : t === "CHESS" ? "Échecs" : "Dames"}
              </button>
            ))}
            {meta && <span className="ml-auto text-ink-muted">{meta.historyDays > 0 ? `Historique des ${meta.historyDays} derniers jours` : "Historique complet"}</span>}
          </div>

          <ul className="card divide-y divide-line p-0">
            {games.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className={`w-16 shrink-0 text-xs font-semibold ${RESULT_STYLE[g.result]}`}>{RESULT_LABEL[g.result]}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    contre <strong>{g.opponent?.username ?? "—"}</strong>
                    {g.tournament && <Trophy size={12} className="ml-1 inline text-gold" aria-label="Tournoi" />}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {g.gameType === "CHESS" ? "Échecs" : LABELS[g.draughtsVariant ?? "INTERNATIONAL"]} · {LABELS[g.mode]} · {g.timeControlMinutes ? `${g.timeControlMinutes} min` : "sans pendule"} · {LABELS[g.color]}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {g.eloDelta !== null && <p className={`tabular text-xs ${g.eloDelta >= 0 ? "text-accent" : "text-danger"}`}>{g.eloDelta >= 0 ? "+" : ""}{g.eloDelta} ELO</p>}
                  <p className="text-[11px] text-ink-muted">{new Date(g.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</p>
                </div>
              </li>
            ))}
            {!loading && games.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-ink-muted">
                Aucune partie pour l’instant. <Link href="/match/en-ligne" className="text-accent underline">Jouer une partie</Link>
              </li>
            )}
          </ul>
          {loading && <p className="flex items-center gap-2 text-xs text-ink-muted"><LoaderCircle size={14} className="animate-spin" /> Chargement…</p>}
          {cursor && !loading && (
            <button type="button" className="btn btn-ghost w-full" onClick={() => void loadGames(false, cursor)}>Parties plus anciennes</button>
          )}
          {meta && meta.hiddenOlder > 0 && !cursor && (
            <PremiumHint context="history" title={`${meta.hiddenOlder} partie${meta.hiddenOlder > 1 ? "s" : ""} plus ancienne${meta.hiddenOlder > 1 ? "s" : ""} conservée${meta.hiddenOlder > 1 ? "s" : ""}`}>
              Votre niveau affiche les {meta.historyDays} derniers jours. Rien n’est supprimé : les niveaux Premium donnent accès à un historique plus long, jusqu’à l’historique complet.
            </PremiumHint>
          )}
        </section>
      )}

      {tab === "stats" && !stats && <p className="flex items-center gap-2 text-xs text-ink-muted"><LoaderCircle size={14} className="animate-spin" /> Calcul de vos statistiques…</p>}
      {tab === "stats" && stats && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {(["all", "CHESS", "CHECKERS"] as const).map((k) => {
              const t = stats.essential.overall[k];
              return (
                <div key={k} className="card p-4">
                  <p className="eyebrow">{k === "all" ? "Toutes parties" : LABELS[k] ?? "Dames"}</p>
                  <p className="tabular mt-2 text-2xl font-semibold">{t.played}</p>
                  <p className="tabular text-xs text-ink-muted">{t.wins} V · {t.draws} N · {t.losses} D · {t.winRate ?? 0} % de victoires</p>
                </div>
              );
            })}
          </div>
          {stats.essential.ratings.length > 0 && (
            <div className="card p-4">
              <p className="eyebrow">Classements par catégorie</p>
              <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                {stats.essential.ratings.map((r) => (
                  <li key={`${r.variant}:${r.timeControl}`} className="flex justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                    <span className="text-ink-soft">{LABELS[r.variant] ?? r.variant} · {LABELS[r.timeControl ?? ""] ?? r.timeControl ?? "toutes cadences"}</span>
                    <span className="tabular font-semibold">{r.eloRating}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {stats.advanced ? (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="card space-y-3 p-4">
                  <p className="eyebrow">Courbe de classement (60 dernières variations)</p>
                  <Sparkline points={stats.advanced.ratingTrend.map((t) => t.newRating)} />
                  {stats.advanced.bestWin && (
                    <p className="text-xs text-ink-muted">
                      Meilleure victoire : <strong className="text-ink">{stats.advanced.bestWin.opponent ?? "?"}</strong> ({stats.advanced.bestWin.opponentRating} ELO) le {new Date(stats.advanced.bestWin.date).toLocaleDateString("fr-FR")}
                    </p>
                  )}
                  {stats.advanced.averagePlies !== null && <p className="text-xs text-ink-muted">Longueur moyenne : {stats.advanced.averagePlies} demi-coups sur {stats.advanced.sample} parties</p>}
                </div>
                <div className="card space-y-3 p-4">
                  <p className="eyebrow">Par couleur</p>
                  {Object.entries(stats.advanced.byColor).map(([k, t]) => <TallyBar key={k} label={LABELS[k] ?? k} t={t} />)}
                  <p className="eyebrow pt-2">Par mode</p>
                  {Object.entries(stats.advanced.byMode).map(([k, t]) => <TallyBar key={k} label={LABELS[k] ?? k} t={t} />)}
                </div>
                <div className="card space-y-3 p-4">
                  <p className="eyebrow">Par cadence</p>
                  {Object.entries(stats.advanced.byCadence).map(([k, t]) => <TallyBar key={k} label={LABELS[k] ?? k} t={t} />)}
                  <p className="eyebrow pt-2">Par jeu</p>
                  {Object.entries(stats.advanced.byVariant).map(([k, t]) => <TallyBar key={k} label={LABELS[k] ?? k} t={t} />)}
                </div>
                <div className="card space-y-3 p-4">
                  <p className="eyebrow">Adversaires les plus fréquents</p>
                  {stats.advanced.topOpponents.map((o) => <TallyBar key={o.username} label={o.username} t={o} />)}
                  <p className="eyebrow pt-2">Activité mensuelle</p>
                  <div className="flex h-20 items-end gap-2">
                    {stats.advanced.activityByMonth.map((m) => {
                      const max = Math.max(...stats.advanced!.activityByMonth.map((x) => x.games), 1);
                      return (
                        <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                          <span className="w-full rounded-t bg-accent/70" style={{ height: `${(m.games / max) * 56 + 4}px` }} title={`${m.games} parties`} />
                          <span className="text-[10px] text-ink-muted">{m.month.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="card relative overflow-hidden p-5">
              <div className="flex items-center gap-2 text-sm font-medium"><Lock size={15} className="text-gold" /> Statistiques avancées</div>
              <p className="mt-1 text-xs leading-5 text-ink-muted">
                Courbe de classement, résultats par couleur, cadence et mode, adversaires fréquents, meilleure victoire, activité mensuelle.
              </p>
              <div className="mt-3">
                <PremiumHint context="stats" title="Comprendre où vous gagnez et où vous perdez">
                  Les statistiques avancées sont incluses dès le premier niveau Premium. Elles n’influencent jamais le jeu : uniquement l’analyse de vos parties.
                </PremiumHint>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
