"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Crown,
  LoaderCircle,
  Swords,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  DIFFICULTIES,
  DRAUGHTS_VARIANTS,
  type Difficulty,
  type DraughtsVariant,
} from "@/lib/engine/game-settings";

const VARIANT_STORAGE_KEY = "thot-strategie-draughts-variant";

export function AiGameSetup() {
  const [difficulty, setDifficulty] = useState<Difficulty>("moyen");
  const [variant, setVariant] = useState<DraughtsVariant>("INTERNATIONAL");
  const [savingPreference, setSavingPreference] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");

  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          const savedVariant = window.localStorage.getItem(VARIANT_STORAGE_KEY);
          if (savedVariant === "ENGLISH" || savedVariant === "INTERNATIONAL") {
            setVariant(savedVariant);
          }
          return;
        }
        if (!response.ok) {
          throw new Error("Impossible de charger votre préférence de jeu.");
        }
        const data = (await response.json()) as {
          user?: { draughtsVariant?: DraughtsVariant };
        };
        if (data.user?.draughtsVariant) {
          setVariant(data.user.draughtsVariant);
          window.localStorage.setItem(
            VARIANT_STORAGE_KEY,
            data.user.draughtsVariant,
          );
        }
      })
      .catch((error: unknown) => {
        console.error("Chargement de la préférence de jeu impossible :", error);
      });
  }, []);

  async function changeVariant(nextVariant: DraughtsVariant) {
    const previousVariant = variant;
    setVariant(nextVariant);
    setPreferenceMessage("");

    setSavingPreference(true);
    try {
      const response = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draughtsVariant: nextVariant }),
      });
      const data = (await response.json()) as {
        error?: string;
        user?: { draughtsVariant: DraughtsVariant };
      };
      if (!response.ok || !data.user) {
        if (response.status === 401) {
          window.localStorage.setItem(VARIANT_STORAGE_KEY, nextVariant);
          setPreferenceMessage("Connectez-vous pour enregistrer ce choix sur votre profil.");
          return;
        }
        throw new Error(data.error ?? "Impossible d’enregistrer la variante.");
      }

      window.localStorage.setItem(VARIANT_STORAGE_KEY, nextVariant);
      setPreferenceMessage("Préférence enregistrée sur votre profil.");
    } catch (error) {
      setVariant(previousVariant);
      setPreferenceMessage(
        error instanceof Error ? error.message : "Erreur d’enregistrement.",
      );
    } finally {
      setSavingPreference(false);
    }
  }

  const chessHref = `/match/ia/echecs?difficulty=${difficulty}`;
  const draughtsHref =
    `/match/ia/dames?variant=${variant}&difficulty=${difficulty}`;

  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas text-ink">
      <div className="pointer-events-none absolute -left-40 top-[-18rem] h-[38rem] w-[38rem] rounded-full bg-emerald-500/10 blur-[130px]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 pb-10 sm:px-8">
        <header className="flex items-center justify-between border-b border-white/10 py-5">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 text-emerald-200">
              <Swords size={21} />
            </span>
            <span className="text-sm font-bold tracking-[0.18em]">
              THOT <span className="text-emerald-300">STRATÉGIE</span>
            </span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/65 transition hover:text-white"
          >
            <ArrowLeft size={16} />
            Dashboard
          </Link>
        </header>

        <section className="mx-auto w-full max-w-4xl flex-1 py-12">
          <p className="mb-3 text-xs font-semibold tracking-[0.22em] text-emerald-300">
            PARTIE CONTRE LA MACHINE
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Choisissez votre <span className="font-serif italic text-emerald-200">défi.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-white/50">
            Les moteurs calculent leurs coups dans un thread séparé pour que le
            plateau reste fluide, même aux niveaux les plus élevés.
          </p>

          <div className="mt-9 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-7">
            <fieldset>
              <legend className="mb-3 text-xs font-semibold tracking-[0.18em] text-white/40">
                DIFFICULTÉ
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DIFFICULTIES.map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    aria-pressed={difficulty === level.value}
                    onClick={() => setDifficulty(level.value)}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      difficulty === level.value
                        ? "border-emerald-200/50 bg-emerald-200/10 text-emerald-100"
                        : "border-white/10 bg-black/10 text-white/70 hover:border-white/25"
                    }`}
                  >
                    <span className="block text-sm font-semibold">
                      {level.label}
                    </span>
                    <span className="mt-1 block text-[11px] text-white/40">
                      {level.description}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-7 border-t border-white/[0.08] pt-6">
              <legend className="mb-3 text-xs font-semibold tracking-[0.18em] text-white/40">
                VARIANTE DE DAMES
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {DRAUGHTS_VARIANTS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={variant === option.value}
                    disabled={savingPreference}
                    onClick={() => void changeVariant(option.value)}
                    className={`rounded-xl border px-4 py-3 text-left transition disabled:cursor-wait disabled:opacity-60 ${
                      variant === option.value
                        ? "border-emerald-200/50 bg-emerald-200/10 text-emerald-100"
                        : "border-white/10 bg-black/10 text-white/70 hover:border-white/25"
                    }`}
                  >
                    <span className="block text-sm font-semibold">
                      {option.label}
                    </span>
                    <span className="mt-1 block text-xs text-white/40">
                      {option.value === "ENGLISH"
                        ? "Prise obligatoire · dames à déplacement court"
                        : "Prise majoritaire · dames volantes"}
                    </span>
                  </button>
                ))}
              </div>
              <p aria-live="polite" className="mt-2 min-h-4 text-xs text-white/40">
                {savingPreference ? (
                  <span className="inline-flex items-center gap-1.5">
                    <LoaderCircle className="animate-spin" size={13} />
                    Enregistrement...
                  </span>
                ) : (
                  preferenceMessage ||
                  "Ce choix devient aussi votre préférence de profil."
                )}
              </p>
            </fieldset>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Link
              href={chessHref}
              className="group rounded-3xl border border-white/10 bg-white/[0.04] p-6 transition hover:border-emerald-200/35 hover:bg-emerald-200/[0.06]"
            >
              <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-300/10 text-3xl text-emerald-100">
                ♞
              </span>
              <h2 className="mt-5 text-xl font-semibold">Échecs</h2>
              <p className="mt-2 text-sm leading-6 text-white/45">
                Échiquier 8×8, coups légaux, échec et mat, pat et promotions.
              </p>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-emerald-200">
                Commencer la partie <ArrowRight size={16} />
              </span>
            </Link>

            <Link
              href={draughtsHref}
              className="group rounded-3xl border border-white/10 bg-white/[0.04] p-6 transition hover:border-amber-200/30 hover:bg-amber-200/[0.05]"
            >
              <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-200/10 text-2xl text-amber-100">
                <Crown size={24} />
              </span>
              <h2 className="mt-5 text-xl font-semibold">Dames</h2>
              <p className="mt-2 text-sm leading-6 text-white/45">
                {DRAUGHTS_VARIANTS.find((item) => item.value === variant)?.label}
                {" · "}
                règles de prise adaptées à la variante choisie.
              </p>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-amber-100">
                Commencer la partie <ArrowRight size={16} />
              </span>
            </Link>
          </div>

          <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-white/35">
            <Bot className="mt-0.5 shrink-0" size={15} />
            IA locale d’entraînement : aucune partie n’est classée ni enregistrée
            dans le profil.
          </p>
        </section>
      </div>
    </main>
  );
}
