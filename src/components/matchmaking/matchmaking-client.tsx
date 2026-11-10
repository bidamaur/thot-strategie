"use client";

import {
  ArrowLeft,
  CircleDot,
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
import type { GameType, MatchmakingStrategy } from "@/types";

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
    socket.on("connect", () => {
      setStatus("Recherche en cours. Un adversaire doit aussi être connecté et rechercher une partie.");
      socket.emit("join_queue", {
        gameType,
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
      });
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
    socket.on("server_error", ({ message }) => {
      if (matchmakingTimeoutRef.current) {
        clearTimeout(matchmakingTimeoutRef.current);
        matchmakingTimeoutRef.current = null;
      }
      setSearching(false);
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
      setError(
        `Connexion au serveur impossible : ${connectionError.message}. Vérifiez que le serveur Next.js est lancé.`,
      );
      socket.disconnect();
      socketRef.current = null;
    });
    socket.connect();
  }

  return (
    <main className="min-h-screen bg-[#080d0b] px-5 py-8 text-[#f3f5ef] sm:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-white/60 transition hover:text-white"
          >
            <ArrowLeft size={17} />
            Tableau de bord
          </Link>
          <span className="flex items-center gap-2 text-sm font-semibold tracking-wide text-emerald-100">
            <Swords size={18} />
            THOT STRATÉGIE
          </span>
        </header>

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
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#111915] px-3 py-2.5 text-white outline-none focus:border-emerald-300/60"
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
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#111915] px-3 py-2.5 text-white outline-none focus:border-emerald-300/60"
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
                    className="mt-2 w-full rounded-xl border border-white/10 bg-[#111915] px-3 py-2.5 text-white outline-none focus:border-emerald-300/60"
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

        {error && (
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
          disabled={loading || !currentUser}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            searching
              ? "border border-red-200/20 bg-red-200/[0.08] text-red-100 hover:bg-red-200/[0.13]"
              : "bg-emerald-300 text-[#07100c] hover:bg-emerald-200"
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
    </main>
  );
}
