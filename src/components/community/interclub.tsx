"use client";

import { ArrowLeft, Check, Play, Search, Shield, Swords, Trophy, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { busyPlayersFrom, PlayerBusyPanel, type BusyPlayer } from "@/components/match/player-busy-panel";
import { EmptyState } from "@/components/ui/page-header";
import type { PlayerCardData } from "./friends-panel";
import { api, Avatar, Modal, Notice, Spinner, timeAgo, useLoadEffect } from "./shared";

const STATUS: Record<string, string> = {
  PROPOSED: "Proposée",
  LINEUP: "Composition des équipes",
  IN_PROGRESS: "En cours",
  COMPLETED: "Terminée",
  DECLINED: "Refusée",
  CANCELLED: "Annulée",
  EXPIRED: "Expirée",
};

function describeGame(m: { gameType: string; draughtsVariant?: string | null; timeControlMinutes?: number | null; mode: string }) {
  const game = m.gameType === "CHESS" ? "Échecs" : m.draughtsVariant === "ENGLISH" ? "Dames anglaises" : "Dames internationales";
  return `${game} · ${m.timeControlMinutes ? `${m.timeControlMinutes} min` : "sans pendule"} · ${m.mode === "RATED" ? "classée" : "amicale"}`;
}

interface ClubMatchData {
  id: string;
  status: string;
  home: { id: string; name: string; slug: string; logo: string | null; score: number };
  away: { id: string; name: string; slug: string; logo: string | null; score: number };
  winnerClubId: string | null;
  boards: number;
  gameType: string;
  draughtsVariant: string | null;
  timeControlMinutes: number | null;
  mode: string;
  message: string | null;
  proposedBy: string;
  expiresAt: string;
  boardList: { id: string; board: number; homeIsWhite: boolean; home: PlayerCardData | null; away: PlayerCardData | null; result: string | null; matchId: string | null; live: boolean; mine: boolean }[];
  viewer: { canManageHome: boolean; canManageAway: boolean; canRespond: boolean; canCancel: boolean };
  rosters: { home: PlayerCardData[] | null; away: PlayerCardData[] | null } | null;
}

function ClubBadge({ club, align = "left" }: { club: { name: string; slug: string; logo: string | null }; align?: "left" | "right" }) {
  return (
    <Link href={`/clubs/${club.slug}`} className={`flex min-w-0 items-center gap-3 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      {club.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={club.logo} alt="" className="size-12 shrink-0 rounded-xl border border-line object-cover" />
      ) : (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Shield className="size-6" /></span>
      )}
      <span className="truncate text-base font-semibold hover:text-accent sm:text-lg">{club.name}</span>
    </Link>
  );
}

function LineupEditor({ side, roster, boards, current, matchId, onSaved }: { side: "HOME" | "AWAY"; roster: PlayerCardData[]; boards: number; current: (string | null)[]; matchId: string; onSaved: () => void }) {
  const [picks, setPicks] = useState<string[]>(() => Array.from({ length: boards }, (_, i) => current[i] ?? ""));
  const [error, setError] = useState("");
  async function save() {
    setError("");
    try {
      await api(`/api/interclub/${matchId}`, { method: "POST", json: { action: "lineup", side, playerIds: picks } });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="card-muted space-y-2 p-3">
      <p className="text-sm font-semibold">Composer l’équipe {side === "HOME" ? "à domicile" : "visiteuse"}</p>
      <p className="text-xs text-ink-muted">Échiquier 1 = joueur le plus fort, en général. Les blancs alternent d’un échiquier à l’autre.</p>
      {picks.map((value, i) => (
        <label key={i} className="flex items-center gap-2 text-sm">
          <span className="tabular w-20 shrink-0 text-ink-muted">Échiquier {i + 1}</span>
          <select value={value} onChange={(e) => setPicks(picks.map((p, j) => (j === i ? e.target.value : p)))} className="field py-1.5">
            <option value="">— Choisir —</option>
            {roster.map((p) => (
              <option key={p.id} value={p.id} disabled={picks.includes(p.id) && value !== p.id}>
                {p.username} ({p.elo})
              </option>
            ))}
          </select>
        </label>
      ))}
      {error && <Notice tone="error">{error}</Notice>}
      <button type="button" onClick={save} disabled={picks.some((p) => !p)} className="btn btn-primary w-full">Valider la composition</button>
    </div>
  );
}

export function ClubMatchPage({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ClubMatchData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [blocked, setBlocked] = useState<{ body: Record<string, unknown>; players: BusyPlayer[] } | null>(null);

  const load = useCallback(async () => {
    try {
      setData((await api<{ match: ClubMatchData }>(`/api/interclub/${matchId}`)).match);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [matchId]);
  useLoadEffect(load);
  // Rafraîchissement léger pendant la rencontre (résultats des échiquiers).
  useEffect(() => {
    if (data?.status !== "IN_PROGRESS") return;
    const t = window.setInterval(() => !document.hidden && void load(), 15_000);
    return () => window.clearInterval(t);
  }, [data?.status, load]);

  async function act(body: Record<string, unknown>, success?: string) {
    setNotice(null);
    setBlocked(null);
    try {
      const result = await api<{ matchId?: string }>(`/api/interclub/${matchId}`, { method: "POST", json: body });
      if (result.matchId) {
        router.push(`/match/${result.matchId}`);
        return;
      }
      if (success) setNotice({ tone: "success", text: success });
      await load();
    } catch (e) {
      const players = busyPlayersFrom(e);
      if (players && body.action === "play") setBlocked({ body, players });
      else setNotice({ tone: "error", text: (e as Error).message });
    }
  }

  if (error) return <EmptyState title="Rencontre indisponible">{error}</EmptyState>;
  if (!data) return <Spinner />;
  const winner = data.winnerClubId === data.home.id ? data.home.name : data.winnerClubId === data.away.id ? data.away.name : null;

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/clubs/${data.home.slug}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="size-4" /> {data.home.name}</Link>
      <header className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="chip">{STATUS[data.status] ?? data.status}</span>
          <span className="text-xs text-ink-muted">{data.boards} échiquier(s) · {describeGame(data)} · proposée par {data.proposedBy}</span>
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <ClubBadge club={data.home} />
          <p className="tabular text-center text-3xl font-bold">
            {data.home.score} <span className="text-ink-muted">–</span> {data.away.score}
          </p>
          <ClubBadge club={data.away} align="right" />
        </div>
        {winner && <p className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2 text-sm text-gold"><Trophy className="size-4" /> Victoire de {winner}</p>}
        {data.status === "COMPLETED" && !winner && <p className="mt-4 text-center text-sm text-ink-muted">Match nul.</p>}
        {data.message && <p className="mt-4 text-sm italic text-ink-soft">« {data.message} »</p>}
        {(data.viewer.canRespond || data.viewer.canCancel) && (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {data.viewer.canRespond && (
              <>
                <span className="mr-auto self-center text-xs text-ink-muted">Réponse attendue avant {new Date(data.expiresAt).toLocaleString("fr-FR")}</span>
                <button type="button" onClick={() => act({ action: "accept" }, "Rencontre acceptée : composez votre équipe.")} className="btn btn-primary"><Check className="size-4" /> Accepter</button>
                <button type="button" onClick={() => act({ action: "decline" })} className="btn btn-ghost">Refuser</button>
              </>
            )}
            {data.viewer.canCancel && !data.viewer.canRespond && (
              <button type="button" onClick={() => window.confirm("Annuler la rencontre ?") && act({ action: "cancel" })} className="btn btn-ghost"><X className="size-4" /> Annuler</button>
            )}
          </div>
        )}
      </header>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {blocked && (
        <PlayerBusyPanel key={String(blocked.body.boardId)} busy={blocked.players} onDismiss={() => setBlocked(null)} onRetry={() => void act(blocked.body)} />
      )}

      {data.status === "LINEUP" && data.rosters && (data.rosters.home || data.rosters.away) && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.rosters.home && (
            <LineupEditor key={`h-${data.boardList.map((b) => b.home?.id).join()}`} side="HOME" roster={data.rosters.home} boards={data.boards} current={data.boardList.map((b) => b.home?.id ?? null)} matchId={data.id} onSaved={() => { setNotice({ tone: "success", text: "Composition enregistrée." }); void load(); }} />
          )}
          {data.rosters.away && (
            <LineupEditor key={`a-${data.boardList.map((b) => b.away?.id).join()}`} side="AWAY" roster={data.rosters.away} boards={data.boards} current={data.boardList.map((b) => b.away?.id ?? null)} matchId={data.id} onSaved={() => { setNotice({ tone: "success", text: "Composition enregistrée." }); void load(); }} />
          )}
        </div>
      )}

      {data.boardList.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="px-5 pt-5 text-base font-semibold">Échiquiers</h2>
          <ul className="mt-3 divide-y divide-line">
            {data.boardList.map((b) => {
              const homeColor = b.homeIsWhite ? "Blancs" : "Noirs";
              return (
                <li key={b.id} className={`grid grid-cols-[2.5rem_1fr_auto_1fr] items-center gap-2 px-4 py-3 sm:px-5 ${b.mine ? "bg-accent/[0.05]" : ""}`}>
                  <span className="tabular text-sm text-ink-muted">#{b.board}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    {b.home ? <><Avatar user={b.home} size={28} online={b.home.online} /><span className="truncate text-sm font-medium">{b.home.username}</span></> : <span className="text-sm text-ink-muted">à désigner</span>}
                    <span className="hidden text-[11px] text-ink-muted sm:inline">{homeColor}</span>
                  </span>
                  <span className="text-center">
                    {b.result ? (
                      <span className="tabular text-sm font-semibold">{b.result === "HOME" ? "1 – 0" : b.result === "AWAY" ? "0 – 1" : "½ – ½"}</span>
                    ) : b.mine && data.status === "IN_PROGRESS" ? (
                      <button type="button" onClick={() => act({ action: "play", boardId: b.id })} className="btn btn-primary min-h-0 px-3 py-1.5 text-xs">
                        <Play className="size-3.5" /> {b.live ? "Reprendre" : "Jouer"}
                      </button>
                    ) : b.live ? (
                      <span className="flex items-center gap-1 text-xs text-accent"><span className="size-2 animate-pulse rounded-full bg-accent" /> en cours</span>
                    ) : (
                      <span className="text-xs text-ink-muted">—</span>
                    )}
                  </span>
                  <span className="flex min-w-0 items-center justify-end gap-2 text-right">
                    <span className="hidden text-[11px] text-ink-muted sm:inline">{b.homeIsWhite ? "Noirs" : "Blancs"}</span>
                    {b.away ? <><span className="truncate text-sm font-medium">{b.away.username}</span><Avatar user={b.away} size={28} online={b.away.online} /></> : <span className="text-sm text-ink-muted">à désigner</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="px-5 pb-4 pt-2 text-xs text-ink-muted">1 point par victoire, ½ par nulle. Chaque partie se joue dans la salle de jeu habituelle ; une partie annulée avant le 2ᵉ coup peut être relancée.</p>
        </section>
      )}
    </div>
  );
}

// ── Section « Rencontres interclubs » d'une page de club ──────────────

interface ClubMatchRow {
  id: string;
  status: string;
  home: { name: string; slug: string; score: number };
  away: { name: string; slug: string; score: number };
  boards: number;
  gameType: string;
  mode: string;
  isHome: boolean;
  createdAt: string;
}

export function ClubMatchesSection({ slug, canPropose }: { slug: string; canPropose: boolean }) {
  const [rows, setRows] = useState<ClubMatchRow[] | null>(null);
  const [proposing, setProposing] = useState(false);
  const load = useCallback(async () => {
    setRows((await api<{ matches: ClubMatchRow[] }>(`/api/interclub?club=${encodeURIComponent(slug)}`).catch(() => ({ matches: [] }))).matches);
  }, [slug]);
  useLoadEffect(load);

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Swords className="size-4 text-accent" /> Rencontres interclubs</h2>
        <div className="flex gap-2">
          <Link href="/clubs#interclubs" className="btn btn-ghost min-h-0 px-3 py-1.5 text-xs">Classement</Link>
          {canPropose && <button type="button" onClick={() => setProposing(true)} className="btn btn-primary min-h-0 px-3 py-1.5 text-xs">Défier un club</button>}
        </div>
      </div>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">Aucune rencontre pour l’instant.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((m) => (
            <li key={m.id}>
              <Link href={`/interclubs/${m.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm hover:text-accent">
                <span className="min-w-0 flex-1 truncate font-medium">{m.home.name} – {m.away.name}</span>
                {(m.status === "IN_PROGRESS" || m.status === "COMPLETED") && <span className="tabular font-semibold">{m.home.score} – {m.away.score}</span>}
                <span className="chip">{STATUS[m.status] ?? m.status}</span>
                <span className="text-xs text-ink-muted">{m.boards} éch. · {m.gameType === "CHESS" ? "♞" : "⛀"} · {timeAgo(m.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {proposing && <ProposeClubMatchDialog homeSlug={slug} onClose={() => { setProposing(false); void load(); }} />}
    </section>
  );
}

function ProposeClubMatchDialog({ homeSlug, onClose }: { homeSlug: string; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [clubs, setClubs] = useState<{ id: string; name: string; slug: string; city: string | null }[]>([]);
  const [away, setAway] = useState<{ slug: string; name: string } | null>(null);
  const [form, setForm] = useState({ boards: "4", gameType: "CHECKERS", draughtsVariant: "INTERNATIONAL", timeControlMinutes: "10", mode: "CASUAL", message: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => {
      api<{ clubs: { id: string; name: string; slug: string; city: string | null }[] }>(`/api/clubs?q=${encodeURIComponent(query.trim())}`)
        .then((d) => setClubs(d.clubs.filter((c) => c.slug !== homeSlug).slice(0, 8)))
        .catch(() => setClubs([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [query, homeSlug]);

  async function submit() {
    setError("");
    try {
      const { id } = await api<{ id: string }>("/api/interclub", {
        method: "POST",
        json: { homeClub: homeSlug, awayClub: away?.slug, ...form, timeControlMinutes: form.timeControlMinutes === "none" ? null : Number(form.timeControlMinutes), boards: Number(form.boards) },
      });
      router.push(`/interclubs/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title="Défier un autre club" onClose={onClose}>
      <div className="space-y-3">
        {away ? (
          <p className="flex items-center justify-between rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
            Adversaire : <strong>{away.name}</strong>
            <button type="button" onClick={() => setAway(null)} className="text-xs text-accent hover:underline">changer</button>
          </p>
        ) : (
          <>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} className="field pl-9" placeholder="Nom ou ville du club adverse" />
            </label>
            <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-xl border border-line">
              {clubs.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setAway({ slug: c.slug, name: c.name })} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-surface-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-ink-muted">{c.city}</span>
                  </button>
                </li>
              ))}
              {clubs.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">Aucun club trouvé.</li>}
            </ul>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm"><span className="eyebrow">Échiquiers</span>
            <select value={form.boards} onChange={(e) => setForm({ ...form, boards: e.target.value })} className="field mt-1.5">
              {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="eyebrow">Jeu</span>
            <select value={form.gameType} onChange={(e) => setForm({ ...form, gameType: e.target.value })} className="field mt-1.5">
              <option value="CHECKERS">Dames</option>
              <option value="CHESS">Échecs</option>
            </select>
          </label>
          {form.gameType === "CHECKERS" && (
            <label className="text-sm"><span className="eyebrow">Variante</span>
              <select value={form.draughtsVariant} onChange={(e) => setForm({ ...form, draughtsVariant: e.target.value })} className="field mt-1.5">
                <option value="INTERNATIONAL">Internationales</option>
                <option value="ENGLISH">Anglaises</option>
              </select>
            </label>
          )}
          <label className="text-sm"><span className="eyebrow">Cadence</span>
            <select value={form.timeControlMinutes} onChange={(e) => setForm({ ...form, timeControlMinutes: e.target.value })} className="field mt-1.5">
              {[3, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
              <option value="none">Sans pendule</option>
            </select>
          </label>
          <label className="text-sm"><span className="eyebrow">Type</span>
            <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className="field mt-1.5">
              <option value="CASUAL">Amicale</option>
              <option value="RATED">Classée (ELO)</option>
            </select>
          </label>
        </div>
        <input value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} maxLength={300} className="field" placeholder="Message aux responsables adverses (facultatif)" />
        <p className="text-xs text-ink-muted">Aucun point argent en interclubs. Le club adverse a 72 h (par défaut) pour répondre.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">Annuler</button>
          <button type="button" onClick={submit} disabled={!away} className="btn btn-primary">Envoyer le défi</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Classement interclubs (page Clubs) ────────────────────────────────

interface StandingRow {
  rank: number;
  clubId: string;
  name: string;
  slug: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  boardsFor: number;
  boardsAgainst: number;
}

export function InterclubStandings() {
  const [rows, setRows] = useState<StandingRow[] | null>(null);
  const load = useCallback(async () => {
    setRows((await api<{ standings: StandingRow[] }>("/api/interclub").catch(() => ({ standings: [] }))).standings);
  }, []);
  useLoadEffect(load);
  return (
    <section id="interclubs" className="card overflow-hidden">
      <div className="px-5 pt-5">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Trophy className="size-4 text-gold" /> Classement interclubs</h2>
        <p className="mt-1 text-xs text-ink-muted">Victoire 2 pts, nul 1 pt ; départage à la différence d’échiquiers. Les responsables lancent les rencontres depuis la page de leur club.</p>
      </div>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="px-5 pb-5 pt-3 text-sm text-ink-muted">Aucune rencontre terminée pour l’instant.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-y border-line text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">#</th>
                <th className="px-2 py-2 text-left font-medium">Club</th>
                <th className="px-2 py-2 text-right font-medium">J</th>
                <th className="px-2 py-2 text-right font-medium">V/N/D</th>
                <th className="px-2 py-2 text-right font-medium">Échiquiers</th>
                <th className="px-4 py-2 text-right font-medium">Pts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.clubId}>
                  <td className="tabular px-4 py-2 text-ink-muted">{r.rank}</td>
                  <td className="px-2 py-2"><Link href={`/clubs/${r.slug}`} className="font-medium hover:text-accent">{r.name}</Link></td>
                  <td className="tabular px-2 py-2 text-right">{r.played}</td>
                  <td className="tabular px-2 py-2 text-right text-ink-muted">{r.wins}/{r.draws}/{r.losses}</td>
                  <td className="tabular px-2 py-2 text-right text-ink-muted">{r.boardsFor}–{r.boardsAgainst}</td>
                  <td className="tabular px-4 py-2 text-right font-semibold">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
