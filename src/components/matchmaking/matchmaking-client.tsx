"use client";

import { AdSlot } from "@/components/ads/ad-slot";
import { PremiumHint } from "@/components/premium/premium-hint";
import { track } from "@/lib/client/telemetry";
import {
  ArrowLeft,
  CircleDot,
  Coins,
  Trophy,
  Crown,
  LoaderCircle,
  Radio,
  Search,
  Shuffle,
  Swords,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createGameSocket } from "@/lib/socket";
import type {
  GameMode,
  GameType,
  JoinQueuePayload,
  MatchmakingStrategy,
} from "@/types";

interface UserOption {
  id: string;
  username: string;
  pointsFree: number;
  country: string | null;
  city: string | null;
  neighborhood: string | null;
}

interface SearchCriteriaForm {
  minPoints: string;
  maxPoints: string;
  country: string;
  city: string;
  neighborhood: string;
}

const EMPTY_CRITERIA: SearchCriteriaForm = {
  minPoints: "",
  maxPoints: "",
  country: "",
  city: "",
  neighborhood: "",
};

function uniqueLocations(
  users: UserOption[],
  key: "country" | "city" | "neighborhood",
): string[] {
  return Array.from(
    new Set(users.map((user) => user[key]).filter((value): value is string => !!value)),
  ).sort((left, right) => left.localeCompare(right, "fr"));
}

