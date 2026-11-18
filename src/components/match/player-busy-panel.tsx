"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DoorOpen, Hourglass, Play, Send, X } from "lucide-react";
import { api, ApiError, Modal, Notice, Spinner } from "@/components/community/shared";

export interface BusyPlayer {
  id: string;
  username: string;
  self: boolean;
}

/** Extrait les joueurs occupés d'une erreur d'API « PLAYER_BUSY » (sinon null). */
export function busyPlayersFrom(source: unknown): BusyPlayer[] | null {
  const data = source instanceof ApiError ? source.data : source;
  if (!data || typeof data !== "object") return null;
  const { code, busy } = data as { code?: unknown; busy?: unknown };
  if (code !== "PLAYER_BUSY" || !Array.isArray(busy)) return null;
  return busy.filter(
    (p): p is BusyPlayer => !!p && typeof p.id === "string" && typeof p.username === "string" && typeof p.self === "boolean",
  );
}

export interface ActiveGame {
  matchId: string;
  gameType: string;
  mode: string;
  stakeAmount: number | null;
  opponent: string | null;
  context: "tournament" | "interclub" | "game";
  moves: number;
  consequence: "none" | "loss";
}

export function consequenceText(game: ActiveGame): string {
  if (game.consequence === "none") return "Annulée sans aucune conséquence : la partie vient à peine de commencer.";
  const parts = ["Comptée comme un abandon : défaite"];
  if (game.mode === "RATED") parts.push("avec effet sur votre classement ELO");
  if (game.mode === "MONEY" && game.stakeAmount) parts.push(`et perte de votre mise de ${game.stakeAmount} FCFA`);
  if (game.context === "tournament") parts.push("(également dans le tournoi)");
  if (game.context === "interclub") parts.push("(également dans la rencontre interclubs)");
  return `${parts.join(" ")}.`;
}

export function gameLabel(game: ActiveGame): string {
  const kind = game.gameType === "CHESS" ? "Échecs" : "Dames";
  const mode = game.mode === "RATED" ? "classée" : game.mode === "MONEY" ? "points argent" : "amicale";
  return `${kind} · ${mode}${game.opponent ? ` contre ${game.opponent}` : ""}`;
}

