"use client";

import { Bell, Check, CheckCheck, Coins, Swords, Trophy, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { busyPlayersFrom, PlayerBusyPanel, type BusyPlayer } from "@/components/match/player-busy-panel";
import { EmptyState } from "@/components/ui/page-header";
import type { PlayerCardData } from "./friends-panel";
import { api, Avatar, Notice, Spinner, timeAgo, useLoadEffect, type AuthorLike } from "./shared";

// ── Défis et invitations ──────────────────────────────────────────────

interface ChallengeData {
  id: string;
  direction: "SENT" | "RECEIVED";
  opponent: PlayerCardData;
  gameType: "CHESS" | "CHECKERS";
  draughtsVariant: "INTERNATIONAL" | "ENGLISH" | null;
  timeControlMinutes: number | null;
  mode: "CASUAL" | "RATED" | "MONEY";
  stakeAmount: number | null;
  color: string;
  message: string | null;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "CANCELLED" | "COMPLETED";
  matchId: string | null;
  matchLive: boolean;
  result: "WIN" | "LOSS" | "DRAW" | "ABORTED" | null;
  expiresAt: string;
  createdAt: string;
}

interface InvitationsData {
  tournaments: {
    id: string;
    tournament: { id: string; name: string; gameType: string; isPaid: boolean; entryPoints: number; entryFee: string; players: number; maxPlayers: number };
    invitedBy: string;
    createdAt: string;
  }[];
  clubs: { id: string; club: { name: string; slug: string; members: number }; invitedBy: string; createdAt: string }[];
}

const STATUS_LABEL: Record<ChallengeData["status"], string> = {
  PENDING: "En attente",
  ACCEPTED: "Accepté",
  DECLINED: "Refusé",
  EXPIRED: "Expiré",
  CANCELLED: "Annulé",
  COMPLETED: "Terminé",
};

function describe(c: ChallengeData) {
  const game = c.gameType === "CHESS" ? "Échecs" : c.draughtsVariant === "ENGLISH" ? "Dames anglaises" : "Dames internationales";
  const cadence = c.timeControlMinutes ? `${c.timeControlMinutes} min` : "sans pendule";
  const mode = c.mode === "MONEY" ? `Argent · ${c.stakeAmount} FCFA` : c.mode === "RATED" ? "Classée" : "Amicale";
  return `${game} · ${cadence} · ${mode}`;
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((new Date(until).getTime() - now) / 1000));
  return <span className="tabular">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

export function ChallengesPanel({ onChanged }: { onChanged?: () => void }) {
  const router = useRouter();
  const [challenges, setChallenges] = useState<ChallengeData[] | null>(null);
  const [invitations, setInvitations] = useState<InvitationsData | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ challenge: ChallengeData; players: BusyPlayer[] } | null>(null);

  const load = useCallback(async () => {
    const [c, i] = await Promise.all([
      api<{ challenges: ChallengeData[] }>("/api/community/challenges").catch(() => ({ challenges: [] })),
      api<InvitationsData>("/api/community/invitations").catch(() => ({ tournaments: [], clubs: [] })),
    ]);
    setChallenges(c.challenges);
    setInvitations(i);
    // Défi envoyé accepté : on rejoint la partie.
    const live = c.challenges.find((x) => x.direction === "SENT" && x.status === "ACCEPTED" && x.matchLive && x.matchId);
    if (live?.matchId) router.push(`/match/${live.matchId}`);
  }, [router]);

  useLoadEffect(load);

  // Rafraîchissement léger tant qu'un défi envoyé attend une réponse.
  const waiting = challenges?.some((c) => c.direction === "SENT" && c.status === "PENDING");
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => !document.hidden && void load(), 4000);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  async function respond(c: ChallengeData, action: "accept" | "decline" | "cancel", moneyConfirmed = false) {
    let acceptMoney = moneyConfirmed;
    if (action === "accept" && c.mode === "MONEY" && !moneyConfirmed) {
      acceptMoney = window.confirm(`Ce défi engage ${c.stakeAmount} FCFA de vos points argent. Confirmer la mise ?`);
      if (!acceptMoney) return;
    }
    setBusy(c.id);
    setNotice(null);
    setBlocked(null);
    try {
      const result = await api<{ status: string; matchId?: string | null }>(`/api/community/challenges/${c.id}`, { method: "POST", json: { action, acceptMoney } });
      if (result.matchId) {
        router.push(`/match/${result.matchId}`);
        return;
      }
      await load();
      onChanged?.();
    } catch (e) {
      const players = busyPlayersFrom(e);
      if (players && action === "accept") setBlocked({ challenge: c, players });
      else setNotice({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function respondInvite(kind: "tournament" | "club", invitationId: string, accept: boolean, href: string) {
    setBusy(invitationId);
    setNotice(null);
    try {
      await api("/api/community/invitations", { method: "POST", json: { action: "respond", kind, invitationId, accept } });
      if (accept) {
        router.push(href);
        return;
      }
      await load();
      onChanged?.();
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!challenges || !invitations) return <Spinner />;
  const received = challenges.filter((c) => c.direction === "RECEIVED" && c.status === "PENDING");
  const sent = challenges.filter((c) => c.direction === "SENT" && c.status === "PENDING");
  const history = challenges.filter((c) => c.status !== "PENDING");

  return (
    <div className="space-y-5">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {blocked && (
        <PlayerBusyPanel
          key={blocked.challenge.id}
          busy={blocked.players}
          onDismiss={() => setBlocked(null)}
          onRetry={() => void respond(blocked.challenge, "accept", blocked.challenge.mode === "MONEY")}
        />
      )}

      <section className="card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Swords className="size-4 text-accent" /> Défis reçus</h2>
        {received.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Aucun défi en attente. Défiez vos amis depuis l’onglet « Amis ».</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {received.map((c) => (
              <li key={c.id} className="card-muted flex flex-wrap items-center gap-3 p-3">
                <Avatar user={c.opponent} size={40} online={c.opponent.online} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm"><strong>{c.opponent.username}</strong> vous défie</p>
                  <p className="text-xs text-ink-muted">{describe(c)}</p>
                  {c.message && <p className="mt-1 text-sm italic text-ink-soft">« {c.message} »</p>}
                  {c.mode === "MONEY" && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-money"><Coins className="size-3.5" /> Partie en points argent : votre mise ne sera bloquée qu’après votre confirmation.</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="mr-1 text-xs text-ink-muted">expire dans <Countdown until={c.expiresAt} /></span>
                  <button type="button" disabled={busy === c.id} onClick={() => respond(c, "accept")} className="btn btn-primary min-h-0 px-3 py-1.5 text-xs"><Check className="size-4" /> Jouer</button>
                  <button type="button" disabled={busy === c.id} onClick={() => respond(c, "decline")} className="btn btn-ghost min-h-0 px-3 py-1.5 text-xs">Refuser</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sent.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Défis envoyés</h2>
          <ul className="mt-2 divide-y divide-line">
            {sent.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <Avatar user={c.opponent} size={32} online={c.opponent.online} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{c.opponent.username}</p>
                  <p className="text-xs text-ink-muted">{describe(c)}</p>
                </div>
                <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <span className="size-2 animate-pulse rounded-full bg-accent" /> En attente · <Countdown until={c.expiresAt} />
                </span>
                <button type="button" disabled={busy === c.id} onClick={() => respond(c, "cancel")} className="btn btn-ghost min-h-0 px-2 py-1 text-xs"><X className="size-3.5" /> Annuler</button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">Vous serez dirigé vers la partie dès que votre ami accepte.</p>
        </section>
      )}

      <section className="card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Trophy className="size-4 text-accent" /> Invitations</h2>
        {invitations.tournaments.length === 0 && invitations.clubs.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Aucune invitation en attente.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {invitations.tournaments.map((i) => (
              <li key={i.id} className="card-muted flex flex-wrap items-center gap-3 p-3">
                <Trophy className="size-5 text-gold" />
                <div className="min-w-0 flex-1">
                  <Link href={`/tournois/${i.tournament.id}`} className="text-sm font-semibold hover:text-accent">{i.tournament.name}</Link>
                  <p className="text-xs text-ink-muted">
                    Invité par {i.invitedBy} · {i.tournament.players}/{i.tournament.maxPlayers} joueurs ·{" "}
                    {i.tournament.isPaid ? `${i.tournament.entryFee} FCFA` : i.tournament.entryPoints > 0 ? `${i.tournament.entryPoints} pts d’entrée` : "gratuit"}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" disabled={busy === i.id} onClick={() => respondInvite("tournament", i.id, true, `/tournois/${i.tournament.id}`)} className="btn btn-primary min-h-0 px-3 py-1.5 text-xs">S’inscrire</button>
                  <button type="button" disabled={busy === i.id} onClick={() => respondInvite("tournament", i.id, false, "")} className="btn btn-ghost min-h-0 px-3 py-1.5 text-xs">Décliner</button>
                </div>
              </li>
            ))}
            {invitations.clubs.map((i) => (
              <li key={i.id} className="card-muted flex flex-wrap items-center gap-3 p-3">
                <Users className="size-5 text-accent" />
                <div className="min-w-0 flex-1">
                  <Link href={`/clubs/${i.club.slug}`} className="text-sm font-semibold hover:text-accent">{i.club.name}</Link>
                  <p className="text-xs text-ink-muted">Invité par {i.invitedBy} · {i.club.members} membres</p>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" disabled={busy === i.id} onClick={() => respondInvite("club", i.id, true, `/clubs/${i.club.slug}`)} className="btn btn-primary min-h-0 px-3 py-1.5 text-xs">Rejoindre</button>
                  <button type="button" disabled={busy === i.id} onClick={() => respondInvite("club", i.id, false, "")} className="btn btn-ghost min-h-0 px-3 py-1.5 text-xs">Décliner</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-muted">S’inscrire applique les règles habituelles du tournoi (places, niveau, droits d’entrée).</p>
      </section>

      {history.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Historique (7 jours)</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {history.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="w-28 truncate font-medium">{c.opponent.username}</span>
                <span className="flex-1 text-xs text-ink-muted">{c.direction === "SENT" ? "Envoyé" : "Reçu"} · {describe(c)}</span>
                <span className="chip">
                  {c.result === "WIN" ? "Victoire" : c.result === "LOSS" ? "Défaite" : c.result === "DRAW" ? "Nulle" : c.result === "ABORTED" ? "Annulée" : STATUS_LABEL[c.status]}
                </span>
                {c.matchLive && c.matchId && <Link href={`/match/${c.matchId}`} className="btn btn-primary min-h-0 px-2.5 py-1 text-xs">Reprendre</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ── Notifications ─────────────────────────────────────────────────────

export interface NotificationData {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
  actor: AuthorLike | null;
}

export function NotificationsPanel({ onUnreadChange }: { onUnreadChange?: (n: number) => void }) {
  const [items, setItems] = useState<NotificationData[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  const load = useCallback(
    async (next: string | null) => {
      const data = await api<{ items: NotificationData[]; nextCursor: string | null; unread: number }>(
        `/api/community/notifications${next ? `?cursor=${encodeURIComponent(next)}` : ""}`,
      );
      setItems((list) => (next && list ? [...list, ...data.items] : data.items));
      setCursor(data.nextCursor);
      onUnreadChange?.(data.unread);
    },
    [onUnreadChange],
  );
  const initialLoad = useCallback(() => load(null).catch(() => setItems([])), [load]);
  useLoadEffect(initialLoad);

  async function markAll() {
    const result = await api<{ unread: number }>("/api/community/notifications", { method: "POST", json: { read: "all" } });
    setItems((list) => list?.map((n) => ({ ...n, read: true })) ?? null);
    onUnreadChange?.(result.unread);
    window.dispatchEvent(new Event("thot:notifications"));
  }
  async function open(n: NotificationData) {
    if (!n.read) {
      await api("/api/community/notifications", { method: "POST", json: { read: [n.id] } }).catch(() => undefined);
      window.dispatchEvent(new Event("thot:notifications"));
    }
  }

  if (!items) return <Spinner />;
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Bell className="size-4 text-accent" /> Notifications</h2>
        <button type="button" onClick={markAll} className="btn btn-ghost min-h-0 px-2.5 py-1.5 text-xs"><CheckCheck className="size-4" /> Tout marquer comme lu</button>
      </div>
      {items.length === 0 ? (
        <div className="mt-3"><EmptyState title="Rien de nouveau">Les demandes d’amitié, défis, commentaires et invitations apparaîtront ici.</EmptyState></div>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {items.map((n) => (
            <li key={n.id}>
              <Link href={n.link ?? "/communaute"} onClick={() => open(n)} className={`flex gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface-2 ${n.read ? "" : "bg-accent/[0.05]"}`}>
                {n.actor ? <Avatar user={n.actor} size={34} /> : <span className="flex size-[34px] items-center justify-center rounded-full bg-surface-3"><Bell className="size-4" /></span>}
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.read ? "text-ink-soft" : "font-semibold"}`}>{n.title}</span>
                  {n.body && <span className="block truncate text-xs text-ink-muted">{n.body}</span>}
                  <span className="text-xs text-ink-muted">{timeAgo(n.createdAt)}</span>
                </span>
                {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Non lue" />}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <div className="mt-3 text-center">
          <button type="button" onClick={() => load(cursor)} className="btn btn-ghost">Voir plus</button>
        </div>
      )}
    </section>
  );
}
