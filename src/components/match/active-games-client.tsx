"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Check, DoorOpen, Play, X } from "lucide-react";
import { api, ApiError, Notice, Spinner, timeAgo, useLoadEffect } from "@/components/community/shared";
import { EmptyState } from "@/components/ui/page-header";
import { consequenceText, gameLabel, QuitMyGamesDialog, type ActiveGame } from "./player-busy-panel";

interface ReceivedRequest {
  id: string;
  requester: string;
  createdAt: string;
  expiresAt: string;
}

/** Mes parties en cours + demandes de sortie reçues (accepter / refuser). */
export function ActiveGamesClient() {
  const [data, setData] = useState<{ games: ActiveGame[]; requests: ReceivedRequest[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [dialog, setDialog] = useState<null | { request?: { id: string; requester: string } }>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api("/api/match/exit"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "Connectez-vous pour voir vos parties en cours." : (e as Error).message);
    }
  }, []);
  useLoadEffect(load);

  async function decline(request: ReceivedRequest) {
    setBusy(request.id);
    setNotice(null);
    try {
      await api(`/api/match/exit-requests/${request.id}`, { method: "POST", json: { action: "decline" } });
      setNotice({ tone: "info", text: `Demande de ${request.requester} refusée : votre partie continue.` });
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
      await load();
    }
  }

  if (error) return <EmptyState title="Partie en cours">{error}</EmptyState>;
  if (!data) return <Spinner />;

  const highlighted = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("demande");

  return (
    <div className="flex flex-col gap-5">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {data.requests.length > 0 && (
        <section className="card flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold">Joueurs qui attendent que vous soyez disponible</h2>
          <ul className="flex flex-col gap-2">
            {data.requests.map((r) => (
              <li
                key={r.id}
                className={`flex flex-col gap-2 rounded-xl border p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${r.id === highlighted ? "border-accent/40 bg-accent/5" : "border-line bg-surface-2"}`}
              >
                <span>
                  <strong>{r.requester}</strong> vous demande de quitter votre partie en cours pour pouvoir jouer avec vous.
                  <span className="block text-xs text-ink-muted">{timeAgo(r.createdAt)}</span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button type="button" className="btn btn-ghost min-h-0 px-3 py-1.5 text-xs" disabled={busy === r.id} onClick={() => void decline(r)}>
                    <X className="size-3.5" /> Refuser
                  </button>
                  <button type="button" className="btn btn-primary min-h-0 px-3 py-1.5 text-xs" disabled={busy === r.id} onClick={() => setDialog({ request: { id: r.id, requester: r.requester } })}>
                    <Check className="size-3.5" /> Accepter
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-muted">Accepter arrête toutes vos parties en cours. Rien n’est arrêté sans votre accord.</p>
        </section>
      )}

      <section className="card flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Mes parties en cours</h2>
        {data.games.length === 0 ? (
          <p className="text-sm text-ink-muted">Aucune partie en cours.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {data.games.map((g) => (
                <li key={g.matchId} className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    <span className="font-medium">{gameLabel(g)}</span>
                    <span className="block text-xs text-ink-muted">Si vous la quittez : {consequenceText(g).toLowerCase()}</span>
                  </span>
                  <Link href={`/match/${g.matchId}`} className="btn btn-primary min-h-0 w-fit shrink-0 px-3 py-1.5 text-xs">
                    <Play className="size-3.5" /> Reprendre
                  </Link>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-danger w-fit" onClick={() => setDialog({})}>
              <DoorOpen className="size-4" /> Quitter {data.games.length > 1 ? "mes parties en cours" : "ma partie en cours"}
            </button>
          </>
        )}
      </section>

      {dialog && (
        <QuitMyGamesDialog
          request={dialog.request}
          onClose={() => setDialog(null)}
          onDone={(ended) => {
            const requester = dialog.request?.requester;
            setDialog(null);
            setNotice({
              tone: "success",
              text: requester
                ? `C’est fait : ${requester} est prévenu et peut lancer votre partie.`
                : ended > 0
                  ? "Votre partie a été arrêtée. Vous êtes libre de lancer une nouvelle partie."
                  : "Vous n’avez plus de partie en cours.",
            });
            void load();
          }}
        />
      )}
    </div>
  );
}