/** Confirmation explicite avant d'abandonner toutes ses parties en cours. */
export function QuitMyGamesDialog({
  onClose,
  onDone,
  request,
}: {
  onClose: () => void;
  onDone: (ended: number) => void;
  /** Acceptation d'une demande de sortie reçue (sinon : sortie à mon initiative). */
  request?: { id: string; requester: string };
}) {
  const [games, setGames] = useState<ActiveGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ games: ActiveGame[] }>("/api/match/exit")
      .then((r) => alive && setGames(r.games))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  async function confirm() {
    setWorking(true);
    setError(null);
    try {
      const result = request
        ? await api<{ ended: number }>(`/api/match/exit-requests/${request.id}`, { method: "POST", json: { action: "accept" } })
        : await api<{ ended: number }>("/api/match/exit", { method: "POST", json: { confirm: true } });
      onDone(result.ended);
    } catch (e) {
      setError((e as Error).message);
      setWorking(false);
    }
  }

  return (
    <Modal title={request ? `Accepter la demande de ${request.requester}` : "Quitter ma partie en cours"} onClose={working ? () => undefined : onClose}>
      {!games && !error && <Spinner />}
      {games && games.length === 0 && <Notice tone="success">Vous n’avez plus de partie en cours.</Notice>}
      {games && games.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-soft">
            {games.length > 1 ? "Ces parties seront arrêtées" : "Cette partie sera arrêtée"} et votre adversaire en sera informé :
          </p>
          <ul className="flex flex-col gap-2">
            {games.map((g) => (
              <li key={g.matchId} className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{gameLabel(g)}</span>
                  <Link href={`/match/${g.matchId}`} className="text-xs text-accent hover:underline">
                    Reprendre plutôt
                  </Link>
                </div>
                <p className={`mt-1 text-xs ${g.consequence === "loss" ? "text-danger" : "text-ink-muted"}`}>{consequenceText(g)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={working}>
          Garder ma partie
        </button>
        {(games === null || games.length > 0) && (
          <button type="button" className="btn btn-danger" onClick={() => void confirm()} disabled={working || !games}>
            <DoorOpen className="size-4" /> {working ? "Arrêt en cours…" : "Quitter et abandonner"}
          </button>
        )}
        {games && games.length === 0 && (
          <button type="button" className="btn btn-primary" onClick={() => (request ? void confirm() : onDone(0))} disabled={working}>
            {request ? "Accepter" : "Continuer"}
          </button>
        )}
      </div>
    </Modal>
  );
}

type RequestState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "pending"; id: string; expiresAt: string }
  | { phase: "declined" }
  | { phase: "expired" }
  | { phase: "error"; message: string };

/** Demande à un autre joueur de quitter sa partie, puis suit sa réponse. */
function OpponentRequest({ player, onFree }: { player: BusyPlayer; onFree: () => void }) {
  const [state, setState] = useState<RequestState>({ phase: "idle" });
  const onFreeRef = useRef(onFree);
  useEffect(() => {
    onFreeRef.current = onFree;
  }, [onFree]);

  async function send() {
    setState({ phase: "sending" });
    try {
      const returnPath = `${window.location.pathname}${window.location.search}`;
      const r = await api<{ id: string; expiresAt: string }>("/api/match/exit-requests", {
        method: "POST",
        json: { targetId: player.id, returnPath },
      });
      setState({ phase: "pending", id: r.id, expiresAt: r.expiresAt });
    } catch (e) {
      // L'adversaire a terminé entre-temps : on peut relancer directement.
      if (e instanceof ApiError && e.status === 409 && /n’a plus de partie/.test(e.message)) {
        onFree();
        return;
      }
      setState({ phase: "error", message: (e as Error).message });
    }
  }

  async function cancel(id: string) {
    await api(`/api/match/exit-requests/${id}`, { method: "POST", json: { action: "cancel" } }).catch(() => undefined);
    setState({ phase: "idle" });
  }

  const pendingId = state.phase === "pending" ? state.id : null;
  const poll = useCallback(async () => {
    if (!pendingId || document.hidden) return;
    try {
      const r = await api<{ status: string; targetBusy: boolean | null }>(`/api/match/exit-requests/${pendingId}`);
      if (r.status === "ACCEPTED" || r.targetBusy === false) onFreeRef.current();
      else if (r.status === "DECLINED") setState({ phase: "declined" });
      else if (r.status === "EXPIRED" || r.status === "CANCELLED") setState({ phase: "expired" });
    } catch {
      // nouvel essai au prochain passage
    }
  }, [pendingId]);

  useEffect(() => {
    if (!pendingId) return;
    const timer = window.setInterval(() => void poll(), 4000);
    return () => window.clearInterval(timer);
  }, [pendingId, poll]);

  const name = <strong>{player.username}</strong>;
  switch (state.phase) {
    case "idle":
    case "sending":
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-soft">{name} a déjà une partie en cours. Vous pouvez lui demander de la quitter : rien ne sera arrêté sans son accord.</p>
          <button type="button" className="btn btn-primary w-fit" onClick={() => void send()} disabled={state.phase === "sending"}>
            <Send className="size-4" /> {state.phase === "sending" ? "Envoi…" : `Demander à ${player.username} de quitter sa partie`}
          </button>
        </div>
      );
    case "pending":
      return (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <Hourglass className="size-4 shrink-0 text-accent" /> Demande envoyée à {name}. En attente de sa réponse…
          </p>
          <button type="button" className="btn btn-ghost w-fit min-h-0 px-3 py-1.5 text-xs" onClick={() => void cancel(state.id)}>
            <X className="size-3.5" /> Annuler la demande
          </button>
        </div>
      );
    case "declined":
      return <Notice>{player.username} préfère terminer sa partie en cours. Réessayez un peu plus tard.</Notice>;
    case "expired":
      return (
        <div className="flex flex-col gap-2">
          <Notice>{player.username} n’a pas répondu à temps.</Notice>
          <button type="button" className="btn btn-ghost w-fit" onClick={() => void send()}>
            <Send className="size-4" /> Renvoyer la demande
          </button>
        </div>
      );
    case "error":
      return (
        <div className="flex flex-col gap-2">
          <Notice tone="error">{state.message}</Notice>
          <button type="button" className="btn btn-ghost w-fit" onClick={() => setState({ phase: "idle" })}>
            Réessayer
          </button>
        </div>
      );
  }
}

/**
 * Remplace le simple message « un des deux joueurs a déjà une partie en cours » :
 * - si c'est moi : bouton pour quitter ma partie (avec confirmation et conséquences) ;
 * - si c'est l'adversaire : bouton pour lui demander de quitter la sienne.
 * Une fois tout le monde libre, `onRetry` relance l'action initiale.
 */
export function PlayerBusyPanel({ busy, onRetry, onDismiss }: { busy: BusyPlayer[]; onRetry: () => void; onDismiss?: () => void }) {
  const [selfFree, setSelfFree] = useState(false);
  const [freeOthers, setFreeOthers] = useState<string[]>([]);
  const [dialog, setDialog] = useState(false);

  const selfBusy = busy.some((p) => p.self) && !selfFree;
  const others = busy.filter((p) => !p.self);
  const othersBusy = others.some((p) => !freeOthers.includes(p.id));

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-3" role="status">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">
          {busy.some((p) => p.self) && others.length > 0
            ? "Vous et votre adversaire avez déjà une partie en cours."
            : busy.some((p) => p.self)
              ? "Vous avez déjà une partie en cours."
              : "Votre adversaire a déjà une partie en cours."}
        </p>
        {onDismiss && (
          <button type="button" className="btn btn-ghost min-h-0 p-1" onClick={onDismiss} aria-label="Fermer">
            <X className="size-4" />
          </button>
        )}
      </div>

      {busy.some((p) => p.self) &&
        (selfBusy ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-soft">Pour lancer celle-ci, terminez ou quittez d’abord votre partie en cours.</p>
            <button type="button" className="btn btn-danger w-fit" onClick={() => setDialog(true)}>
              <DoorOpen className="size-4" /> Quitter ma partie en cours
            </button>
          </div>
        ) : (
          <Notice tone="success">Votre partie en cours est terminée.</Notice>
        ))}

      {others.map((p) =>
        freeOthers.includes(p.id) ? (
          <Notice key={p.id} tone="success">{p.username} est maintenant disponible.</Notice>
        ) : (
          <OpponentRequest key={p.id} player={p} onFree={() => setFreeOthers((list) => (list.includes(p.id) ? list : [...list, p.id]))} />
        ),
      )}

      {!selfBusy && !othersBusy && (
        <button type="button" className="btn btn-primary w-fit" onClick={onRetry}>
          <Play className="size-4" /> Lancer la partie
        </button>
      )}

      {dialog && (
        <QuitMyGamesDialog
          onClose={() => setDialog(false)}
          onDone={() => {
            setDialog(false);
            setSelfFree(true);
            // Plus personne d'occupé : on relance directement l'action initiale.
            if (!othersBusy) onRetry();
          }}
        />
      )}
    </div>
  );
}
