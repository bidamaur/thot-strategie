"use client";

import { ArrowLeft, Crown, Flag, Gavel, Play, RefreshCw, Swords, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageShell } from "@/components/ui/page-header";

interface PlayerRef {
  id: string;
  username: string;
}

interface TournamentMatchRow {
  id: string;
  stage: "MAIN" | "THIRD_PLACE";
  round: number;
  matchNumber: number;
  status: "WAITING" | "IN_PROGRESS" | "FINISHED";
  playerWhite: PlayerRef | null;
  playerBlack: PlayerRef | null;
  winner: PlayerRef | null;
  winnerId: string | null;
  liveGameId: string | null;
}

interface Detail {
  tournament: {
    id: string;
    name: string;
    description: string | null;
    type: string;
    status: "DRAFT" | "OPEN" | "IN_PROGRESS" | "COMPLETED";
    gameType: "CHESS" | "CHECKERS";
    draughtsVariant: "ENGLISH" | "INTERNATIONAL";
    timeControlMinutes: number | null;
    maxPlayers: number;
    entryPoints: number;
    isPaid: boolean;
    entryFee: string;
    visibility: string;
    creator: PlayerRef;
    club: { name: string; slug: string } | null;
    participants: { userId: string; seed: number; placement: number | null; status: string; user: PlayerRef & { elo: number } }[];
    bracketMatches: TournamentMatchRow[];
  };
  format: "STANDINGS" | "BRACKET";
  standings:
    | { userId: string; username: string; rank: number; score: number; played: number; wins: number; draws: number; losses: number; byes: number; buchholz: number; sonnebornBerger: number }[]
    | null;
  viewer: { id: string; isParticipant: boolean; isOrganizer: boolean; isAdmin: boolean } | null;
}

const FORMAT_LABELS: Record<string, string> = {
  SURVIVAL_BANK: "Survival",
  ELIMINATION: "Élimination directe",
  SWISS: "Système suisse",
  ROUND_ROBIN: "Toutes rondes",
  LEAGUE: "Ligue aller-retour",
  ARENA: "Arena",
  DOUBLE_ELIMINATION: "Double élimination",
  GROUPS_ELIMINATION: "Groupes + phase finale",
};
const STATUS_LABELS = { DRAFT: "Brouillon", OPEN: "Inscriptions ouvertes", IN_PROGRESS: "En cours", COMPLETED: "Terminé" } as const;

function scoreLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : `${Math.floor(value) || ""}½`;
}

