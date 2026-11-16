"use client";

import { AdSlot } from "@/components/ads/ad-slot";
import {
  ArrowLeft,
  Check,
  CircleDollarSign,
  Crown,
  Gift,
  LoaderCircle,
  MapPin,
  Send,
  Trophy,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

interface UserOption {
  id: string;
  username: string;
  isAdmin: boolean;
  isPremium: boolean;
  pointsFree: number;
  walletReal?: string;
  country: string | null;
  city: string | null;
  neighborhood: string | null;
}

interface ProfileUser {
  id: string;
  username: string;
  isAdmin: boolean;
  isPremium: boolean;
  pointsFree: number;
  elo: number;
  walletReal?: string;
  country: string | null;
  city: string | null;
  neighborhood: string | null;
}

interface TournamentSummary {
  id: string;
  name: string;
  creatorId: string;
  creator: { id: string; username: string };
  scope: string;
  city: string | null;
  region: string | null;
  country: string | null;
  continent: string | null;
  type: string;
  gameType: string;
  isPaid: boolean;
  entryFee: string;
  entryPoints: number;
  totalPrizePool: string;
  maxPlayers: number;
  minElo: number | null;
  maxElo: number | null;
  minPoints: number | null;
  maxPoints: number | null;
  minBet: number | null;
  maxBet: number | null;
  status: string;
  _count: { participants: number };
  isParticipant: boolean;
  invitations: Array<{
    id: string;
    userId: string;
    status: "PENDING" | "ACCEPTED" | "DECLINED";
  }>;
}

interface TournamentAction {
  tournament: TournamentSummary;
  intent: "join" | "accept";
  invitationId?: string;
}

async function responseJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "Une erreur est survenue.");
  }
  return data;
}

function formatPoints(value: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
}

