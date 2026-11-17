"use client";

import { Ban, Check, Search, Star, Trophy, UserMinus, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/page-header";
import { ChallengeDialog } from "./dialogs";
import { api, Avatar, Notice, PlayerName, Spinner, timeAgo, useLoadEffect } from "./shared";

export interface PlayerCardData {
  id: string;
  username: string;
  avatar: string | null;
  elo: number;
  chessElo: number | null;
  draughtsElo: number | null;
  premiumLevel: number;
  isAdmin: boolean;
  online: boolean;
  club: { slug: string; name: string } | null;
}

interface FriendData extends PlayerCardData {
  friendshipId: string;
  favorite: boolean;
  since: string;
}

interface RequestData {
  friendshipId: string;
  createdAt: string;
  player: PlayerCardData;
}

interface FriendsResponse {
  friends: FriendData[];
  requests: { received: RequestData[]; sent: RequestData[] };
  blocked: { id: string; username: string; avatar: string | null }[];
}

function Ratings({ p }: { p: PlayerCardData }) {
  return (
    <span className="tabular flex flex-wrap gap-x-3 text-xs text-ink-muted">
      <span title="Classement échecs">♞ {p.chessElo ?? "—"}</span>
      <span title="Classement dames">⛀ {p.draughtsElo ?? "—"}</span>
      {p.club && <Link href={`/clubs/${p.club.slug}`} className="truncate hover:text-ink">{p.club.name}</Link>}
    </span>
  );
}

export function FriendsPanel({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<FriendsResponse | null>(null);
  const [filter, setFilter] = useState<"ALL" | "ONLINE" | "OFFLINE" | "FAVORITES">("ALL");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerCardData[] | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [challenge, setChallenge] = useState<{ id: string; username: string; game?: "CHESS" | "CHECKERS" } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<FriendsResponse>("/api/community/friends"));
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    }
  }, []);
  useLoadEffect(load);

  // Recherche différée (évite une requête par frappe).
  useEffect(() => {
    const short = query.trim().length < 2;
    const timer = window.setTimeout(() => {
      if (short) {
        setResults(null);
        return;
      }
      api<{ players: PlayerCardData[] }>(`/api/community/players/search?q=${encodeURIComponent(query.trim())}`)
        .then((d) => setResults(d.players))
        .catch(() => setResults([]));
    }, short ? 0 : 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function act(body: Record<string, unknown>, success?: string) {
    setNotice(null);
    try {
      const result = await api<{ status?: string }>("/api/community/friends", { method: "POST", json: body });
      if (success) setNotice({ tone: "success", text: result.status === "ACCEPTED" ? "Vous êtes maintenant amis." : success });
      await load();
      onChanged?.();
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    }
  }

  if (!data) return <Spinner />;
  const friendIds = new Set(data.friends.map((f) => f.id));
  const sentIds = new Set(data.requests.sent.map((r) => r.player.id));
  const friends = data.friends.filter((f) =>
    filter === "ONLINE" ? f.online : filter === "OFFLINE" ? !f.online : filter === "FAVORITES" ? f.favorite : true,
  );

  return (
    <div className="space-y-5">
      <section className="card p-4">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="field pl-9" placeholder="Rechercher un joueur par pseudo" aria-label="Rechercher un joueur" />
        </label>
        {results && (
          <ul className="mt-3 divide-y divide-line">
            {results.length === 0 && <li className="py-3 text-sm text-ink-muted">Aucun joueur trouvé.</li>}
            {results.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <Avatar user={p} size={36} online={p.online} />
                <div className="min-w-0 flex-1">
                  <PlayerName user={p} showElo={false} />
                  <Ratings p={p} />
                </div>
                {friendIds.has(p.id) ? (
                  <span className="chip">Ami</span>
                ) : sentIds.has(p.id) ? (
                  <span className="chip">Demande envoyée</span>
                ) : (
                  <button type="button" onClick={() => act({ action: "request", target: p.id }, "Demande d’amitié envoyée.")} className="btn btn-primary min-h-0 px-3 py-1.5 text-xs">
                    <UserPlus className="size-4" /> Ajouter
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {data.requests.received.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Demandes reçues ({data.requests.received.length})</h2>
          <ul className="mt-2 divide-y divide-line">
            {data.requests.received.map((r) => (
              <li key={r.friendshipId} className="flex flex-wrap items-center gap-3 py-2.5">
                <Avatar user={r.player} size={36} online={r.player.online} />
                <div className="min-w-0 flex-1">
                  <PlayerName user={r.player} showElo={false} />
                  <p className="text-xs text-ink-muted">{timeAgo(r.createdAt)}</p>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => act({ action: "accept", friendshipId: r.friendshipId }, "Demande acceptée.")} className="btn btn-primary min-h-0 px-3 py-1.5 text-xs">
                    <Check className="size-4" /> Accepter
                  </button>
                  <button type="button" onClick={() => act({ action: "decline", friendshipId: r.friendshipId })} className="btn btn-ghost min-h-0 px-3 py-1.5 text-xs">Refuser</button>
                  <button
                    type="button"
                    onClick={() => window.confirm(`Refuser et bloquer ${r.player.username} ?`) && act({ action: "block-request", friendshipId: r.friendshipId })}
                    className="btn btn-danger min-h-0 px-2 py-1.5 text-xs"
                    aria-label={`Bloquer ${r.player.username}`}
                    title="Refuser et bloquer"
                  >
                    <Ban className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">Ignorer : laissez simplement la demande en attente.</p>
        </section>
      )}

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Mes amis ({data.friends.length})</h2>
          <div role="tablist" aria-label="Filtrer les amis" className="flex gap-1 rounded-xl border border-line p-1 text-xs">
            {([
              ["ALL", "Tous"],
              ["ONLINE", `En ligne (${data.friends.filter((f) => f.online).length})`],
              ["OFFLINE", "Hors ligne"],
              ["FAVORITES", "Favoris"],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)} className={`rounded-lg px-2.5 py-1 ${filter === key ? "bg-surface-3 text-ink" : "text-ink-muted hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {friends.length === 0 ? (
          <div className="mt-3">
            <EmptyState title={data.friends.length === 0 ? "Pas encore d’amis" : "Personne dans ce filtre"}>
              {data.friends.length === 0 ? "Recherchez des joueurs ci-dessus ou ajoutez les auteurs des publications qui vous plaisent." : null}
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {friends.map((f) => (
              <li key={f.id} className="card-muted flex flex-col gap-3 p-3">
                <div className="flex items-center gap-3">
                  <Avatar user={f} size={42} online={f.online} />
                  <div className="min-w-0 flex-1">
                    <PlayerName user={f} showElo={false} />
                    <Ratings p={f} />
                  </div>
                  <button
                    type="button"
                    onClick={() => act({ action: "favorite", target: f.id, favorite: !f.favorite })}
                    aria-pressed={f.favorite}
                    aria-label={f.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                    className={`rounded-lg p-1.5 ${f.favorite ? "text-gold" : "text-ink-muted hover:text-ink"}`}
                  >
                    <Star className={`size-4 ${f.favorite ? "fill-current" : ""}`} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setChallenge({ id: f.id, username: f.username, game: "CHECKERS" })} className="btn btn-primary min-h-0 px-2.5 py-1.5 text-xs">⛀ Dames</button>
                  <button type="button" onClick={() => setChallenge({ id: f.id, username: f.username, game: "CHESS" })} className="btn btn-primary min-h-0 px-2.5 py-1.5 text-xs">♞ Échecs</button>
                  <Link href={`/joueurs/${encodeURIComponent(f.username)}`} className="btn btn-ghost min-h-0 px-2.5 py-1.5 text-xs">Profil & stats</Link>
                  <Link href="/tournois" className="btn btn-ghost min-h-0 px-2.5 py-1.5 text-xs" title="Inviter depuis la page d’un tournoi">
                    <Trophy className="size-3.5" /> Tournoi
                  </Link>
                  <button
                    type="button"
                    onClick={() => window.confirm(`Retirer ${f.username} de vos amis ?`) && act({ action: "remove", target: f.id })}
                    className="btn btn-ghost ml-auto min-h-0 px-2 py-1.5 text-xs"
                    aria-label={`Retirer ${f.username}`}
                    title="Retirer des amis"
                  >
                    <UserMinus className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.requests.sent.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Demandes envoyées</h2>
          <ul className="mt-2 divide-y divide-line">
            {data.requests.sent.map((r) => (
              <li key={r.friendshipId} className="flex items-center gap-3 py-2">
                <Avatar user={r.player} size={30} />
                <span className="flex-1 truncate text-sm">{r.player.username}</span>
                <span className="text-xs text-ink-muted">{timeAgo(r.createdAt)}</span>
                <button type="button" onClick={() => act({ action: "cancel", friendshipId: r.friendshipId })} className="btn btn-ghost min-h-0 px-2 py-1 text-xs">
                  <X className="size-3.5" /> Annuler
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {challenge && <ChallengeDialog opponent={challenge} defaultGame={challenge.game} onClose={() => setChallenge(null)} />}
    </div>
  );
}