export function TournamentDetailClient({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/tournaments/${encodeURIComponent(tournamentId)}`, { cache: "no-store" });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(json.error ?? "Tournoi introuvable.");
      return;
    }
    setError("");
    setData(json);
  }, [tournamentId]);

  useEffect(() => {
    void load();
    // Actualisation douce : les résultats des parties en ligne arrivent côté serveur.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const rounds = useMemo(() => {
    const map = new Map<number, TournamentMatchRow[]>();
    for (const m of data?.tournament.bracketMatches ?? []) {
      map.set(m.round, [...(map.get(m.round) ?? []), m]);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [data]);

  async function play(match: TournamentMatchRow) {
    if (match.liveGameId) {
      router.push(`/match/${match.liveGameId}`);
      return;
    }
    setBusy(match.id);
    const response = await fetch(`/api/tournaments/${tournamentId}/matches/${match.id}/play`, { method: "POST" });
    const json = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      setNotice(json.error ?? "Impossible de lancer la partie.");
      return;
    }
    router.push(`/match/${json.matchId}`);
  }

  async function submitResult(match: TournamentMatchRow, winnerId: string | null, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(match.id);
    const response = await fetch(`/api/tournaments/${tournamentId}/matches/${match.id}/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winnerId }),
    });
    const json = await response.json().catch(() => ({}));
    setBusy(null);
    setNotice(response.ok ? "Résultat enregistré." : json.error ?? "Enregistrement impossible.");
    await load();
  }

  if (!data) {
    return (
      <PageShell width="max-w-5xl">
        {error ? (
          <EmptyState title={error}>
            <Link href="/tournois" className="text-accent underline">Retour aux tournois</Link>
          </EmptyState>
        ) : (
          <div className="card h-56 animate-pulse" />
        )}
      </PageShell>
    );
  }

  const { tournament, viewer } = data;
  const isArbiterFor = (m: TournamentMatchRow) =>
    Boolean(viewer && (viewer.isAdmin || (viewer.isOrganizer && viewer.id !== m.playerWhite?.id && viewer.id !== m.playerBlack?.id)));
  const champion = tournament.status === "COMPLETED"
    ? data.standings?.[0]?.username ?? tournament.participants.find((p) => p.placement === 1)?.user.username
    : null;

  return (
    <PageShell width="max-w-6xl">
      <Link href="/tournois" className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Tournois
      </Link>

      <header className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <span className="chip chip-rated">{FORMAT_LABELS[tournament.type] ?? tournament.type}</span>
              <span className="chip">{STATUS_LABELS[tournament.status]}</span>
              {tournament.visibility !== "PUBLIC" && <span className="chip">{tournament.visibility === "PRIVATE" ? "Privé" : "Club"}</span>}
            </div>
            <h1 className="mt-3 text-2xl font-semibold">{tournament.name}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {tournament.gameType === "CHESS" ? "Échecs" : tournament.draughtsVariant === "ENGLISH" ? "Dames 8×8" : "Dames 10×10"}
              {" · "}
              {tournament.timeControlMinutes ? `${tournament.timeControlMinutes} min` : "sans pendule"}
              {" · "}
              {tournament.participants.length}/{tournament.maxPlayers} joueurs
              {" · "}organisé par {tournament.creator.username}
              {tournament.club && (
                <>
                  {" · "}
                  <Link href={`/clubs/${tournament.club.slug}`} className="underline">{tournament.club.name}</Link>
                </>
              )}
            </p>
            {tournament.description && <p className="mt-3 max-w-3xl text-sm text-ink-soft">{tournament.description}</p>}
          </div>
          <button type="button" onClick={() => void load()} className="btn btn-ghost min-h-0 px-3 py-1.5" aria-label="Actualiser">
            <RefreshCw className="size-4" />
          </button>
        </div>
        {champion && (
          <p className="mt-4 flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold">
            <Crown className="size-4" /> Vainqueur : <strong>{champion}</strong>
          </p>
        )}
      </header>

      {notice && <p className="card-muted px-4 py-3 text-sm text-ink-soft">{notice}</p>}

      {tournament.status === "OPEN" && (
        <EmptyState title="En attente des inscriptions">
          Le tournoi démarre automatiquement dès que les {tournament.maxPlayers} places sont prises.
        </EmptyState>
      )}

      <div className={`grid gap-4 ${data.format === "STANDINGS" ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" : ""}`}>
        {data.standings && tournament.status !== "OPEN" && (
          <section className="card self-start overflow-hidden">
            <h2 className="px-5 pt-5 text-base font-semibold">Classement</h2>
            <p className="px-5 text-xs text-ink-muted">Départages : Buchholz, puis Sonneborn-Berger, puis victoires.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="border-y border-line text-xs text-ink-muted">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">#</th>
                    <th className="px-2 py-2 text-left font-medium">Joueur</th>
                    <th className="px-2 py-2 text-right font-medium">Pts</th>
                    <th className="px-2 py-2 text-right font-medium">V/N/D</th>
                    <th className="px-2 py-2 text-right font-medium" title="Buchholz">Bu.</th>
                    <th className="px-4 py-2 text-right font-medium" title="Sonneborn-Berger">S-B</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.standings.map((row) => (
                    <tr key={row.userId} className={row.userId === viewer?.id ? "bg-accent/[0.06]" : ""}>
                      <td className="tabular px-4 py-2 text-ink-muted">{row.rank}</td>
                      <td className="px-2 py-2 font-medium">{row.username}</td>
                      <td className="tabular px-2 py-2 text-right font-semibold">{scoreLabel(row.score)}</td>
                      <td className="tabular px-2 py-2 text-right text-ink-muted">{row.wins}/{row.draws}/{row.losses}</td>
                      <td className="tabular px-2 py-2 text-right text-ink-muted">{scoreLabel(row.buchholz)}</td>
                      <td className="tabular px-4 py-2 text-right text-ink-muted">{row.sonnebornBerger.toFixed(2).replace(/\.?0+$/, "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {rounds.length > 0 && (
          <section className="space-y-3">
            {rounds.map(([round, matches]) => (
              <div key={round} className="card p-4">
                <h3 className="eyebrow">Ronde {round}{matches.some((m) => m.stage === "THIRD_PLACE") ? " · finale et 3e place" : ""}</h3>
                <ul className="mt-2 space-y-2">
                  {matches.map((m) => {
                    const mine = viewer && (viewer.id === m.playerWhite?.id || viewer.id === m.playerBlack?.id);
                    const opponent = viewer?.id === m.playerWhite?.id ? m.playerBlack : m.playerWhite;
                    const bye = !m.playerBlack;
                    const playable = tournament.status === "IN_PROGRESS" && m.status !== "FINISHED" && !bye;
                    return (
                      <li key={m.id} className={`card-muted px-3 py-2.5 ${mine ? "ring-1 ring-accent/40" : ""}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="min-w-0 text-sm">
                            {m.stage === "THIRD_PLACE" && <span className="text-xs text-ink-muted">3e place · </span>}
                            <span className={m.winnerId && m.winnerId === m.playerWhite?.id ? "font-semibold text-accent" : ""}>
                              {m.playerWhite?.username ?? "—"}
                            </span>
                            <span className="text-ink-muted"> vs </span>
                            {bye ? (
                              <span className="text-ink-muted">exempt (1 pt)</span>
                            ) : (
                              <span className={m.winnerId && m.winnerId === m.playerBlack?.id ? "font-semibold text-accent" : ""}>
                                {m.playerBlack?.username ?? "—"}
                              </span>
                            )}
                          </p>
                          <span className="text-xs text-ink-muted">
                            {m.status === "FINISHED"
                              ? bye ? "" : m.winnerId ? `Gagné par ${m.winner?.username}` : "Nulle"
                              : m.liveGameId ? "Partie en cours" : "À jouer"}
                          </span>
                        </div>

                        {playable && (mine || isArbiterFor(m)) && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {mine && (
                              <button type="button" disabled={busy === m.id} onClick={() => play(m)} className="btn btn-primary min-h-0 px-3 py-1.5 text-xs">
                                <Play className="size-3.5" /> {m.liveGameId ? "Rejoindre la partie" : "Jouer maintenant"}
                              </button>
                            )}
                            {mine && opponent && !m.liveGameId && (
                              <button
                                type="button"
                                disabled={busy === m.id}
                                onClick={() => submitResult(m, opponent.id, `Concéder la victoire à ${opponent.username} ?`)}
                                className="btn btn-danger min-h-0 px-3 py-1.5 text-xs"
                              >
                                <Flag className="size-3.5" /> Concéder
                              </button>
                            )}
                            {isArbiterFor(m) && !m.liveGameId && m.playerWhite && m.playerBlack && (
                              <span className="flex flex-wrap items-center gap-1.5">
                                <Gavel className="size-3.5 text-ink-muted" aria-label="Arbitrage" />
                                {[m.playerWhite, m.playerBlack].map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    disabled={busy === m.id}
                                    onClick={() => submitResult(m, p.id, `Déclarer ${p.username} vainqueur (arbitrage tracé) ?`)}
                                    className="btn btn-ghost min-h-0 px-2.5 py-1 text-xs"
                                  >
                                    {p.username}
                                  </button>
                                ))}
                                {data.format === "STANDINGS" && (
                                  <button
                                    type="button"
                                    disabled={busy === m.id}
                                    onClick={() => submitResult(m, null, "Déclarer une nulle (arbitrage tracé) ?")}
                                    className="btn btn-ghost min-h-0 px-2.5 py-1 text-xs"
                                  >
                                    Nulle
                                  </button>
                                )}
                              </span>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        )}
      </div>

      {tournament.status !== "OPEN" && rounds.length === 0 && (
        <EmptyState title="Aucun appariement">
          <Swords className="mx-auto mb-2 size-5" />
          Les appariements apparaîtront ici.
        </EmptyState>
      )}
      {data.format === "BRACKET" && tournament.status === "COMPLETED" && (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Trophy className="size-4 text-gold" /> Podium</h2>
          <ol className="mt-3 space-y-1 text-sm">
            {[...tournament.participants]
              .filter((p) => p.placement !== null)
              .sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99))
              .slice(0, 4)
              .map((p) => (
                <li key={p.userId} className="flex justify-between">
                  <span>{p.placement}. {p.user.username}</span>
                </li>
              ))}
          </ol>
        </section>
      )}
    </PageShell>
  );
}
