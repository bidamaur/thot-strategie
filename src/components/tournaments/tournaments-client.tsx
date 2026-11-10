"use client";

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

interface TournamentSummary {
  id: string;
  creatorId: string;
  creator: { id: string; username: string };
  scope: string;
  isPaid: boolean;
  entryFee: string;
  entryPoints: number;
  totalPrizePool: string;
  maxPlayers: number;
  status: string;
  _count: { participants: number };
  invitations: Array<{
    id: string;
    userId: string;
    status: "PENDING" | "ACCEPTED" | "DECLINED";
  }>;
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
  const [playerId, setPlayerId] = useState("");
  const [selectedInviteIds, setSelectedInviteIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const currentUser = users.find((user) => user.id === playerId);
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
    if (profileResponse.status === 401) {
      setPlayerId("");
      setTournaments([]);
      return;
    }
    const profileData = await responseJson<{ user: { id: string } }>(
      profileResponse,
    );
    const selectedId = profileData.user.id;
    setPlayerId(selectedId);
    setSelectedInviteIds(
      data.users
        .filter((user) => user.id !== selectedId && !user.isAdmin)
        .slice(0, 3)
        .map((user) => user.id),
    );
    await loadTournaments();
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
    if (selectedInviteIds.length !== 3) {
      setError("Sélectionnez les trois joueurs à inviter pour le tournoi de démonstration.");
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
          scope: "CITY",
          isPaid: false,
          entryFeeCfa: 0,
          entryPoints: 1,
          maxPlayers: 4,
          inviteUserIds: selectedInviteIds,
        }),
      });
      await responseJson<{ tournament: { id: string } }>(createResponse);
      setNotice(
        "Tournoi gratuit créé. Vous êtes inscrit et les trois joueurs ont reçu une invitation à accepter.",
      );
      await loadTournaments();
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
          ? "Invitation acceptée. Un point gratuit a été placé en séquestre."
          : "Invitation refusée.",
      );
      await Promise.all([loadUsers(), loadTournaments()]);
    } catch (caughtError) {
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
      await Promise.all([loadUsers(), loadTournaments()]);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Inscription impossible.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="min-h-screen bg-[#080d0b] px-5 py-8 text-[#f3f5ef] sm:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-white/60 transition hover:text-white"
          >
            <ArrowLeft size={17} />
            Tableau de bord
          </Link>
          <span className="flex items-center gap-2 text-sm font-semibold tracking-wide text-amber-100">
            <Trophy size={18} />
            TOURNOIS
          </span>
        </header>

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
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-100 px-5 py-3 font-semibold text-[#1b1608] transition hover:bg-amber-50 disabled:opacity-50"
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

        {currentUser?.isAdmin && currentUser.isPremium && (
          <section className="rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.04] p-5 sm:p-7">
            <div className="flex items-center gap-2 text-emerald-100">
              <Crown size={20} />
              <h2 className="text-lg font-semibold">Créer un tournoi gratuit</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-white/55">
              Tournoi de quatre joueurs : vous êtes inscrit comme organisateur et
              les trois autres profils reçoivent une invitation. Chaque joueur
              place 1 point gratuit en séquestre ; aucune cagnotte en FCFA.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              {inviteCandidates.map((user) => (
                <label
                  key={user.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-black/10 p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedInviteIds.includes(user.id)}
                    onChange={(event) =>
                      setSelectedInviteIds((current) =>
                        event.target.checked
                          ? [...current, user.id]
                          : current.filter((id) => id !== user.id),
                      )
                    }
                    className="size-4 accent-emerald-300"
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
            <button
              type="button"
              onClick={() => void createFreeTournament()}
              disabled={busy !== "" || inviteCandidates.length < 3}
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 py-3 font-semibold text-[#07100c] transition hover:bg-emerald-200 disabled:opacity-50"
            >
              {busy === "create" ? (
                <LoaderCircle className="animate-spin" size={18} />
              ) : (
                <Send size={18} />
              )}
              Créer et inviter les 3 joueurs
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
              Aucun tournoi. Le profil administrateur doit activer Premium pour en créer un.
            </div>
          ) : (
            <div className="grid gap-4">
              {tournaments.map((tournament) => {
                const invitation = tournament.invitations.find(
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
                            Tournoi de {tournament.creator.username}
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
                            {tournament.scope === "CITY" ? "Ville" : tournament.scope}
                          </span>
                        </div>
                      </div>

                      {invitation?.status === "PENDING" ? (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void respondToInvitation(
                                tournament.id,
                                invitation.id,
                                "accept",
                              )
                            }
                            disabled={busy !== ""}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-300 px-3 py-2 text-sm font-semibold text-[#07100c] disabled:opacity-50"
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
                        currentUser &&
                        tournament.creatorId !== currentUser.id &&
                        !invitation &&
                        <button
                          type="button"
                          onClick={() => void joinTournament(tournament)}
                          disabled={busy !== ""}
                          className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-emerald-200/20 px-3 py-2 text-sm text-emerald-100 disabled:opacity-50"
                        >
                          {busy === tournament.id && (
                            <LoaderCircle className="animate-spin" size={15} />
                          )}
                          S’inscrire
                        </button>
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
    </main>
  );
}
