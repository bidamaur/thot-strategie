"use client";

import {
  ArrowDownRight,
  ArrowRight,
  Bot,
  Crown,
  Gamepad2,
  LoaderCircle,
  RefreshCw,
  Swords,
  Trophy,
  UserRound,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  DRAUGHTS_VARIANTS,
  type DraughtsVariant,
} from "@/lib/engine/game-settings";
import { getMedalEmoji, getMedalLabel } from "@/lib/medals";

interface UserProfile {
  id: string;
  username: string;
  isAdmin: boolean;
  isPremium: boolean;
  pointsFree: number;
  walletReal: string;
  elo: number;
  draughtsVariant: DraughtsVariant;
  country: string | null;
  city: string | null;
  neighborhood: string | null;
  avatar: string | null;
}

function formatPoints(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCfa(value: string): string {
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value))} FCFA`;
}

export function DashboardClient() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [selectedEmoji, setSelectedEmoji] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [savingPreference, setSavingPreference] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const data = (await response.json()) as {
          user?: UserProfile;
          error?: string;
        };

        if (response.status === 401) {
          if (active) setLoading(false);
          return;
        }
        if (!response.ok || !data.user) {
          throw new Error(data.error ?? "Impossible de charger votre profil.");
        }
        if (!active) return;

        setProfile(data.user);
        setUsername(data.user.username);
        setCountry(data.user.country ?? "");
        setCity(data.user.city ?? "");
        setNeighborhood(data.user.neighborhood ?? "");
        setAvatar(data.user.avatar ?? null);
      } catch (caughtError) {
        if (active) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Une erreur inattendue est survenue.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadDashboard();
    return () => {
      active = false;
    };
  }, []);

  async function handleContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch(
        authMode === "register" ? "/api/auth/register" : "/api/auth/login",
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        },
      );
      const data = (await response.json()) as {
        user?: UserProfile;
        error?: string;
      };

      if (!response.ok || !data.user) {
        throw new Error(data.error ?? "Impossible de vous connecter.");
      }

      window.localStorage.setItem(
        "thot-strategie-draughts-variant",
        data.user.draughtsVariant,
      );
      setProfile(data.user);
      setCountry(data.user.country ?? "");
      setCity(data.user.city ?? "");
      setNeighborhood(data.user.neighborhood ?? "");
      setPassword("");
      window.dispatchEvent(new Event("thot:auth-changed"));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Une erreur inattendue est survenue.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisconnect() {
    setError("");
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Impossible de fermer la session.");
      return;
    }
    setProfile(null);
    window.dispatchEvent(new Event("thot:auth-changed"));
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setError("");
    setSavingProfile(true);
    try {
      const response = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          country,
          city,
          neighborhood,
        }),
      });
      const data = (await response.json()) as {
        user?: UserProfile;
        error?: string;
      };
      if (!response.ok || !data.user) {
        throw new Error(data.error ?? "Impossible de sauvegarder le profil.");
      }
      setProfile(data.user);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible de sauvegarder le profil.",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSaveAvatar() {
    if (!profile) return;
    setError("");
    setSavingProfile(true);
    try {
      const response = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar }),
      });
      const data = (await response.json()) as {
        user?: UserProfile;
        error?: string;
      };
      if (!response.ok || !data.user) {
        throw new Error(data.error ?? "Impossible de sauvegarder l'avatar.");
      }
      setProfile(data.user);
      setAvatar(data.user.avatar ?? null);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible de sauvegarder l'avatar.",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleUploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const response = await fetch("/api/user/avatar", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as {
        user?: { avatar: string | null };
        avatarUrl?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Impossible d'uploader l'avatar.");
      }
      setAvatar(data.avatarUrl ?? data.user?.avatar ?? null);
      if (data.user) {
        const userAvatar = data.user.avatar;
        setProfile((current) =>
          current ? { ...current, avatar: userAvatar } : current,
        );
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible d'uploader l'avatar.",
      );
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleDraughtsVariantChange(variant: DraughtsVariant) {
    if (!profile) return;
    const previousVariant = profile.draughtsVariant;
    setError("");
    setSavingPreference(true);

    try {
      const response = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draughtsVariant: variant }),
      });
      const data = (await response.json()) as {
        user?: UserProfile;
        error?: string;
      };
      if (!response.ok || !data.user) {
        throw new Error(data.error ?? "Impossible d’enregistrer la préférence.");
      }

      setProfile(data.user);
    } catch (caughtError) {
      setProfile((current) =>
        current ? { ...current, draughtsVariant: previousVariant } : current,
      );
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible d’enregistrer la préférence.",
      );
    } finally {
      setSavingPreference(false);
    }
  }

  return (
    <main className="relative flex-1 overflow-hidden text-ink">
      <div className="pointer-events-none absolute -left-40 top-[-18rem] h-[38rem] w-[38rem] rounded-full bg-emerald-500/10 blur-[130px]" />
      <div className="pointer-events-none absolute -right-40 top-80 h-[30rem] w-[30rem] rounded-full bg-amber-400/5 blur-[120px]" />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col px-4 pb-12 sm:px-8">
        

        <section className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:py-16">
          <div className="max-w-2xl">
            <p className="mb-5 flex items-center gap-2 text-xs font-semibold tracking-[0.25em] text-emerald-300">
              <span className="h-px w-8 bg-emerald-300/70" />
              DAMES · ÉCHECS · STRATÉGIE
            </p>
            <h1 className="text-5xl font-semibold leading-[1.06] tracking-tight sm:text-6xl">
              Chaque coup
              <br />
              <span className="font-serif font-normal italic text-emerald-200">
                compte.
              </span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-white/55">
              Retrouvez votre espace de jeu, suivez votre classement et
              préparez votre prochaine partie.
            </p>

            {loading ? (
              <div className="mt-10 flex items-center gap-3 text-sm text-white/55">
                <LoaderCircle className="animate-spin" size={18} />
                Chargement de votre espace...
              </div>
            ) : profile ? (
              <section className="mt-10 max-w-xl rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-8">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-300/10 text-emerald-200">
                      {avatar ? (
                        avatar.startsWith("http") || avatar.startsWith("/")
                          ? (
                            <img
                              src={avatar}
                              alt="Avatar"
                              className="size-full rounded-full object-cover"
                            />
                          )
                          : (
                            <span className="text-2xl">{avatar}</span>
                          )
                      ) : (
                        <UserRound size={25} />
                      )}
                    </span>
                    <div>
                      <p className="text-xs tracking-[0.2em] text-white/40">
                        VOTRE PROFIL
                      </p>
                      <h2 className="mt-1 text-2xl font-semibold flex items-center gap-2">
                        {profile.username}
                        {getMedalEmoji(profile.pointsFree)}
                      </h2>
                      <p className="mt-0.5 text-xs text-white/50">
                        {getMedalLabel(profile.pointsFree) || "Aucun rang"}
                      </p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1.5 rounded-full border border-amber-200/15 bg-amber-200/[0.07] px-3 py-1.5 text-xs text-amber-100/80">
                    <Crown size={13} />
                    {profile.elo} ELO
                  </span>
                </div>

                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
                    <div className="flex items-center gap-2 text-xs text-white/45">
                      <span className="text-emerald-300">
                        {getMedalEmoji(profile.pointsFree)}
                      </span>
                      Points classiques
                    </div>
                    <p className="mt-3 text-2xl font-semibold tabular-nums">
                      {formatPoints(profile.pointsFree)}
                    </p>
                    <p className="mt-1 text-xs text-white/35">
                      {getMedalLabel(profile.pointsFree) || "Aucun rang"} ·
                      Sans valeur monétaire
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
                    <div className="flex items-center gap-2 text-xs text-white/45">
                      <Wallet size={15} className="text-amber-200" />
                      Points argent
                    </div>
                    <p className="mt-3 text-2xl font-semibold tabular-nums">
                      {formatCfa(profile.walletReal)}
                    </p>
                    <p className="mt-1 text-xs text-white/35">
                      Utilisés uniquement si vous choisissez une partie rémunérée ·{" "}
                      <Link href="/portefeuille" className="underline hover:text-white/60">détails</Link>
                    </p>
                  </div>
                </div>

                <form
                  onSubmit={handleSaveProfile}
                  className="mt-6 grid gap-3 border-t border-white/[0.08] pt-5 sm:grid-cols-2"
                >
                  <label className="text-xs font-medium text-white/55 sm:col-span-2">
                    Pseudo
                    <input
                      required
                      minLength={3}
                      maxLength={24}
                      pattern="[A-Za-z0-9_]{3,24}"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-sm text-white outline-none focus:border-emerald-300/60"
                    />
                  </label>
                  {([
                    ["country", "Pays", country, setCountry],
                    ["city", "Ville", city, setCity],
                    ["neighborhood", "Quartier", neighborhood, setNeighborhood],
                  ] as const).map(([id, label, value, setValue]) => (
                    <label key={id} htmlFor={`profile-${id}`} className="text-xs font-medium text-white/55">
                      {label}
                      <input
                        id={`profile-${id}`}
                        maxLength={80}
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-sm text-white outline-none focus:border-emerald-300/60"
                      />
                    </label>
                  ))}
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200/20 px-4 py-3 text-sm font-medium text-emerald-100 transition hover:bg-emerald-200/[0.06] disabled:opacity-50 sm:col-span-2"
                  >
                    {savingProfile && <LoaderCircle className="animate-spin" size={16} />}
                    {savingProfile ? "Enregistrement…" : "Enregistrer mon profil"}
                  </button>
                </form>

                <div className="mt-5 border border-white/[0.08] rounded-2xl p-4 bg-white/[0.02]">
                  <h3 className="mb-3 text-xs font-medium text-white/70 uppercase tracking-wider">
                    Avatar
                  </h3>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-white/55">
                        Emoji
                      </label>
                      <div className="flex gap-1 flex-wrap">
                        {["😀", "😎", "🤖", "👑", "🔥", "💎", "🎯", "🐎", "⚔️", "🛡️"].map(
                          (emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => {
                                setAvatar(emoji);
                                setSelectedEmoji(emoji);
                              }}
                              className={`text-xs p-1 rounded-full transition ${
                                selectedEmoji === emoji
                                  ? "ring-2 ring-emerald-400 bg-white/10"
                                  : "hover:bg-white/5"
                              }`}
                            >
                              {emoji}
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 w-full">
                      <label className="text-xs font-medium text-white/55">
                        Image
                      </label>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={handleUploadAvatar}
                        disabled={uploadingAvatar}
                        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-sm text-white/60 outline-none focus:border-emerald-300/60 disabled:opacity-50"
                      />
                      {avatar && !avatar.startsWith("http") && !avatar.startsWith("/") && selectedEmoji === avatar ? null : null}
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveAvatar}
                      disabled={savingProfile || !avatar}
                      className="rounded-xl border border-emerald-200/20 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-200/[0.06] disabled:opacity-50"
                    >
                      {savingProfile ? (
                        <LoaderCircle className="animate-spin" size={14} />
                      ) : (
                        "Enregistrer l'avatar"
                      )}
                    </button>
                  </div>
                  {uploadingAvatar && (
                    <p className="mt-2 text-xs text-white/50">
                      Upload de l&apos;image en cours…
                    </p>
                  )}
                  {avatar && avatar.startsWith("/") && (
                    <img
                      src={avatar}
                      alt="Avatar"
                      className="mt-3 rounded-xl w-24 h-24 object-cover border border-white/10"
                    />
                  )}
                </div>
                  <div className="mt-5">
                    <label
                      htmlFor="profile-draughts-variant"
                      className="mb-2 block text-xs font-medium text-white/55"
                    >
                      Variante de dames préférée pour jouer contre l&apos;IA
                    </label>
                  <select
                    id="profile-draughts-variant"
                    value={profile.draughtsVariant}
                    disabled={savingPreference}
                    onChange={(event) =>
                      void handleDraughtsVariantChange(
                        event.target.value as DraughtsVariant,
                      )
                    }
                    className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-sm text-white/80 outline-none focus:border-emerald-300/60 disabled:opacity-60"
                  >
                    {DRAUGHTS_VARIANTS.map((variant) => (
                      <option key={variant.value} value={variant.value}>
                        {variant.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-white/35">
                    {savingPreference
                      ? "Enregistrement..."
                      : "Cette préférence est sauvegardée sur votre profil."}
                  </p>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-white/[0.08] pt-5">
                  <span className="text-sm text-white/45">
                    Prêt pour votre prochaine partie ?
                  </span>
                  <span className="flex size-9 items-center justify-center rounded-full bg-emerald-300 text-accent-ink">
                    <ArrowRight size={17} />
                  </span>
                </div>
              </section>
            ) : (
              <form
                onSubmit={handleContinue}
                className="mt-10 max-w-xl rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-8"
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <UserRound size={17} className="text-emerald-200" />
                  {authMode === "login"
                    ? "Se connecter"
                    : "Créer un nouveau profil"}
                </div>
                <p className="mt-2 text-sm leading-6 text-white/45">
                  {authMode === "login"
                    ? "Connectez-vous avec votre pseudo et votre mot de passe."
                    : "Choisissez un pseudo unique et un mot de passe d’au moins 8 caractères."}
                </p>
                <label
                  htmlFor="username"
                  className="mb-2 mt-6 block text-xs font-medium text-white/55"
                >
                  Pseudo
                </label>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    id="username"
                    name="username"
                    autoComplete="username"
                    required
                    minLength={3}
                    maxLength={24}
                    pattern="[A-Za-z0-9_]{3,24}"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Ex. joueur_01"
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none transition placeholder:text-white/25 focus:border-emerald-300/60 focus:ring-2 focus:ring-emerald-300/10"
                  />
                </div>
                <label
                  htmlFor="password"
                  className="mb-2 mt-5 block text-xs font-medium text-white/55"
                >
                  Mot de passe
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={authMode === "login" ? "current-password" : "new-password"}
                  required
                  minLength={authMode === "register" ? 8 : undefined}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none transition focus:border-emerald-300/60 focus:ring-2 focus:ring-emerald-300/10"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-accent-ink transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <LoaderCircle className="animate-spin" size={17} />
                  ) : (
                    <ArrowRight size={17} />
                  )}
                  {authMode === "login" ? "Se connecter" : "Créer mon profil"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAuthMode((current) =>
                      current === "login" ? "register" : "login",
                    )
                  }
                  className="mt-4 w-full text-center text-sm text-emerald-100/70 hover:text-emerald-100"
                >
                  {authMode === "login"
                    ? "Pas encore de compte ? Créer un profil"
                    : "Déjà un compte ? Se connecter"}
                </button>
              </form>
            )}

            {error && (
              <p
                role="alert"
                className="mt-4 max-w-xl rounded-xl border border-red-300/20 bg-red-950/30 px-4 py-3 text-sm text-red-200"
              >
                {error}
              </p>
            )}

            {!profile && (
              <p className="mt-5 max-w-xl text-xs leading-5 text-white/35">
                Les mots de passe sont stockés sous forme hachée et la session est
                protégée par un cookie HttpOnly.
              </p>
            )}
          </div>

          <div className="lg:pl-8">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-[0.2em] text-white/40">
                  À VOUS DE JOUER
                </p>
                <h2 className="mt-1 text-xl font-semibold">Choisir un mode</h2>
              </div>
              <Gamepad2 className="text-emerald-200/70" size={22} />
            </div>

            <nav aria-label="Modes de jeu" className="grid gap-3">
              <Link
                href="/match/ia"
                className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-emerald-200/30 hover:bg-emerald-200/[0.06]"
              >
                <span className="flex items-center gap-4">
                  <span className="flex size-12 items-center justify-center rounded-xl bg-emerald-300/10 text-emerald-200">
                    <Bot size={23} />
                  </span>
                  <span>
                    <span className="block font-semibold">Jouer contre l&apos;IA</span>
                    <span className="mt-1 block text-sm text-white/40">
                      Entraînez-vous à votre rythme
                    </span>
                  </span>
                </span>
                <ArrowRight
                  className="text-white/35 transition group-hover:translate-x-1 group-hover:text-emerald-200"
                  size={19}
                />
              </Link>

              <Link
                href="/match/en-ligne"
                className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-emerald-200/30 hover:bg-emerald-200/[0.06]"
              >
                <span className="flex items-center gap-4">
                  <span className="flex size-12 items-center justify-center rounded-xl bg-sky-300/10 text-sky-200">
                    <RefreshCw size={21} />
                  </span>
                  <span>
                    <span className="block font-semibold">Match en ligne</span>
                    <span className="mt-1 block text-sm text-white/40">
                      Trouvez un adversaire
                    </span>
                  </span>
                </span>
                <ArrowRight
                  className="text-white/35 transition group-hover:translate-x-1 group-hover:text-emerald-200"
                  size={19}
                />
              </Link>

              <Link
                href="/tournois"
                className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-amber-200/30 hover:bg-amber-200/[0.05]"
              >
                <span className="flex items-center gap-4">
                  <span className="flex size-12 items-center justify-center rounded-xl bg-amber-200/10 text-amber-100">
                    <Trophy size={22} />
                  </span>
                  <span>
                    <span className="block font-semibold">Voir les tournois</span>
                    <span className="mt-1 block text-sm text-white/40">
                      Consultez les compétitions
                    </span>
                  </span>
                </span>
                <ArrowRight
                  className="text-white/35 transition group-hover:translate-x-1 group-hover:text-amber-100"
                  size={19}
                />
              </Link>
            </nav>

            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
              <ArrowDownRight
                size={17}
                className="mt-0.5 shrink-0 text-white/35"
              />
              <p className="text-xs leading-5 text-white/40">
                Le matchmaking en ligne et les compétitions locales sont
                accessibles depuis ces raccourcis.
              </p>
            </div>
          </div>
        </section>

        <footer className="flex flex-col justify-between gap-2 border-t border-white/[0.08] pt-5 text-xs text-white/30 sm:flex-row">
          <span>THOT STRATÉGIE · Jeux de dames et d&apos;échecs</span>
          <span>Environnement de développement local</span>
        </footer>
      </div>
    </main>
  );
}
