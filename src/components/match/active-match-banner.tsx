"use client";

import { Clock3, DoorOpen, Play, Swords } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { QuitMyGamesDialog } from "./player-busy-panel";

interface ActiveMatchSummary {
  matchId: string;
  gameType: "CHESS" | "CHECKERS";
  opponentUsername: string;
  disconnectedAt: string | null;
  opponentDisconnected: boolean;
  gracePeriodMs: number;
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Pages où l'on joue déjà (salle de jeu en ligne, partie contre l'IA) : le ruban
 * n'y a aucun sens et ne doit jamais recouvrir le plateau.
 */
function isPlayingPath(pathname: string): boolean {
  return /^\/match\/(?!en-ligne$|ia$)[^/]+/.test(pathname);
}

/**
 * Ruban « partie en cours » : uniquement HORS de la salle de jeu, quand le joueur
 * a une partie en cours. Deux choix : la rejoindre ou l'arrêter (avec confirmation
 * et conséquences affichées).
 */
export function ActiveMatchBanner() {
  const pathname = usePathname() ?? "/";
  const playing = isPlayingPath(pathname);
  const [match, setMatch] = useState<ActiveMatchSummary | null>(null);
  const [now, setNow] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    // Dans la salle de jeu, inutile d'interroger le serveur : le ruban est masqué.
    if (playing) return;
    let active = true;
    let requestInProgress = false;
    let sessionRequired = false;

    async function refreshMatch() {
      if (requestInProgress || sessionRequired || document.hidden) return;
      requestInProgress = true;
      try {
        const response = await fetch("/api/match/active", { cache: "no-store" });
        if (response.status === 401) {
          sessionRequired = true;
          if (active) {
            setMatch(null);
            setLoadError(false);
          }
          return;
        }
        if (!response.ok) {
          if (active) setLoadError(true);
          return;
        }
        const data = (await response.json()) as { match?: ActiveMatchSummary | null };
        if (active) {
          setMatch(data.match ?? null);
          setLoadError(false);
        }
      } catch (error) {
        console.error("Erreur lors de l’actualisation de la partie :", error);
        if (active) setLoadError(true);
      } finally {
        requestInProgress = false;
      }
    }

    function handleAuthChange() {
      sessionRequired = false;
      void refreshMatch();
    }

    void refreshMatch();
    const refreshTimer = window.setInterval(() => void refreshMatch(), 5_000);
    window.addEventListener("thot:auth-changed", handleAuthChange);
    document.addEventListener("visibilitychange", refreshMatch);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("thot:auth-changed", handleAuthChange);
      document.removeEventListener("visibilitychange", refreshMatch);
    };
  }, [playing, refreshKey]);

  useEffect(() => {
    if (!match?.disconnectedAt || playing) return;
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(clockTimer);
  }, [match?.disconnectedAt, playing]);

  if (playing) return null;

  // Au-dessus de la barre de navigation mobile, en bas d'écran sur ordinateur.
  const position =
    "fixed inset-x-2 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[45] mx-auto max-w-2xl lg:bottom-4";

  if (!match) {
    if (!loadError) return null;
    return (
      <div role="status" className={`${position} rounded-xl border border-gold/30 bg-surface-2 px-4 py-2.5 text-center text-sm text-gold shadow-xl`}>
        Impossible de vérifier si vous avez une partie en cours.
      </div>
    );
  }

  const disconnectedAt = match.disconnectedAt ? new Date(match.disconnectedAt).getTime() : null;
  const remainingMs =
    disconnectedAt === null ? null : Math.max(0, match.gracePeriodMs - (Math.max(now, disconnectedAt) - disconnectedAt));
  if (remainingMs === 0) return null;

  return (
    <>
      <aside
        role="status"
        aria-label="Partie en cours"
        className={`${position} flex items-center gap-2 rounded-2xl border border-accent/30 bg-surface/95 p-2 pl-3 shadow-2xl backdrop-blur-md animate-rise`}
      >
        <Swords className="hidden size-5 shrink-0 text-accent sm:block" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            {match.gameType === "CHESS" ? "Échecs" : "Dames"}
            <span className="font-normal text-ink-muted"> contre {match.opponentUsername}</span>
          </p>
          {remainingMs !== null ? (
            <p className="flex items-center gap-1 truncate text-xs text-gold">
              <Clock3 className="size-3.5 shrink-0" />
              {match.opponentDisconnected ? "Adversaire déconnecté" : "Revenez vite"} · {formatTime(remainingMs)}
            </p>
          ) : (
            <p className="truncate text-xs text-ink-muted">Partie en cours</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setStopOpen(true)}
          className="btn btn-ghost min-h-0 shrink-0 gap-1.5 px-3 py-2 text-sm text-danger"
        >
          <DoorOpen className="size-4" />
          Stopper
        </button>
        <Link href={`/match/${encodeURIComponent(match.matchId)}`} className="btn btn-primary min-h-0 shrink-0 gap-1.5 px-3 py-2 text-sm">
          <Play className="size-4" />
          Rejoindre
        </Link>
      </aside>

      {stopOpen && (
        <QuitMyGamesDialog
          onClose={() => setStopOpen(false)}
          onDone={() => {
            setStopOpen(false);
            setMatch(null);
            setRefreshKey((key) => key + 1);
          }}
        />
      )}
    </>
  );
}