export function MatchmakingClient() {
  const router = useRouter();
  const socketRef = useRef<ReturnType<typeof createGameSocket> | null>(null);
  const matchmakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuePayloadRef = useRef<JoinQueuePayload | null>(null);
  const cutMatchIdRef = useRef<string | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [playerId, setPlayerId] = useState("");
  const [gameType, setGameType] = useState<GameType>("CHESS");
  const [strategy, setStrategy] = useState<MatchmakingStrategy>("RANDOM");
  const [criteria, setCriteria] = useState<SearchCriteriaForm>(EMPTY_CRITERIA);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [onlinePlayers, setOnlinePlayers] = useState(0);
  const [activeMatchConflict, setActiveMatchConflict] = useState<{
    matchId: string;
    opponentUsername: string;
    disconnectedPlayerId: string | null;
    gracePeriodMs: number;
  } | null>(null);
  const [cuttingMatch, setCuttingMatch] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>("CASUAL");
  const [quota, setQuota] = useState<{ limited: boolean; limit: number; remaining: number | null; resetsAt: string } | null>(null);
  const [quotaReached, setQuotaReached] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/player/quota", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((q) => {
        if (!active || !q) return;
        setQuota(q);
        if (q.limited && q.remaining === 0) setQuotaReached(true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const [draughtsVariant, setDraughtsVariant] = useState<"INTERNATIONAL" | "ENGLISH">("INTERNATIONAL");
  const [timeControl, setTimeControl] = useState<number | null>(null);
  const [stake, setStake] = useState<number | null>(null);
  const [moneyConsent, setMoneyConsent] = useState(false);
  const [waiting, setWaiting] = useState<Record<string, number> | null>(null);
  const [playOptions, setPlayOptions] = useState<{
    modes: Record<GameMode, boolean>;
    timeControl: { min: number; max: number };
    money: {
      minStake: number;
      maxStake: number;
      presets: number[];
      commissionPercent: number;
      eligible: boolean;
      reason: string | null;
      available: string;
    };
  } | null>(null);

  useEffect(() => {
    fetch("/api/play/options", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((options) => {
        if (options) setPlayOptions(options);
      })
      .catch(() => undefined);
    try {
      const stored = window.localStorage.getItem("thot-strategie-draughts-variant");
      if (stored === "ENGLISH" || stored === "INTERNATIONAL") setDraughtsVariant(stored);
    } catch {
      // stockage indisponible : valeur par défaut
    }
  }, []);

  const currentUser = users.find((user) => user.id === playerId);
  const countries = useMemo(() => uniqueLocations(users, "country"), [users]);
  const cities = useMemo(() => uniqueLocations(users, "city"), [users]);
  const neighborhoods = useMemo(
    () => uniqueLocations(users, "neighborhood"),
    [users],
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 12_000);

    async function loadUsers() {
      try {
        const [profileResponse, usersResponse] = await Promise.all([
          fetch("/api/auth/me", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/api/user", {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        if (!active) return;
        if (profileResponse.status === 401) {
          setError("Connectez-vous pour rechercher un adversaire.");
          return;
        }
        const profileData = (await profileResponse.json()) as {
          user?: { id: string };
          error?: string;
        };
        const data = (await usersResponse.json()) as {
          users?: UserOption[];
          error?: string;
        };
        if (!profileResponse.ok) {
          throw new Error(profileData.error ?? "Impossible de charger votre session.");
        }
        if (!usersResponse.ok) {
          throw new Error(data.error ?? "Impossible de charger les profils.");
        }
        if (!profileData.user?.id || !Array.isArray(data.users)) {
          throw new Error("Les données du profil sont incomplètes. Réessayez.");
        }
        if (!active) return;
        setUsers(data.users);
        setPlayerId(profileData.user.id);
      } catch (caughtError) {
        if (active) {
          setError(
            controller.signal.aborted
              ? "Le chargement du profil a dépassé 12 secondes. Vérifiez la connexion puis réessayez."
              : caughtError instanceof Error
              ? caughtError.message
              : "Impossible de charger les profils.",
          );
        }
      } finally {
        window.clearTimeout(requestTimeout);
        if (active) setLoading(false);
      }
    }
    void loadUsers();
    return () => {
      active = false;
      window.clearTimeout(requestTimeout);
      controller.abort();
    };
  }, [loadAttempt]);

  useEffect(
    () => () => {
      if (matchmakingTimeoutRef.current) {
        clearTimeout(matchmakingTimeoutRef.current);
      }
      socketRef.current?.disconnect();
    },
    [],
  );

  function stopSearch() {
    if (matchmakingTimeoutRef.current) {
      clearTimeout(matchmakingTimeoutRef.current);
      matchmakingTimeoutRef.current = null;
    }
    const socket = socketRef.current;
    if (socket) {
      socket.emit("leave_queue");
      socket.disconnect();
      socketRef.current = null;
    }
    queuePayloadRef.current = null;
    setSearching(false);
    setStatus("Recherche arrêtée.");
  }

  function beginSearch() {
    if (!currentUser) {
      setError("Choisissez un profil avant de rechercher un adversaire.");
      return;
    }
    if (strategy === "TARGETED") {
      const minimum = criteria.minPoints.trim()
        ? Number(criteria.minPoints)
        : undefined;
      const maximum = criteria.maxPoints.trim()
        ? Number(criteria.maxPoints)
        : undefined;
      if (
        (minimum !== undefined && !Number.isFinite(minimum)) ||
        (maximum !== undefined && !Number.isFinite(maximum)) ||
        (minimum !== undefined &&
          maximum !== undefined &&
          minimum > maximum)
      ) {
        setError("Vérifiez les limites de points : le minimum doit être inférieur au maximum.");
        return;
      }
    }

    if (gameMode === "MONEY" && (!stake || !moneyConsent)) {
      setError("Choisissez une mise et confirmez votre accord avant de lancer une partie rémunérée.");
      return;
    }
    const queuePayload: JoinQueuePayload = {
      gameType,
      mode: gameMode,
      stake: gameMode === "MONEY" ? stake : null,
      draughtsVariant: gameType === "CHECKERS" ? draughtsVariant : undefined,
      timeControlMinutes: timeControl,
      strategy,
      criteria:
        strategy === "TARGETED"
          ? {
              ...(criteria.minPoints.trim()
                ? { minPoints: Number(criteria.minPoints) }
                : {}),
              ...(criteria.maxPoints.trim()
                ? { maxPoints: Number(criteria.maxPoints) }
                : {}),
              ...(criteria.country ? { country: criteria.country } : {}),
              ...(criteria.city ? { city: criteria.city } : {}),
              ...(criteria.neighborhood
                ? { neighborhood: criteria.neighborhood }
                : {}),
            }
          : {},
    };
    queuePayloadRef.current = queuePayload;
    setError("");
    setStatus("Connexion au serveur de jeu…");
    setSearching(true);
    const socket = createGameSocket();
    socketRef.current = socket;
    matchmakingTimeoutRef.current = setTimeout(() => {
      if (socketRef.current !== socket) return;
      setSearching(false);
      setError(
        "Le serveur ne répond pas. La demande a été annulée ; vérifiez la connexion puis réessayez.",
      );
      socket.disconnect();
      socketRef.current = null;
      matchmakingTimeoutRef.current = null;
    }, 12_000);

    socket.on("presence_update", ({ onlinePlayers: count }) => {
      setOnlinePlayers(count);
    });
    socket.on("queue_stats", ({ waiting: counts }) => setWaiting(counts));
    socket.on("connect", () => {
      setStatus("Recherche en cours. Un adversaire doit aussi être connecté et rechercher une partie.");
      socket.emit("join_queue", queuePayload);
    });
    socket.on("active_match_conflict", (conflict) => {
      if (socketRef.current !== socket) return;
      if (matchmakingTimeoutRef.current) {
        clearTimeout(matchmakingTimeoutRef.current);
        matchmakingTimeoutRef.current = null;
      }
      setSearching(false);
      setCuttingMatch(false);
      setActiveMatchConflict(conflict);
      setStatus("Une partie précédente doit être clôturée avant toute nouvelle recherche.");
    });
    socket.on("match_finished", ({ matchId: finishedMatchId }) => {
      if (cutMatchIdRef.current !== finishedMatchId) return;
      cutMatchIdRef.current = null;
      setActiveMatchConflict(null);
      setCuttingMatch(false);
      const currentSocket = socketRef.current;
      const payload = queuePayloadRef.current;
      if (!currentSocket?.connected || !payload) {
        setError("La partie est clôturée. Relancez la recherche d’adversaire.");
        setStatus("Partie précédente clôturée.");
        return;
      }
      setSearching(true);
      setStatus("Partie clôturée. Nouvelle recherche en cours…");
      currentSocket.emit("join_queue", payload);
      matchmakingTimeoutRef.current = setTimeout(() => {
        if (socketRef.current !== currentSocket) return;
        setSearching(false);
        setError(
          "Le serveur ne répond pas. La demande a été annulée ; vérifiez la connexion puis réessayez.",
        );
        currentSocket.disconnect();
        socketRef.current = null;
        matchmakingTimeoutRef.current = null;
      }, 12_000);
    });
    socket.on("queue_joined", () => {
      if (matchmakingTimeoutRef.current) {
        clearTimeout(matchmakingTimeoutRef.current);
        matchmakingTimeoutRef.current = null;
      }
      setStatus(
        strategy === "RANDOM"
          ? "Vous êtes dans la file aléatoire. La recherche attend un autre joueur en ligne."
          : "Recherche ciblée active. La recherche attend un joueur qui correspond à vos critères.",
      );
    });
    socket.on("queue_left", () => setStatus("Recherche arrêtée."));
    socket.on("match_found", ({ matchId, opponentId }) => {
      setActiveMatchConflict(null);
      if (matchmakingTimeoutRef.current) {
        clearTimeout(matchmakingTimeoutRef.current);
        matchmakingTimeoutRef.current = null;
      }
      setStatus("Adversaire trouvé, préparation de la partie…");
      setSearching(false);
      socket.disconnect();
      socketRef.current = null;
      router.push(
        `/match/${encodeURIComponent(matchId)}?opponent=${encodeURIComponent(opponentId)}`,
      );
    });
    socket.on("quota_reached", (q) => {
      setQuota({ limited: true, limit: q.limit, remaining: 0, resetsAt: q.resetsAt });
      setQuotaReached(true);
      track("quota_reached", { limit: q.limit });
    });
    socket.on("server_error", ({ message }) => {
      if (matchmakingTimeoutRef.current) {
        clearTimeout(matchmakingTimeoutRef.current);
        matchmakingTimeoutRef.current = null;
      }
      setSearching(false);
      setCuttingMatch(false);
      setActiveMatchConflict(null);
      cutMatchIdRef.current = null;
      setError(message);
      socket.disconnect();
      socketRef.current = null;
    });
    socket.on("connect_error", (connectionError) => {
      if (matchmakingTimeoutRef.current) {
        clearTimeout(matchmakingTimeoutRef.current);
        matchmakingTimeoutRef.current = null;
      }
      setSearching(false);
      setCuttingMatch(false);
      setActiveMatchConflict(null);
      cutMatchIdRef.current = null;
      setError(
        `Connexion au serveur impossible : ${connectionError.message}. Vérifiez que le serveur Next.js est lancé.`,
      );
      socket.disconnect();
      socketRef.current = null;
    });
    socket.connect();
  }

  function confirmCutActiveMatch() {
    const conflict = activeMatchConflict;
    const socket = socketRef.current;
    if (!conflict || !socket?.connected || cuttingMatch) return;
    setError("");
    setCuttingMatch(true);
    setStatus("Clôture de la partie et enregistrement de l’abandon…");
    cutMatchIdRef.current = conflict.matchId;
    socket.emit("cut_match", { matchId: conflict.matchId });
  }

  function cancelActiveMatchCut() {
    socketRef.current?.disconnect();
    socketRef.current = null;
    queuePayloadRef.current = null;
    cutMatchIdRef.current = null;
    setActiveMatchConflict(null);
    setCuttingMatch(false);
    setStatus("Recherche annulée. La partie précédente reste active.");
  }

  return (
    <main className="flex-1 px-4 py-6 text-ink sm:px-8 sm:py-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7">
        

        <section>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-200/70">
            Matchmaking
          </p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">
            Trouvez votre adversaire
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">
            La file n’affiche pas automatiquement tous les profils : seuls les
            joueurs connectés à cette page et en recherche peuvent être associés.
          </p>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-7">
          <p className="text-sm font-medium text-white/80">Connecté en tant que</p>
          {currentUser ? (
            <p className="mt-2 text-sm text-emerald-100">
              {currentUser.username} · {currentUser.pointsFree} points
            </p>
          ) : !loading ? (
            <p className="mt-2 text-sm text-amber-100/80">
              <Link className="underline" href="/dashboard">
                Connectez-vous ou créez un profil
              </Link>{" "}
              avant de jouer.
            </p>
          ) : null}
          {currentUser && (
            <p className="mt-2 text-xs text-white/40">
              {currentUser.country ?? "Pays non renseigné"}
              {currentUser.city ? ` · ${currentUser.city}` : ""}
              {currentUser.neighborhood ? ` · ${currentUser.neighborhood}` : ""}
            </p>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          {([
            ["CHESS", "Échecs", Crown],
            ["CHECKERS", "Dames", CircleDot],
          ] as const).map(([type, label, Icon]) => (
            <button
              key={type}
              type="button"
              onClick={() => setGameType(type)}
              className={`flex items-center gap-4 rounded-2xl border p-5 text-left transition ${
                gameType === type
                  ? "border-emerald-200/50 bg-emerald-200/[0.08]"
                  : "border-white/10 bg-white/[0.025] hover:border-white/20"
              }`}
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-white/[0.07] text-emerald-100">
                <Icon size={22} />
              </span>
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="mt-1 block text-xs text-white/40">
                  {gameType === type ? "Sélectionné" : "Choisir ce jeu"}
                </span>
              </span>
            </button>
          ))}
        </section>

        <section className="card p-5 sm:p-6">
          <h2 className="text-base font-semibold">Type de partie</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Vous ne serez apparié qu’avec un joueur ayant choisi exactement le même type, la même variante, la même cadence{gameMode === "MONEY" ? " et la même mise" : ""}.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Mode de jeu">
            {([
              ["CASUAL", "Amicale", "Points classiques, sans effet sur l’ELO.", Users, "chip-casual"],
              ["RATED", "Classée", "Compte pour votre classement ALO/ELO.", Trophy, "chip-rated"],
              ["MONEY", "Rémunérée", "Mise en points argent, consentement requis.", Coins, "chip-money"],
            ] as const).map(([mode, label, hint, Icon, chip]) => {
              const available = playOptions ? playOptions.modes[mode] : mode !== "MONEY";
              const selected = gameMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!available || searching}
                  onClick={() => {
                    setGameMode(mode);
                    setMoneyConsent(false);
                  }}
                  className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                    selected ? "border-accent/60 bg-accent/[0.07]" : "border-line hover:border-line-strong"
                  }`}
                >
                  <span className={`chip ${chip}`}>
                    <Icon className="size-3.5" /> {label}
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-ink-muted">
                    {available ? hint : "Fermé par l’administration."}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {gameType === "CHECKERS" && (
              <label className="text-xs font-medium text-ink-muted">
                Variante
                <select
                  value={draughtsVariant}
                  disabled={searching}
                  onChange={(event) => setDraughtsVariant(event.target.value as "INTERNATIONAL" | "ENGLISH")}
                  className="field mt-1.5"
                >
                  <option value="INTERNATIONAL">Internationales 10×10</option>
                  <option value="ENGLISH">Anglaises 8×8</option>
                </select>
              </label>
            )}
            <div className="text-xs font-medium text-ink-muted">
              Cadence
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {([null, 3, 5, 10, 15] as const)
                  .filter(
                    (minutes) =>
                      minutes === null ||
                      !playOptions ||
                      (minutes >= playOptions.timeControl.min && minutes <= playOptions.timeControl.max),
                  )
                  .map((minutes) => (
                    <button
                      key={minutes ?? "none"}
                      type="button"
                      disabled={searching}
                      onClick={() => setTimeControl(minutes)}
                      className={`btn min-h-0 px-3 py-1.5 text-xs ${timeControl === minutes ? "btn-primary" : "btn-ghost"}`}
                    >
                      {minutes === null ? "Sans pendule" : `${minutes} min`}
                    </button>
                  ))}
              </div>
            </div>
          </div>

          {gameMode === "MONEY" && playOptions && (
            <div className="mt-5 rounded-xl border border-money/30 bg-money/[0.06] p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-money">
                <Coins className="size-4" /> Partie rémunérée
              </p>
              {!playOptions.money.eligible ? (
                <p className="mt-2 text-sm text-ink-soft">{playOptions.money.reason}</p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-ink-muted">
                    Solde disponible : {new Intl.NumberFormat("fr-FR").format(Number(playOptions.money.available))} FCFA · commission plateforme {playOptions.money.commissionPercent} % du pot.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {playOptions.money.presets.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        disabled={searching || Number(playOptions.money.available) < amount}
                        onClick={() => {
                          setStake(amount);
                          setMoneyConsent(false);
                        }}
                        className={`btn min-h-0 px-3 py-1.5 text-xs ${stake === amount ? "btn-primary" : "btn-ghost"}`}
                      >
                        {new Intl.NumberFormat("fr-FR").format(amount)} FCFA
                      </button>
                    ))}
                  </div>
                  {stake && (
                    <label className="mt-3 flex items-start gap-2.5 text-sm text-ink-soft">
                      <input
                        type="checkbox"
                        checked={moneyConsent}
                        disabled={searching}
                        onChange={(event) => setMoneyConsent(event.target.checked)}
                        className="mt-1 accent-[var(--money)]"
                      />
                      <span>
                        J’accepte de bloquer {new Intl.NumberFormat("fr-FR").format(stake)} FCFA. En cas de victoire je reçois{" "}
                        {new Intl.NumberFormat("fr-FR").format(Math.round(stake * 2 * (1 - playOptions.money.commissionPercent / 100)))} FCFA ; en cas de défaite je perds ma mise ; la nulle et l’annulation rendent la mise.
                      </span>
                    </label>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-7">
          <h2 className="text-lg font-semibold">Type de recherche</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStrategy("RANDOM")}
              className={`rounded-2xl border p-4 text-left transition ${
                strategy === "RANDOM"
                  ? "border-sky-200/45 bg-sky-200/[0.07]"
                  : "border-white/10 hover:border-white/20"
              }`}
            >
              <Shuffle className="mb-3 text-sky-200" size={20} />
              <span className="block font-semibold">Choix aléatoire</span>
              <span className="mt-1 block text-xs leading-5 text-white/45">
                Trouver un joueur connecté sans filtre de profil.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStrategy("TARGETED")}
              className={`rounded-2xl border p-4 text-left transition ${
                strategy === "TARGETED"
                  ? "border-amber-200/45 bg-amber-200/[0.07]"
                  : "border-white/10 hover:border-white/20"
              }`}
            >
              <Search className="mb-3 text-amber-100" size={20} />
              <span className="block font-semibold">Recherche ciblée</span>
              <span className="mt-1 block text-xs leading-5 text-white/45">
                Filtrer par solde de points et localisation.
              </span>
            </button>
          </div>

          {strategy === "TARGETED" && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-white/65">
                Points minimum
                <input
                  type="number"
                  value={criteria.minPoints}
                  onChange={(event) =>
                    setCriteria((current) => ({
                      ...current,
                      minPoints: event.target.value,
                    }))
                  }
                  placeholder="Aucun minimum"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-surface-2 px-3 py-2.5 text-white outline-none focus:border-emerald-300/60"
                />
              </label>
              <label className="text-sm text-white/65">
                Points maximum
                <input
                  type="number"
                  value={criteria.maxPoints}
                  onChange={(event) =>
                    setCriteria((current) => ({
                      ...current,
                      maxPoints: event.target.value,
                    }))
                  }
                  placeholder="Aucun maximum"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-surface-2 px-3 py-2.5 text-white outline-none focus:border-emerald-300/60"
                />
              </label>
              {([
                ["country", "Pays", countries],
                ["city", "Ville", cities],
                ["neighborhood", "Quartier", neighborhoods],
              ] as const).map(([key, label, options]) => (
                <label key={key} className="text-sm text-white/65">
                  {label}
                  <select
                    value={criteria[key]}
                    onChange={(event) =>
                      setCriteria((current) => ({
                        ...current,
                        [key]: event.target.value,
                        ...(key === "country" ? { city: "", neighborhood: "" } : {}),
                        ...(key === "city" ? { neighborhood: "" } : {}),
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-white/10 bg-surface-2 px-3 py-2.5 text-white outline-none focus:border-emerald-300/60"
                  >
                    <option value="">Tous les {label.toLocaleLowerCase()}s</option>
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <p className="sm:col-span-2 text-xs leading-5 text-white/40">
                Les limites s’appliquent aux points gratuits du joueur recherché.
                Les critères de chaque joueur doivent être compatibles pour que la
                partie démarre.
              </p>
            </div>
          )}
        </section>

        {quota?.limited && !quotaReached && quota.remaining !== null && (
          <p className="text-xs text-ink-muted">
            Parties en ligne gratuites restantes aujourd’hui : <strong className="tabular text-ink">{quota.remaining} / {quota.limit}</strong>.
            Les tournois et l’entraînement contre l’IA ne sont pas décomptés.
          </p>
        )}

        {quotaReached && (
          <section className="card space-y-3 p-5" aria-live="polite">
            <h2 className="text-base font-semibold">Vous avez joué vos {quota?.limit ?? ""} parties gratuites du jour</h2>
            <p className="text-sm text-ink-soft">
              Le compteur repart à zéro à minuit. Votre partie en cours, s’il y en a une, n’est jamais concernée. En attendant :
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Link href="/tournois" className="btn btn-ghost justify-start">Jouer un tournoi</Link>
              <Link href="/match/ia" className="btn btn-ghost justify-start">S’entraîner contre l’IA</Link>
              <Link href="/mes-parties" className="btn btn-ghost justify-start">Revoir mes parties</Link>
            </div>
            <PremiumHint context="quota" title="Jouer sans limite">
              Tous les niveaux Premium incluent les parties en ligne illimitées, sans aucun avantage sur le plateau.
            </PremiumHint>
          </section>
        )}

        {error && !(quotaReached && error.startsWith("Vous avez joué vos")) && (
          <div className="flex items-start justify-between gap-4 rounded-xl border border-red-300/20 bg-red-300/[0.06] p-4 text-sm text-red-100">
            <div>
              <p>{error}</p>
              {!loading && !currentUser && (
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setLoading(true);
                    setLoadAttempt((attempt) => attempt + 1);
                  }}
                  className="mt-3 rounded-lg bg-white/10 px-3 py-2 font-semibold hover:bg-white/15"
                >
                  Réessayer le chargement du profil
                </button>
              )}
            </div>
            {currentUser && (
              <button
                type="button"
                aria-label="Fermer le message"
                onClick={() => setError("")}
              >
                <X size={17} />
              </button>
            )}
          </div>
        )}

        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
          <div className="flex items-start gap-3">
            <Radio className="mt-0.5 shrink-0 text-emerald-200" size={18} />
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-medium">
                  {searching ? "Recherche active" : "Aucune recherche active"}
                </p>
                {searching && waiting && (
                  <span className="text-xs text-ink-muted">
                    En file : {waiting.CASUAL ?? 0} amicale · {waiting.RATED ?? 0} classée
                    {playOptions?.modes.MONEY ? ` · ${waiting.MONEY ?? 0} rémunérée` : ""}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 text-xs text-white/55">
                  <Users size={13} />
                  {searching
                    ? `${onlinePlayers} joueur${onlinePlayers === 1 ? "" : "s"} connecté${onlinePlayers === 1 ? "" : "s"}`
                    : "Statut hors ligne"}
                </span>
              </div>
              <p className="mt-1 text-sm leading-5 text-white/50">
                {status ||
                  "Lancez une recherche. Pour simuler plusieurs joueurs, ouvrez le site dans un autre navigateur avec un autre profil."}
              </p>
            </div>
          </div>
        </section>

        <button
          type="button"
          onClick={searching ? stopSearch : beginSearch}
          disabled={
            loading ||
            !currentUser ||
            activeMatchConflict !== null ||
            (!searching && gameMode === "MONEY" && (!stake || !moneyConsent || !playOptions?.money.eligible))
          }
          className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            searching
              ? "border border-red-200/20 bg-red-200/[0.08] text-red-100 hover:bg-red-200/[0.13]"
              : "bg-emerald-300 text-accent-ink hover:bg-emerald-200"
          }`}
        >
          {searching ? (
            <>
              <X size={18} />
              Annuler la recherche
            </>
          ) : loading ? (
            <>
              <LoaderCircle className="animate-spin" size={18} />
              Chargement des profils…
            </>
          ) : (
            <>
              <Radio size={18} />
              Rechercher un adversaire
            </>
          )}
        </button>
      </div>
      {activeMatchConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="active-match-title"
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-surface-2 p-6 shadow-2xl"
          >
            <h2 id="active-match-title" className="text-xl font-semibold">
              Partie encore active
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/70">
              Une partie contre <strong>{activeMatchConflict.opponentUsername}</strong>{" "}
              attend encore. Vous ne pouvez pas rechercher un nouvel adversaire
              tant que cette partie n’est pas terminée.
            </p>
            {activeMatchConflict.disconnectedPlayerId && (
              <p className="mt-3 rounded-xl bg-amber-200/10 p-3 text-sm text-amber-100">
                {activeMatchConflict.gracePeriodMs > 0
                  ? `${activeMatchConflict.disconnectedPlayerId === playerId ? "Vous avez" : "Votre adversaire a"} 60 secondes pour revenir. Il reste environ ${Math.ceil(activeMatchConflict.gracePeriodMs / 1000)} secondes.`
                  : "Le délai de reconnexion est écoulé ; la partie est en cours de clôture."}
              </p>
            )}
            <p className="mt-3 text-sm text-rose-200/90">
              Si vous coupez maintenant, votre adversaire remporte la partie par
              abandon. Le résultat et les points seront enregistrés. Cette action
              est définitive et la partie ne pourra pas être relancée.
            </p>
            <div className="mt-6 flex flex-col-reverse justify-end gap-3 sm:flex-row">
              <button
                type="button"
                onClick={cancelActiveMatchCut}
                disabled={cuttingMatch}
                className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-white/75 disabled:opacity-50"
              >
                Annuler la recherche
              </button>
              <button
                type="button"
                onClick={confirmCutActiveMatch}
                disabled={cuttingMatch || !socketRef.current?.connected}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-300 px-4 py-2.5 text-sm font-semibold text-rose-950 disabled:opacity-50"
              >
                {cuttingMatch && <LoaderCircle className="size-4 animate-spin" />}
                {cuttingMatch ? "Clôture en cours…" : "Couper et rechercher"}
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="mx-auto mt-8 w-full max-w-4xl">
        <AdSlot placement="play" />
      </div>
    </main>
  );
}