export function TournamentsClient() {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [currentUser, setCurrentUser] = useState<ProfileUser | null>(null);
  const [selectedInviteIds, setSelectedInviteIds] = useState<string[]>([]);
  const [tournamentName, setTournamentName] = useState("");
  const [tournamentType, setTournamentType] = useState("SURVIVAL_BANK");
  const [tournamentScope, setTournamentScope] = useState("CITY");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  // Survival : monnaie de la mise d'inscription, durée et type de mise.
  const [entryCurrency, setEntryCurrency] = useState<"POINTS" | "MONEY">("POINTS");
  const [durationDays, setDurationDays] = useState("7");
  const [betMode, setBetMode] = useState<"FIXED" | "VARIABLE">("FIXED");
  const [arenaMinutes, setArenaMinutes] = useState("60");
  const [clubIdParam, setClubIdParam] = useState<string | null>(null);
  useEffect(() => {
    // Tournoi de club : /tournois?club=<id> depuis la page du club.
    const club = new URLSearchParams(window.location.search).get("club");
    if (club) setClubIdParam(club);
  }, []);
  const [entryPoints, setEntryPoints] = useState("1");
  const [maxPlayers, setMaxPlayers] = useState("4");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [continent, setContinent] = useState("");
  const [minElo, setMinElo] = useState("");
  const [maxElo, setMaxElo] = useState("");
  const [minPoints, setMinPoints] = useState("");
  const [maxPoints, setMaxPoints] = useState("");
  const [minBet, setMinBet] = useState("");
  const [maxBet, setMaxBet] = useState("");
  const [tournamentAction, setTournamentAction] = useState<TournamentAction | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const playerId = currentUser?.id ?? "";
  const inviteCandidates = useMemo(
    () => users.filter((user) => user.id !== playerId),
    [playerId, users],
  );

  const loadTournaments = useCallback(async () => {
    const response = await fetch("/api/tournaments", { cache: "no-store" });
    const data = await responseJson<{ tournaments: TournamentSummary[] }>(response);
    setTournaments(data.tournaments);
  }, []);

  const loadUsers = useCallback(async () => {
    const [usersResponse, profileResponse] = await Promise.all([
      fetch("/api/user", { cache: "no-store" }),
      fetch("/api/auth/me", { cache: "no-store" }),
    ]);
    const data = await responseJson<{ users: UserOption[] }>(usersResponse);
    setUsers(data.users);
    await loadTournaments();
    if (profileResponse.status === 401) {
      setCurrentUser(null);
      return;
    }
    const profileData = await responseJson<{ user: ProfileUser }>(profileResponse);
    const selectedId = profileData.user.id;
    setCurrentUser(profileData.user);
    setSelectedInviteIds(
      data.users
        .filter((user) => user.id !== selectedId && !user.isAdmin)
        .slice(0, 3)
        .map((user) => user.id),
    );
  }, [loadTournaments]);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        await loadUsers();
      } catch (caughtError: unknown) {
        if (active) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Impossible de charger les profils et les tournois.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, [loadUsers]);

  async function refresh() {
    try {
      await loadUsers();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible d’actualiser les profils et les tournois.",
      );
    }
  }

  async function activatePremium() {
    if (!currentUser) return;
    setBusy("premium");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/premium/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await responseJson(response);
      setNotice("Paiement simulé de 5 000 FCFA accepté : le compte administrateur est Premium.");
      await loadUsers();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Paiement simulé impossible.",
      );
    } finally {
      setBusy("");
    }
  }

  async function createFreeTournament() {
    if (!currentUser) return;
    const requiredPoints = Number(entryPoints);
    const playerCount = Number(maxPlayers);
    if (!Number.isSafeInteger(requiredPoints) || requiredPoints < 1) {
      setError("Le nombre de points requis pour entrer doit être un entier positif.");
      return;
    }
    setBusy("create");
    setError("");
    setNotice("");
    try {
      const createResponse = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tournamentName.trim() || undefined,
          type: tournamentType,
          scope: tournamentScope,
          // Survival en points argent : la mise d'inscription est débitée du
          // portefeuille argent et devient le capital de jeu.
          isPaid: tournamentType === "SURVIVAL_BANK" && entryCurrency === "MONEY",
          entryFeeCfa: tournamentType === "SURVIVAL_BANK" && entryCurrency === "MONEY" ? requiredPoints : 0,
          entryPoints: tournamentType === "SURVIVAL_BANK" && entryCurrency === "MONEY" ? 0 : requiredPoints,
          durationDays: tournamentType === "SURVIVAL_BANK" ? Number(durationDays) : undefined,
          betMode: tournamentType === "SURVIVAL_BANK" ? betMode : undefined,
          durationMinutes: tournamentType === "ARENA" ? Number(arenaMinutes) : undefined,
          maxPlayers: playerCount,
          gameType: "CHECKERS",
          minElo: minElo ? Number(minElo) : undefined,
          maxElo: maxElo ? Number(maxElo) : undefined,
          minPoints: minPoints ? Number(minPoints) : undefined,
          maxPoints: maxPoints ? Number(maxPoints) : undefined,
          minBet: minBet ? Number(minBet) : undefined,
          maxBet: maxBet ? Number(maxBet) : undefined,
          city: city.trim() || undefined,
          region: region.trim() || undefined,
          country: country.trim() || undefined,
          continent: continent.trim() || undefined,
          inviteUserIds: selectedInviteIds,
          visibility: clubIdParam ? "CLUB" : visibility,
          clubId: clubIdParam ?? undefined,
        }),
      });
      await responseJson<{ tournament: { id: string } }>(createResponse);
      setNotice(
        tournamentType === "SURVIVAL_BANK"
          ? `Tournoi créé. ${formatPoints(requiredPoints)} points ont été débités puis placés dans le portefeuille du tournoi.`
          : `Tournoi créé. ${formatPoints(requiredPoints)} points ont été débités pour l’inscription.`,
      );
      setTournamentName("");
      await loadUsers();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible de créer le tournoi et les invitations.",
      );
      try {
        await loadTournaments();
      } catch (refreshError) {
        console.error("Erreur lors de l’actualisation après création :", refreshError);
        setError(
          "La création a échoué et la liste des tournois n’a pas pu être actualisée.",
        );
      }
    } finally {
      setBusy("");
    }
  }

  async function respondToInvitation(
    tournamentId: string,
    invitationId: string,
    decision: "accept" | "decline",
  ) {
    if (!currentUser) return;
    setBusy(invitationId);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/tournaments/${encodeURIComponent(tournamentId)}/invitations/${encodeURIComponent(invitationId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      await responseJson(response);
      setNotice(
        decision === "accept"
          ? "Invitation acceptée. Le droit d’entrée est placé dans le tournoi."
          : "Invitation refusée.",
      );
      setTournamentAction(null);
      await Promise.all([loadUsers(), loadTournaments()]);
    } catch (caughtError) {
      setDialogError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible de répondre à l’invitation.",
      );
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible de répondre à l’invitation.",
      );
    } finally {
      setBusy("");
    }
  }

  async function joinTournament(tournament: TournamentSummary) {
    if (!currentUser) return;
    setBusy(tournament.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/tournaments/${encodeURIComponent(tournament.id)}/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      await responseJson(response);
      setNotice("Inscription confirmée.");
      setTournamentAction(null);
      await Promise.all([loadUsers(), loadTournaments()]);
    } catch (caughtError) {
      setDialogError(
        caughtError instanceof Error
          ? caughtError.message
          : "Inscription impossible.",
      );
      setError(
        caughtError instanceof Error ? caughtError.message : "Inscription impossible.",
      );
    } finally {
      setBusy("");
    }
  }

  function getJoinRestrictions(tournament: TournamentSummary): string[] {
    const restrictions: string[] = [];
    if (!currentUser) restrictions.push("Connectez-vous pour participer.");
    if (tournament.status !== "OPEN") restrictions.push("Les inscriptions ne sont pas ouvertes.");
    if (tournament.isParticipant) restrictions.push("Vous êtes déjà inscrit.");
    if (tournament._count.participants >= tournament.maxPlayers) {
      restrictions.push("Le tournoi a atteint sa capacité maximale.");
    }
    if (currentUser) {
      if (!tournament.isPaid && currentUser.pointsFree < tournament.entryPoints) {
        restrictions.push(
          `Solde insuffisant : ${formatPoints(tournament.entryPoints)} points requis, vous en avez ${formatPoints(currentUser.pointsFree)}.`,
        );
      }
      if (
        tournament.minPoints !== null &&
        currentUser.pointsFree < tournament.minPoints
      ) {
        restrictions.push(
          `Solde minimum requis : ${formatPoints(tournament.minPoints)} points.`,
        );
      }
      if (
        tournament.maxPoints !== null &&
        currentUser.pointsFree > tournament.maxPoints
      ) {
        restrictions.push(
          `Solde maximum autorisé : ${formatPoints(tournament.maxPoints)} points.`,
        );
      }
      if (tournament.minElo !== null && currentUser.elo < tournament.minElo) {
        restrictions.push(`Elo minimum requis : ${tournament.minElo}.`);
      }
      if (tournament.maxElo !== null && currentUser.elo > tournament.maxElo) {
        restrictions.push(`Elo maximum autorisé : ${tournament.maxElo}.`);
      }
    }
    if (tournament.isPaid && currentUser && !currentUser.walletReal) {
      restrictions.push("Un portefeuille de paiement actif est nécessaire.");
    }
    if (
      tournament.isPaid &&
      currentUser &&
      currentUser.walletReal !== undefined &&
      Number(currentUser.walletReal ?? 0) < Number(tournament.entryFee)
    ) {
      restrictions.push(
        `Solde FCFA insuffisant : ${tournament.entryFee} FCFA requis.`,
      );
    }
    return restrictions;
  }

  function openTournamentAction(action: TournamentAction) {
    setDialogError("");
    setTournamentAction(action);
  }

  function confirmTournamentAction() {
    if (!tournamentAction) return;
    if (
      tournamentAction.intent === "accept" &&
      tournamentAction.invitationId
    ) {
      void respondToInvitation(
        tournamentAction.tournament.id,
        tournamentAction.invitationId,
        "accept",
      );
      return;
    }
    void joinTournament(tournamentAction.tournament);
  }

  return (
    <main className="flex-1 px-4 py-6 text-ink sm:px-8 sm:py-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
        

        <section>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-100/70">
            Compétitions
          </p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">
            Tournois de la communauté
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/55">
            Les fonctions de paiement ci-dessous sont des simulations locales :
            elles ne débitent ni ne transfèrent d’argent réel.
          </p>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-7">
          <p className="text-sm font-medium text-white/80">Profil connecté</p>
          {currentUser && (
            <p className="mt-2 text-xs text-white/40">
              {currentUser.username} · {formatPoints(currentUser.pointsFree)} points gratuits
              {currentUser.city ? ` · ${currentUser.city}` : ""}
              {currentUser.isPremium ? " · Premium" : ""}
            </p>
          )}
          {!currentUser && !loading && (
            <p className="mt-2 text-sm text-amber-100/80">
              <Link className="underline" href="/dashboard">
                Connectez-vous pour participer aux tournois.
              </Link>
            </p>
          )}
        </section>

        {currentUser?.isAdmin && !currentUser.isPremium && (
          <section className="rounded-3xl border border-amber-200/20 bg-amber-100/[0.04] p-5 sm:p-7">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
              <div>
                <div className="flex items-center gap-2 text-amber-100">
                  <Crown size={20} />
                  <h2 className="text-lg font-semibold">Activer le compte Premium</h2>
                </div>
                <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">
                  Simulation d’un paiement unique de <strong>5 000 FCFA</strong>.
                  Aucun solde portefeuille ne sera débité ; l’opération sera marquée
                  comme paiement fictif en base.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void activatePremium()}
                disabled={busy !== ""}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-100 px-5 py-3 font-semibold text-accent-ink transition hover:bg-amber-50 disabled:opacity-50"
              >
                {busy === "premium" ? (
                  <LoaderCircle className="animate-spin" size={18} />
                ) : (
                  <CircleDollarSign size={18} />
                )}
                Payer 5 000 FCFA (simulation)
              </button>
            </div>
          </section>
        )}

        {currentUser && (
          <section className="rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.04] p-5 sm:p-7">
            <div className="flex items-center gap-2 text-emerald-100">
              <Crown size={20} />
              <h2 className="text-lg font-semibold">
                Organiser un tournoi en points classiques
                {clubIdParam ? " · tournoi de club" : ""}
              </h2>
            </div>
            <p className="mt-2 text-xs text-white/45">
              Le Survival est ouvert à tous les joueurs disposant du minimum de points fixé par
              l’administration ; les autres formats, les tournois privés et les portées étendues
              dépendent de votre niveau <a href="/premium" className="underline">Premium</a>.
            </p>
            <p className="mt-2 text-sm leading-6 text-white/55">
              {tournamentType === "SURVIVAL_BANK"
                ? "Survival : la mise d’inscription est débitée à l’inscription et devient votre capital de jeu. On ne joue qu’avec ce capital ; dès qu’il passe sous la mise minimale, on est éliminé. Le tournoi s’arrête quand il reste un seul joueur, à la fin de la durée choisie, ou si tous les joueurs encore en jeu votent l’arrêt. Chacun récupère alors le capital qu’il possède."
                : "Le droit d’entrée est débité des points gratuits à l’inscription. Le montant collecté est redistribué aux meilleurs joueurs à la fin du tournoi."}
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-sm text-white/70">
                Nom du tournoi
                <input
                  value={tournamentName}
                  onChange={(event) => setTournamentName(event.target.value)}
                  maxLength={100}
                  placeholder="Ex. Coupe d’Abidjan"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-white/70">
                Format
                <select
                  value={tournamentType}
                  onChange={(event) => {
                    const next = event.target.value;
                    setTournamentType(next);
                    // Les tableaux à élimination exigent une puissance de 2 ; les groupes, 6, 8, 16 ou 32.
                    if ((next === "ELIMINATION" || next === "DOUBLE_ELIMINATION") && ![4, 8, 16, 32, 64].includes(Number(maxPlayers))) {
                      setMaxPlayers("4");
                    }
                    if (next === "GROUPS_ELIMINATION" && ![6, 8, 16, 32].includes(Number(maxPlayers))) {
                      setMaxPlayers("8");
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-white"
                >
                  <option value="SURVIVAL_BANK">Survival Bank</option>
                  <option value="ELIMINATION">Élimination directe</option>
                  <option value="SWISS">Système suisse</option>
                  <option value="ROUND_ROBIN">Toutes rondes</option>
                  <option value="LEAGUE">Ligue aller-retour</option>
                  <option value="GROUPS_ELIMINATION">Groupes + phase finale</option>
                  <option value="DOUBLE_ELIMINATION">Double élimination</option>
                  <option value="ARENA">Arena (durée limitée)</option>
                </select>
              </label>
              <label className="text-sm text-white/70">
                Visibilité
                <select
                  value={clubIdParam ? "CLUB" : visibility}
                  disabled={Boolean(clubIdParam)}
                  onChange={(event) => setVisibility(event.target.value as "PUBLIC" | "PRIVATE")}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-white"
                >
                  <option value="PUBLIC">Public</option>
                  <option value="PRIVATE">Privé (sur invitation)</option>
                  {clubIdParam && <option value="CLUB">Membres du club</option>}
                </select>
              </label>
              <label className="text-sm text-white/70">
                Portée géographique
                <select
                  value={tournamentScope}
                  onChange={(event) => setTournamentScope(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-white"
                >
                  <option value="NEIGHBORHOOD">Quartier</option>
                  <option value="CITY">Ville</option>
                  <option value="REGION">Région</option>
                  <option value="COUNTRY">Pays</option>
                  <option value="CONTINENT">Continent</option>
                  <option value="INTERNATIONAL">International</option>
                </select>
              </label>
              {tournamentType === "SURVIVAL_BANK" && (
                <label className="text-sm text-white/70">
                  Mise d’inscription en
                  <select
                    value={entryCurrency}
                    onChange={(event) => setEntryCurrency(event.target.value as "POINTS" | "MONEY")}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-white"
                  >
                    <option value="POINTS">Points classiques</option>
                    <option value="MONEY">Points argent (FCFA)</option>
                  </select>
                </label>
              )}
              <label className="text-sm text-white/70">
                {tournamentType === "SURVIVAL_BANK"
                  ? `Mise d’inscription = capital de jeu (${entryCurrency === "MONEY" ? "FCFA" : "points"})`
                  : "Points requis pour entrer"}{" "}
                <span className="text-rose-300">*</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={entryPoints}
                  onChange={(event) => setEntryPoints(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-white/70">
                Nombre de joueurs
                <select
                  value={maxPlayers}
                  onChange={(event) => setMaxPlayers(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-white"
                >
                  {(tournamentType === "ELIMINATION" || tournamentType === "DOUBLE_ELIMINATION"
                    ? [4, 8, 16, 32, 64]
                    : tournamentType === "GROUPS_ELIMINATION"
                      ? [6, 8, 16, 32]
                      : tournamentType === "SWISS" || tournamentType === "ARENA" || tournamentType === "SURVIVAL_BANK"
                        ? [4, 5, 6, 7, 8, 10, 12, 16, 20, 24, 32, 48, 64]
                        : [4, 5, 6, 7, 8, 10, 12, 14, 16, 20]
                  ).map((count) => (
                    <option key={count} value={count}>{count}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-white/70">
                Ville
                <input value={city} onChange={(event) => setCity(event.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-white/70">
                Région
                <input value={region} onChange={(event) => setRegion(event.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-white/70">
                Pays
                <input value={country} onChange={(event) => setCountry(event.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-white/70">
                Continent
                <input value={continent} onChange={(event) => setContinent(event.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-white/70">
                Elo minimum (optionnel)
                <input type="number" min={0} step={1} value={minElo} onChange={(event) => setMinElo(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-white/70">
                Elo maximum (optionnel)
                <input type="number" min={0} step={1} value={maxElo} onChange={(event) => setMaxElo(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-white/70">
                Solde minimum de points (optionnel)
                <input type="number" min={0} step={1} value={minPoints} onChange={(event) => setMinPoints(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-white/70">
                Solde maximum de points (optionnel)
                <input type="number" min={0} step={1} value={maxPoints} onChange={(event) => setMaxPoints(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white" />
              </label>
              {tournamentType === "ARENA" && (
                <label className="text-sm text-white/70">
                  Durée de l’Arena (minutes)
                  <input type="number" min={10} max={1440} step={5} value={arenaMinutes} onChange={(event) => setArenaMinutes(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white" />
                </label>
              )}
              {tournamentType === "SURVIVAL_BANK" && (
                <>
                  <label className="text-sm text-white/70">
                    Durée du tournoi (jours)
                    <input type="number" min={1} max={365} step={1} value={durationDays} onChange={(event) => setDurationDays(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white" />
                  </label>
                  <label className="text-sm text-white/70">
                    Mise par partie
                    <select
                      value={betMode}
                      onChange={(event) => setBetMode(event.target.value as "FIXED" | "VARIABLE")}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-white"
                    >
                      <option value="FIXED">Fixe (= mise minimale)</option>
                      <option value="VARIABLE">Variable (jusqu’à la mise maximale)</option>
                    </select>
                  </label>
                  <label className="text-sm text-white/70">
                    Mise minimale par match (optionnel)
                    <input type="number" min={1} step={1} value={minBet} onChange={(event) => setMinBet(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white" />
                  </label>
                  <label className="text-sm text-white/70">
                    Mise maximale par match (optionnel)
                    <input type="number" min={1} step={1} value={maxBet} onChange={(event) => setMaxBet(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white" />
                  </label>
                </>
              )}
            </div>
            <div className="mt-6">
              <p className="mb-2 text-sm text-white/70">Inviter des joueurs (facultatif)</p>
              <p className="mb-2 text-xs text-white/40">
                {selectedInviteIds.length}/{Math.max(0, Number(maxPlayers) - 1)} places d’invitation sélectionnées.
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {inviteCandidates.map((user) => (
                <label
                  key={user.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-black/10 p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedInviteIds.includes(user.id)}
                    disabled={
                      !selectedInviteIds.includes(user.id) &&
                      selectedInviteIds.length >= Number(maxPlayers) - 1
                    }
                    onChange={(event) =>
                      setSelectedInviteIds((current) =>
                        event.target.checked
                          ? [...current, user.id]
                          : current.filter((id) => id !== user.id),
                      )
                    }
                    className="size-4 accent-emerald-300 disabled:opacity-40"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{user.username}</span>
                    <span className="text-xs text-white/40">
                      {formatPoints(user.pointsFree)} pts ·{" "}
                      {user.neighborhood ?? user.city ?? "Localisation non définie"}
                    </span>
                  </span>
                </label>
              ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void createFreeTournament()}
              disabled={
                busy !== "" ||
                selectedInviteIds.length > Number(maxPlayers) - 1
              }
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 py-3 font-semibold text-accent-ink transition hover:bg-emerald-200 disabled:opacity-50"
            >
              {busy === "create" ? (
                <LoaderCircle className="animate-spin" size={18} />
              ) : (
                <Send size={18} />
              )}
              Créer le tournoi
            </button>
          </section>
        )}

        {error && (
          <div className="flex items-start justify-between gap-4 rounded-xl border border-red-300/20 bg-red-300/[0.06] p-4 text-sm text-red-100">
            <p>{error}</p>
            <button type="button" aria-label="Fermer" onClick={() => setError("")}>
              <X size={17} />
            </button>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200/20 bg-emerald-200/[0.06] p-4 text-sm text-emerald-50">
            <Check className="mt-0.5 shrink-0" size={17} />
            <p>{notice}</p>
          </div>
        )}

        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Tournois disponibles</h2>
              <p className="mt-1 text-sm text-white/45">
                Invitations reçues et inscriptions ouvertes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy !== ""}
              className="text-sm text-emerald-100/75 hover:text-emerald-100 disabled:opacity-50"
            >
              Actualiser
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-white/50">
              <LoaderCircle className="animate-spin" size={18} />
              Chargement des tournois…
            </div>
          ) : tournaments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-white/45">
              Aucun tournoi pour le moment. Les tournois créés apparaîtront ici.
            </div>
          ) : (
            <div className="grid gap-4">
              {tournaments.map((tournament) => {
                const invitation = tournament.invitations?.find(
                  (item) => item.userId === currentUser?.id,
                );
                const joined = tournament._count.participants;
                const statusLabel =
                  tournament.status === "OPEN"
                    ? "Inscriptions ouvertes"
                    : tournament.status === "IN_PROGRESS"
                      ? "En cours"
                      : tournament.status === "COMPLETED"
                        ? "Terminé"
                        : tournament.status;
                return (
                  <article
                    key={tournament.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                  >
                    <div className="flex flex-col justify-between gap-4 sm:flex-row">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">
                            <Link href={`/tournois/${tournament.id}`} className="hover:text-accent hover:underline">
                              {tournament.name || `Tournoi de ${tournament.creator.username}`}
                            </Link>
                          </h3>
                          <span className="rounded-full bg-emerald-200/10 px-2.5 py-1 text-xs text-emerald-100">
                            {statusLabel}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/45">
                          <span className="inline-flex items-center gap-1">
                            <Users size={14} />
                            {joined}/{tournament.maxPlayers} joueurs
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Gift size={14} />
                            Entrée : {tournament.entryPoints} point gratuit
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={14} />
                            {{
                              NEIGHBORHOOD: "Quartier",
                              CITY: "Ville",
                              REGION: "Région",
                              COUNTRY: "Pays",
                              CONTINENT: "Continent",
                              INTERNATIONAL: "International",
                            }[tournament.scope] ?? tournament.scope}
                          </span>
                          {(tournament.city ||
                            tournament.region ||
                            tournament.country ||
                            tournament.continent) && (
                            <span>
                              {[tournament.city, tournament.region, tournament.country, tournament.continent]
                                .filter(Boolean)
                                .join(", ")}
                            </span>
                          )}
                        </div>
                      </div>

                      {invitation?.status === "PENDING" ? (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => openTournamentAction({
                              tournament,
                              intent: "accept",
                              invitationId: invitation.id,
                            })}
                            disabled={busy !== ""}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-300 px-3 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
                          >
                            {busy === invitation.id ? (
                              <LoaderCircle className="animate-spin" size={15} />
                            ) : (
                              <Check size={15} />
                            )}
                            Accepter
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void respondToInvitation(
                                tournament.id,
                                invitation.id,
                                "decline",
                              )
                            }
                            disabled={busy !== ""}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/70 disabled:opacity-50"
                          >
                            <X size={15} />
                            Refuser
                          </button>
                        </div>
                      ) : (
                        tournament.status === "OPEN" &&
                        !tournament.isParticipant &&
                        (!invitation || invitation.status === "DECLINED") &&
                        <button
                          type="button"
                          onClick={() => openTournamentAction({ tournament, intent: "join" })}
                          disabled={busy !== ""}
                          className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-emerald-200/20 px-3 py-2 text-sm text-emerald-100 disabled:opacity-50"
                        >
                          {busy === tournament.id && (
                            <LoaderCircle className="animate-spin" size={15} />
                          )}
                          S’inscrire
                        </button>
                      )}
                      {tournament.isParticipant && (
                        <span className="shrink-0 rounded-lg bg-emerald-200/10 px-3 py-2 text-sm text-emerald-100">
                          Inscrit
                        </span>
                      )}
                    </div>
                    {invitation && invitation.status !== "PENDING" && (
                      <p className="mt-3 text-xs text-white/40">
                        Invitation {invitation.status === "ACCEPTED" ? "acceptée" : "refusée"}.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <p className="text-xs leading-5 text-white/30">
          Démonstration locale sans authentification : les identifiants de profil
          servent uniquement à tester l’interface et ne conviennent pas à la production.
        </p>
      </div>
      {tournamentAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && busy === "") {
              setTournamentAction(null);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="tournament-eligibility-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-surface-2 p-6 shadow-2xl"
          >
            <h2 id="tournament-eligibility-title" className="text-xl font-semibold">
              Conditions de participation
            </h2>
            <p className="mt-2 text-sm text-white/60">
              {tournamentAction.tournament.name}
            </p>
            <div className="mt-5 space-y-3 text-sm">
              <p>Format : {tournamentAction.tournament.type}</p>
              <p>
                Portée : {tournamentAction.tournament.scope}
                {[tournamentAction.tournament.city, tournamentAction.tournament.region, tournamentAction.tournament.country, tournamentAction.tournament.continent]
                  .filter(Boolean)
                  .length > 0 && ` · ${[
                    tournamentAction.tournament.city,
                    tournamentAction.tournament.region,
                    tournamentAction.tournament.country,
                    tournamentAction.tournament.continent,
                  ].filter(Boolean).join(", ")}`
                }
              </p>
              <p>Jeu : {tournamentAction.tournament.gameType}</p>
              <p>Statut : {tournamentAction.tournament.status === "OPEN" ? "Inscriptions ouvertes" : tournamentAction.tournament.status}</p>
              <p>
                Places : {tournamentAction.tournament._count.participants}/
                {tournamentAction.tournament.maxPlayers}
              </p>
              <p>
                Droit d’entrée : {tournamentAction.tournament.isPaid
                  ? `${tournamentAction.tournament.entryFee} FCFA`
                  : `${formatPoints(tournamentAction.tournament.entryPoints)} points gratuits`}
              </p>
              {tournamentAction.tournament.minPoints !== null && (
                <p>Solde minimum : {formatPoints(tournamentAction.tournament.minPoints)} points</p>
              )}
              {tournamentAction.tournament.maxPoints !== null && (
                <p>Solde maximum : {formatPoints(tournamentAction.tournament.maxPoints)} points</p>
              )}
              {tournamentAction.tournament.minElo !== null && (
                <p>Elo minimum : {tournamentAction.tournament.minElo}</p>
              )}
              {tournamentAction.tournament.maxElo !== null && (
                <p>Elo maximum : {tournamentAction.tournament.maxElo}</p>
              )}
              {tournamentAction.tournament.minBet !== null && (
                <p>Mise minimale par match : {formatPoints(tournamentAction.tournament.minBet)} points</p>
              )}
              {tournamentAction.tournament.maxBet !== null && (
                <p>Mise maximale par match : {formatPoints(tournamentAction.tournament.maxBet)} points</p>
              )}
              {currentUser && (
                <p>
                  Votre profil : {formatPoints(currentUser.pointsFree)} points gratuits · Elo {currentUser.elo}
                  {currentUser.walletReal !== undefined && ` · ${currentUser.walletReal} FCFA`}
                </p>
              )}
              <div className={getJoinRestrictions(tournamentAction.tournament).length ? "rounded-lg bg-rose-300/10 p-3 text-rose-100" : "rounded-lg bg-emerald-300/10 p-3 text-emerald-100"}>
                <p className="font-semibold">
                  {getJoinRestrictions(tournamentAction.tournament).length
                    ? "Inscription impossible"
                    : "Vous remplissez les conditions affichées."}
                </p>
                {getJoinRestrictions(tournamentAction.tournament).length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {getJoinRestrictions(tournamentAction.tournament).map((restriction) => (
                      <li key={restriction}>{restriction}</li>
                    ))}
                  </ul>
                )}
              </div>
              {dialogError && (
                <p role="alert" className="text-sm text-rose-200">{dialogError}</p>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setTournamentAction(null)}
                disabled={busy !== ""}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmTournamentAction}
                disabled={busy !== "" || getJoinRestrictions(tournamentAction.tournament).length > 0}
                className="rounded-lg bg-emerald-300 px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
              >
                {busy ? "Traitement…" : tournamentAction.intent === "accept" ? "Accepter l’invitation" : "Confirmer l’inscription"}
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="mx-auto mt-8 w-full max-w-5xl">
        <AdSlot placement="tournaments" />
      </div>
    </main>
  );
}
