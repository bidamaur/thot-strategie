"use client";

import { Swords } from "lucide-react";
import { useEffect, useState } from "react";

interface Session {
  played: number;
  gameNumber: number;
  draws: number;
  players: { id: string; username: string; wins: number }[];
}

/**
 * Score de la session d'un affront (revanches successives) : « Vous 2 – 1 Kamdem ».
 * Rechargé à chaque fin de partie et à chaque revanche.
 */
export function SessionScore({ matchId, status, selfId }: { matchId: string; status: string; selfId: string }) {
  const [session, setSession] = useState<{ matchId: string; data: Session } | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/match/${encodeURIComponent(matchId)}/session`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { session?: Session } | null) => {
        if (active && d?.session) setSession({ matchId, data: d.session });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [matchId, status]);

  if (!session || session.matchId !== matchId) return null;
  const me = session.data.players.find((p) => p.id === selfId);
  const other = session.data.players.find((p) => p.id !== selfId);
  if (!me || !other) return null;
  const draws = session.data.draws;
  const label = `Score de l’affront : vous ${me.wins}, ${other.username} ${other.wins}${draws ? `, ${draws} nulle${draws > 1 ? "s" : ""}` : ""}`;

  return (
    <div className="board-fit flex items-center justify-center" role="status" aria-label={label}>
      <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface-2/80 px-3 py-1 text-xs text-ink-muted">
        <Swords className="size-3.5 shrink-0 text-gold" aria-hidden />
        <span className="shrink-0">Partie {session.data.gameNumber}</span>
        <span aria-hidden className="text-line-strong">·</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-ink-soft">Vous</span>
          <strong className="tabular text-sm text-ink">{me.wins} – {other.wins}</strong>
          <span className="truncate text-ink-soft">{other.username}</span>
        </span>
        {draws > 0 && (
          <>
            <span aria-hidden className="text-line-strong">·</span>
            <span className="shrink-0">{draws} nulle{draws > 1 ? "s" : ""}</span>
          </>
        )}
      </span>
    </div>
  );
}
