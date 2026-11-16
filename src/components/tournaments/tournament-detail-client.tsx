"use client";

import { AdSlot } from "@/components/ads/ad-slot";
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
  stage: "MAIN" | "THIRD_PLACE" | "GROUP" | "KNOCKOUT" | "WINNERS" | "LOSERS" | "GRAND_FINAL";
  groupNumber: number | null;
  round: number;
  matchNumber: number;
  status: "WAITING" | "IN_PROGRESS" | "FINISHED";
  playerWhite: PlayerRef | null;
  playerBlack: PlayerRef | null;
  winner: PlayerRef | null;
  winnerId: string | null;
  liveGameId: string | null;
  betAmount: number | null;
}

interface SurvivalWallet {
  userId: string;
  username: string;
  capital: number;
  initialCapital: number;
  status: "ACTIVE" | "ELIMINATED" | "WON" | "WITHDRAWN";
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  matchesDrawn: number;
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
    wallets: SurvivalWallet[];
    stopVotes: string[];
    endsAt: string | null;
    durationDays: number | null;
    minBet: number | null;
    maxBet: number | null;
    betMode: "FIXED" | "VARIABLE";
  };
  format: "STANDINGS" | "BRACKET" | "SURVIVAL" | "GROUPS" | "DOUBLE" | "ARENA";
  groups:
    | { group: number; rows: { userId: string; username: string; rank: number; score: number; wins: number; draws: number; losses: number; buchholz: number }[] }[]
    | null;
  arena: { userId: string; username: string; rank: number; score: number; games: number; wins: number; draws: number; losses: number; onFire: boolean }[] | null;
  arenaWaiting: boolean;
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

  // Sections : étape (groupes, tableau des vainqueurs/perdants…), groupe et ronde.
  const rounds = useMemo(() => {
    const STAGE_ORDER: Record<string, number> = { GROUP: 0, MAIN: 1, KNOCKOUT: 1, WINNERS: 1, LOSERS: 2, THIRD_PLACE: 1, GRAND_FINAL: 3 };
    const map = new Map<string, { label: string; order: number[]; matches: TournamentMatchRow[] }>();
    const arena = data?.format === "ARENA";
    for (const m of data?.tournament.bracketMatches ?? []) {
      const stage = m.stage === "THIRD_PLACE" ? (data?.format === "GROUPS" ? "KNOCKOUT" : "MAIN") : m.stage;
      const key = arena ? "arena" : `${stage}-${m.groupNumber ?? 0}-${m.round}`;
      const label = arena
        ? "Parties de l’Arena"
        : stage === "GROUP"
          ? `Groupe ${String.fromCharCode(64 + (m.groupNumber ?? 1))} · ronde ${m.round}`
          : stage === "WINNERS"
            ? `Tableau des vainqueurs · ronde ${m.round}`
            : stage === "LOSERS"
              ? `Tableau des perdants · ronde ${m.round}`
              : stage === "GRAND_FINAL"
                ? m.round === 1 ? "Grande finale" : "Grande finale · match décisif"
                : stage === "KNOCKOUT"
                  ? `Phase finale · tour ${m.round}`
                  : `Ronde ${m.round}`;
      const entry = map.get(key) ?? { label, order: [STAGE_ORDER[stage] ?? 1, m.groupNumber ?? 0, m.round], matches: [] };
      entry.matches.push(m);
      map.set(key, entry);
    }
    const list = [...map.values()].sort(
      (a, b) => a.order[0]! - b.order[0]! || a.order[2]! - b.order[2]! || a.order[1]! - b.order[1]!,
    );
    if (arena) list.forEach((r) => r.matches.reverse());
    return list;
  }, [data]);

  // Arena : en recherche, on vérifie régulièrement si un adversaire a été trouvé.
  useEffect(() => {
    if (!data?.arenaWaiting) return;
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [data?.arenaWaiting, load]);
  useEffect(() => {
    if (data?.format !== "ARENA" || !data.viewer) return;
    const live = data.tournament.bracketMatches.find(
      (m) => m.liveGameId && (m.playerWhite?.id === data.viewer!.id || m.playerBlack?.id === data.viewer!.id),
    );
    if (live?.liveGameId) router.push(`/match/${live.liveGameId}`);
  }, [data, router]);

  async function arenaAction(action: "search" | "cancel") {
    setBusy("arena");
    const response = await fetch(`/api/tournaments/${tournamentId}/arena`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      setNotice(json.error ?? "Action impossible.");
      return;
    }
    if (json.status === "MATCHED" && json.matchId) {
      router.push(`/match/${json.matchId}`);
      return;
    }
    await load();
  }

  async function startNow() {
    if (!window.confirm("Démarrer le tournoi maintenant avec les joueurs déjà inscrits ?")) return;
    setBusy("start");
    const response = await fetch(`/api/tournaments/${tournamentId}/start`, { method: "POST" });
    const json = await response.json().catch(() => ({}));
    setBusy(null);
    setNotice(response.ok ? "Tournoi démarré." : json.error ?? "Démarrage impossible.");
    await load();
  }

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

  async function voteStop(agree: boolean) {
    if (agree && !window.confirm("Demander l’arrêt du tournoi ? Il s’arrêtera si tous les joueurs encore en jeu sont d’accord, et chacun gardera son capital.")) return;
    setBusy("vote");
    const response = await fetch(`/api/tournaments/${tournamentId}/stop-vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agree }),
    });
    const json = await response.json().catch(() => ({}));
    setBusy(null);
    setNotice(
      response.ok
        ? json.stopped
          ? "Tous les joueurs sont d’accord : le tournoi est arrêté, chacun garde son capital."
          : json.pendingStop
            ? "Tous les joueurs sont d’accord : le tournoi s’arrêtera dès la fin des parties en cours."
            : `Vote enregistré (${json.votes}/${json.required}).`
        : json.error ?? "Vote impossible.",
    );
    await load();
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
          {tournament.participants.length}/{tournament.maxPlayers} inscrits. Le tournoi démarre automatiquement quand il est complet.
          {viewer?.isOrganizer && ["SWISS", "ROUND_ROBIN", "LEAGUE", "SURVIVAL_BANK", "ARENA"].includes(tournament.type) && (
            <span className="mt-3 block">
              <button type="button" disabled={busy === "start"} onClick={startNow} className="btn btn-primary">
                <Play className="size-4" /> Démarrer maintenant
              </button>
            </span>
          )}
        </EmptyState>
      )}

      {data.format === "ARENA" && tournament.status !== "OPEN" && data.arena && (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="card overflow-hidden">
            <h2 className="px-5 pt-5 text-base font-semibold">Classement de l’Arena</h2>
            <p className="px-5 text-xs text-ink-muted">Victoire 2 pts, nulle 1 pt. Après deux victoires de suite, les points sont doublés 🔥.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[380px] text-sm">
                <thead className="border-y border-line text-xs text-ink-muted">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">#</th>
                    <th className="px-2 py-2 text-left font-medium">Joueur</th>
                    <th className="px-2 py-2 text-right font-medium">Parties</th>
                    <th className="px-4 py-2 text-right font-medium">Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.arena.map((row) => (
                    <tr key={row.userId} className={row.userId === viewer?.id ? "bg-accent/[0.06]" : ""}>
                      <td className="tabular px-4 py-2 text-ink-muted">{row.rank}</td>
                      <td className="px-2 py-2 font-medium">{row.username} {row.onFire && <span aria-label="En série">🔥</span>}</td>
                      <td className="tabular px-2 py-2 text-right text-ink-muted">{row.games} ({row.wins}/{row.draws}/{row.losses})</td>
                      <td className="tabular px-4 py-2 text-right font-semibold">{row.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-3">
            {tournament.endsAt && (
              <div className="card p-4">
                <p className="eyebrow">Fin de l’Arena</p>
                <p className="mt-1 text-sm font-semibold">{new Date(tournament.endsAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</p>
                <p className="mt-1 text-xs text-ink-muted">Enchaînez un maximum de parties avant la fin. Les parties commencées avant l’heure sont comptées.</p>
              </div>
            )}
            {tournament.status === "IN_PROGRESS" && viewer?.isParticipant && (
              <div className="card p-4">
                {data.arenaWaiting ? (
                  <>
                    <p className="flex items-center gap-2 text-sm"><RefreshCw className="size-4 animate-spin text-accent" /> Recherche d’un adversaire…</p>
                    <button type="button" disabled={busy === "arena"} onClick={() => arenaAction("cancel")} className="btn btn-ghost mt-3 w-full">Annuler</button>
                  </>
                ) : (
                  <button type="button" disabled={busy === "arena"} onClick={() => arenaAction("search")} className="btn btn-primary w-full">
                    <Swords className="size-4" /> Chercher un adversaire
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {data.format === "GROUPS" && data.groups && tournament.status !== "OPEN" && (
        <section className="grid gap-3 md:grid-cols-2">
          {data.groups.map((g) => (
            <div key={g.group} className="card overflow-hidden">
              <h2 className="px-4 pt-4 text-sm font-semibold">Groupe {String.fromCharCode(64 + g.group)}</h2>
              <table className="mt-2 w-full text-sm">
                <tbody className="divide-y divide-line">
                  {g.rows.map((row) => (
                    <tr key={row.userId} className={row.userId === viewer?.id ? "bg-accent/[0.06]" : ""}>
                      <td className="tabular w-8 px-4 py-1.5 text-ink-muted">{row.rank}</td>
                      <td className="px-2 py-1.5 font-medium">{row.username}</td>
                      <td className="tabular px-2 py-1.5 text-right text-ink-muted">{row.wins}/{row.draws}/{row.losses}</td>
                      <td className="tabular px-4 py-1.5 text-right font-semibold">{scoreLabel(row.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

      {data.format === "SURVIVAL" && tournament.status !== "OPEN" && (() => {
        const unit = tournament.isPaid ? "FCFA" : "pts";
        const active = tournament.wallets.filter((w) => w.status === "ACTIVE");
        const myWallet = tournament.wallets.find((w) => w.userId === viewer?.id);
        const iVoted = viewer ? tournament.stopVotes.includes(viewer.id) : false;
        const activeVotes = tournament.stopVotes.filter((id) => active.some((w) => w.userId === id)).length;
        return (
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="card overflow-hidden">
              <h2 className="px-5 pt-5 text-base font-semibold">Capitaux</h2>
              <p className="px-5 text-xs text-ink-muted">
                Chaque joueur ne joue qu’avec sa mise d’inscription. Sous {tournament.minBet ?? 1} {unit}, il est éliminé.
                Mise par partie : {tournament.betMode === "FIXED" ? `${tournament.minBet ?? 1} ${unit}` : `variable, jusqu’à ${tournament.maxBet ?? "—"} ${unit}`}.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead className="border-y border-line text-xs text-ink-muted">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Joueur</th>
                      <th className="px-2 py-2 text-right font-medium">Capital</th>
                      <th className="px-2 py-2 text-right font-medium">Bilan</th>
                      <th className="px-2 py-2 text-right font-medium">V/N/D</th>
                      <th className="px-4 py-2 text-right font-medium">État</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {tournament.wallets.map((w) => {
                      const diff = w.capital - w.initialCapital;
                      return (
                        <tr key={w.userId} className={w.userId === viewer?.id ? "bg-accent/[0.06]" : ""}>
                          <td className="px-4 py-2 font-medium">{w.username}</td>
                          <td className="tabular px-2 py-2 text-right font-semibold">{w.capital} {unit}</td>
                          <td className={`tabular px-2 py-2 text-right ${diff > 0 ? "text-accent" : diff < 0 ? "text-danger" : "text-ink-muted"}`}>
                            {tournament.status === "COMPLETED" ? "—" : `${diff > 0 ? "+" : ""}${diff}`}
                          </td>
                          <td className="tabular px-2 py-2 text-right text-ink-muted">{w.matchesWon}/{w.matchesDrawn}/{w.matchesLost}</td>
                          <td className="px-4 py-2 text-right text-xs">
                            {w.status === "ACTIVE" ? <span className="text-accent">En jeu</span> : w.status === "WON" ? <span className="text-gold">Vainqueur</span> : <span className="text-ink-muted">Éliminé</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3">
              {tournament.endsAt && (
                <div className="card p-4">
                  <p className="eyebrow">Fin programmée</p>
                  <p className="mt-1 text-sm font-semibold">
                    {new Date(tournament.endsAt).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Durée : {tournament.durationDays} jour{(tournament.durationDays ?? 0) > 1 ? "s" : ""}. À cette date, le tournoi s’arrête et chacun récupère son capital.
                  </p>
                </div>
              )}
              {tournament.status === "IN_PROGRESS" && (
                <div className="card p-4">
                  <p className="eyebrow">Arrêt anticipé</p>
                  <p className="mt-1 text-sm">
                    {activeVotes}/{active.length} joueur{active.length > 1 ? "s" : ""} en jeu d’accord pour arrêter.
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">Le tournoi s’arrête seulement si tous les joueurs encore en jeu sont d’accord.</p>
                  {myWallet?.status === "ACTIVE" && (
                    <button
                      type="button"
                      disabled={busy === "vote"}
                      onClick={() => voteStop(!iVoted)}
                      className={`btn mt-3 w-full ${iVoted ? "btn-ghost" : "btn-danger"}`}
                    >
                      {iVoted ? "Retirer mon accord" : "Je veux arrêter le tournoi"}
                    </button>
                  )}
                </div>
              )}
              {tournament.isPaid && (
                <p className="card-muted px-4 py-3 text-xs text-ink-muted">
                  Survival en points argent : une commission s’applique uniquement sur le gain net à la clôture.
                </p>
              )}
            </div>
          </section>
        );
      })()}

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
            {rounds.map(({ label, matches }) => (
              <div key={label} className="card p-4">
                <h3 className="eyebrow">{label}{matches.some((m) => m.stage === "THIRD_PLACE") ? " · finale et 3e place" : ""}</h3>
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
                              <span className="text-ink-muted">{data.format === "SURVIVAL" ? "au repos" : "exempt (1 pt)"}</span>
                            ) : (
                              <span className={m.winnerId && m.winnerId === m.playerBlack?.id ? "font-semibold text-accent" : ""}>
                                {m.playerBlack?.username ?? "—"}
                              </span>
                            )}
                          </p>
                          <span className="text-xs text-ink-muted">
                            {data.format === "SURVIVAL" && m.betAmount ? `Mise ${m.betAmount} · ` : ""}
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
                                {(data.format === "STANDINGS" || data.format === "SURVIVAL" || data.format === "ARENA" || m.stage === "GROUP") && (
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
      <AdSlot placement="tournament" />
    </PageShell>
  );
}
