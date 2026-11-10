"use client";

import { Clock3, Swords } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

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

export function ActiveMatchBanner() {
  const [match, setMatch] = useState<ActiveMatchSummary | null>(null);
  const [now, setNow] = useState(0);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    let requestInProgress = false;
    let sessionRequired = false;

    async function refreshMatch() {
      if (requestInProgress || sessionRequired) return;
      requestInProgress = true;
      try {
        const response = await fetch("/api/match/active", {
          cache: "no-store",
        });
        if (response.status === 401) {
          sessionRequired = true;
          if (active) {
            setMatch(null);
            setLoadError(false);
          }
          return;
        }
        if (!response.ok) {
          throw new Error("Impossible de vérifier la partie active.");
        }
        const data = (await response.json()) as {
          match?: ActiveMatchSummary | null;
        };
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
    const refreshTimer = window.setInterval(() => void refreshMatch(), 2_500);
    window.addEventListener("thot:auth-changed", handleAuthChange);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("thot:auth-changed", handleAuthChange);
    };
  }, []);

  useEffect(() => {
    if (!match?.disconnectedAt) return;
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(clockTimer);
  }, [match?.disconnectedAt]);

  if (!match) {
    if (!loadError) return null;
    return (
      <div
        role="status"
        className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-xl rounded-2xl border border-amber-300/30 bg-[#171b15] px-4 py-3 text-center text-sm text-amber-100 shadow-xl"
      >
        Impossible de vérifier si vous avez une partie en cours.
      </div>
    );
  }

  const disconnectedAt = match.disconnectedAt
    ? new Date(match.disconnectedAt).getTime()
    : null;
  const remainingMs =
    disconnectedAt === null
      ? null
      : Math.max(
          0,
          match.gracePeriodMs - (Math.max(now, disconnectedAt) - disconnectedAt),
        );

  return (
    <aside
      role="status"
      className="fixed inset-x-3 bottom-3 z-[90] mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-emerald-300/30 bg-[#101713]/[.98] p-3 text-white shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Swords className="mt-0.5 size-5 shrink-0 text-emerald-300" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            Partie {match.gameType === "CHESS" ? "d’échecs" : "de dames"} en cours
            <span className="font-normal text-zinc-300">
              {" "}contre {match.opponentUsername}
            </span>
          </p>
          {remainingMs !== null ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-200">
              <Clock3 className="size-3.5" />
              {match.opponentDisconnected
                ? "Adversaire déconnecté"
                : "Connexion à la partie interrompue"}
              {" · "}
              {remainingMs > 0
                ? `${formatTime(remainingMs)} pour reprendre`
                : "délai de reconnexion expiré"}
            </p>
          ) : (
            <p className="mt-1 text-xs text-zinc-400">
              Votre partie est toujours accessible.
            </p>
          )}
        </div>
      </div>
      <Link
        href={`/match/${encodeURIComponent(match.matchId)}`}
        className="inline-flex shrink-0 items-center justify-center rounded-xl bg-emerald-300 px-4 py-2.5 text-sm font-bold text-emerald-950 transition hover:bg-emerald-200"
      >
        Rejoindre la partie
      </Link>
    </aside>
  );
}
