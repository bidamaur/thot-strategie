"use client";

import { Download, PlusSquare, RefreshCw, Share, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  configureTelemetry,
  isStandalone,
  registerVisit,
  startSessionTracking,
  storageGet,
  storageSet,
  track,
  variantOf,
} from "@/lib/client/telemetry";

/**
 * Couche « application » commune à toutes les pages :
 *  - service worker (application installable) et mise à jour discrète ;
 *  - proposition d'installation (Android/ordinateur : invite native ;
 *    iPhone/iPad : guide « Sur l'écran d'accueil ») ;
 *  - UNE sollicitation au plus par visite (bienvenue, campagne, installation) ;
 *  - jamais rien pendant une partie : toute la section /match est silencieuse.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface Prompt {
  id: string;
  kind: "modal" | "banner";
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  variant: string | null;
}

interface InstallConfig {
  enabled: boolean;
  minVisits: number;
  cooldownDays: number;
  maxDismissals: number;
  message: string;
}

interface InstallState {
  dismissedAt?: string;
  dismissals?: number;
  installedAt?: string;
}

const SESSION_FLAG = "thot.promptShown";

const quiet = (path: string) => path === "/match" || path.startsWith("/match/") || path.startsWith("/admin");

function sessionFlag(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_FLAG) === "1";
  } catch {
    return false;
  }
}
function setSessionFlag() {
  try {
    window.sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {
    // ignoré
  }
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function localInstallState(): InstallState {
  try {
    return JSON.parse(storageGet("thot.install") ?? "{}") as InstallState;
  } catch {
    return {};
  }
}

function postEngagement(body: Record<string, unknown>) {
  void fetch("/api/engagement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
}

export function AppExperience() {
  const pathname = usePathname() ?? "/";
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [install, setInstall] = useState<null | { mode: "native" | "ios" | "help"; variant: string | null; message: string }>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const loggedIn = useRef(false);
  const config = useRef<InstallConfig | null>(null);
  const serverInstallState = useRef<InstallState>({});
  const waitingWorker = useRef<ServiceWorker | null>(null);

  // ── Initialisation unique ──────────────────────────────────────────
  useEffect(() => {
    const onBip = (event: Event) => {
      event.preventDefault(); // on choisit nous-mêmes le bon moment
      deferred.current = event as BeforeInstallPromptEvent;
    };
    const onInstalled = () => {
      deferred.current = null;
      setInstall(null);
      track("pwa_installed");
      storageSet("thot.install", JSON.stringify({ ...localInstallState(), installedAt: new Date().toISOString() }));
      if (loggedIn.current) postEngagement({ action: "prompt", id: "pwa_install", event: "installed" });
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    registerVisit();
    const stopSession = startSessionTracking();
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
      stopSession();
    };
  }, []);

  // ── Service worker + détection des nouvelles versions ─────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let registration: ServiceWorkerRegistration | null = null;
    const watch = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) {
        waitingWorker.current = reg.waiting;
        setUpdateReady(true);
      }
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            waitingWorker.current = worker;
            setUpdateReady(true);
          }
        });
      });
    };
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        registration = reg;
        watch(reg);
      })
      .catch(() => undefined);

    let version: string | null = null;
    const checkVersion = () => {
      void fetch("/api/version", { cache: "no-store" })
        .then((r) => r.json())
        .then((json: { version?: string }) => {
          if (!json.version) return;
          if (version && version !== json.version) setUpdateReady(true);
          version ??= json.version;
          void registration?.update().catch(() => undefined);
        })
        .catch(() => undefined);
    };
    checkVersion();
    const interval = setInterval(checkVersion, 15 * 60_000);
    const onVisible = () => document.visibilityState === "visible" && checkVersion();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const showInstall = useCallback((manual: boolean) => {
    const cfg = config.current;
    const message = cfg?.message ?? "Installez l'application sur votre appareil.";
    if (isStandalone()) return false;
    if (deferred.current) {
      setInstall({ mode: "native", variant: manual ? null : variantOf("install_prompt"), message });
      track("pwa_install_prompt_shown", { manual }, { id: "install_prompt", variant: manual ? null : variantOf("install_prompt") });
      return true;
    }
    if (isIos()) {
      setInstall({ mode: "ios", variant: null, message });
      track("pwa_ios_guide_shown", { manual });
      return true;
    }
    if (manual) {
      setInstall({ mode: "help", variant: null, message });
      return true;
    }
    return false;
  }, []);

  // Déclenchement manuel (parcours de bienvenue, menu) : window.dispatchEvent(new Event("thot:install"))
  useEffect(() => {
    const onManual = () => showInstall(true);
    window.addEventListener("thot:install", onManual);
    return () => window.removeEventListener("thot:install", onManual);
  }, [showInstall]);

  // ── Sollicitation de la page (au plus une par visite) ──────────────
  useEffect(() => {
    if (quiet(pathname)) {
      // Entrée en partie : toute sollicitation ouverte se referme.
      const close = setTimeout(() => {
        setPrompt(null);
        setInstall((current) => (current?.mode === "help" ? current : null));
      }, 0);
      return () => clearTimeout(close);
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void fetch(`/api/engagement?scope=light&path=${encodeURIComponent(pathname)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { user: { id: string } | null; config: { install: InstallConfig; analytics: boolean; experiments: { id: string; variants: string[] }[] }; prompt: Prompt | null; installState?: InstallState } | null) => {
          if (!data || cancelled) return;
          loggedIn.current = Boolean(data.user);
          config.current = data.config.install;
          serverInstallState.current = data.installState ?? {};
          configureTelemetry({ enabled: data.config.analytics, experiments: data.config.experiments });
          if (sessionFlag() || quiet(window.location.pathname)) return;
          if (data.prompt) {
            setSessionFlag();
            setPrompt(data.prompt);
            postEngagement({ action: "prompt", id: data.prompt.id, event: "shown", kind: data.prompt.kind });
            track("prompt_shown", { id: data.prompt.id }, { id: `campaign_${data.prompt.id}`.slice(0, 40), variant: data.prompt.variant });
            return;
          }
          // Proposition d'installation : seulement si rien d'autre n'a été montré.
          const cfg = data.config.install;
          const st = loggedIn.current ? { ...localInstallState(), ...serverInstallState.current } : localInstallState();
          const visits = Number(storageGet("thot.visits") ?? "0");
          const cooled = !st.dismissedAt || Date.now() - Date.parse(st.dismissedAt) > cfg.cooldownDays * 86_400_000;
          const variant = variantOf("install_prompt");
          const placementOk = variant !== "card" || pathname === "/";
          if (cfg.enabled && !st.installedAt && (st.dismissals ?? 0) < cfg.maxDismissals && cooled && visits >= cfg.minVisits && placementOk) {
            if (showInstall(false)) setSessionFlag();
          }
        })
        .catch(() => undefined);
    }, 1200); // laisse la page s'afficher d'abord
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [pathname, showInstall]);

  function closePrompt(event: "dismissed" | "clicked") {
    if (!prompt) return;
    postEngagement({ action: "prompt", id: prompt.id, event });
    track(event === "clicked" ? "prompt_clicked" : "prompt_dismissed", { id: prompt.id }, { id: `campaign_${prompt.id}`.slice(0, 40), variant: prompt.variant });
    setPrompt(null);
  }

  async function acceptInstall() {
    const event = deferred.current;
    if (!event) return;
    track("pwa_install_accepted", {}, { id: "install_prompt", variant: install?.variant ?? null });
    await event.prompt();
    const choice = await event.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    deferred.current = null;
    setInstall(null);
    if (choice.outcome === "dismissed") dismissInstall(false);
  }

  function dismissInstall(closeUi = true) {
    const st = localInstallState();
    const next = { ...st, dismissedAt: new Date().toISOString(), dismissals: (st.dismissals ?? 0) + 1 };
    storageSet("thot.install", JSON.stringify(next));
    if (loggedIn.current) postEngagement({ action: "prompt", id: "pwa_install", event: "dismissed" });
    track("pwa_install_dismissed", {}, { id: "install_prompt", variant: install?.variant ?? null });
    if (closeUi) setInstall(null);
  }

  function applyUpdate() {
    track("update_applied");
    const worker = waitingWorker.current;
    if (worker) {
      navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
      worker.postMessage({ type: "SKIP_WAITING" });
      setTimeout(() => window.location.reload(), 3000);
    } else {
      window.location.reload();
    }
  }

  const inQuiet = quiet(pathname);

  return (
    <>
      {/* Mise à jour : jamais pendant une partie ; proposée dès que le joueur quitte la salle. */}
      {updateReady && !inQuiet && (
        <div role="status" className="fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line-strong bg-surface-2 px-4 py-3 text-sm shadow-2xl lg:bottom-5">
          <RefreshCw size={16} className="shrink-0 text-accent" />
          <span className="flex-1">Une nouvelle version est disponible.</span>
          <button type="button" className="btn btn-primary min-h-0 px-3 py-1.5" onClick={applyUpdate}>Recharger</button>
          <button type="button" className="btn btn-ghost min-h-0 px-2 py-1.5" aria-label="Plus tard" onClick={() => setUpdateReady(false)}>
            <X size={15} />
          </button>
        </div>
      )}

      {prompt && !inQuiet && prompt.kind === "modal" && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="thot-prompt-title" onClick={() => closePrompt("dismissed")}>
          <div className="w-full max-w-md rounded-t-3xl border border-line-strong bg-surface p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:pb-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h2 id="thot-prompt-title" className="text-lg font-semibold">{prompt.title}</h2>
              <button type="button" className="btn btn-ghost min-h-0 px-2 py-1" aria-label="Fermer" onClick={() => closePrompt("dismissed")}>
                <X size={16} />
              </button>
            </div>
            <p className="mt-2 text-sm leading-6 text-ink-soft">{prompt.body}</p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-ghost" onClick={() => closePrompt("dismissed")}>Plus tard</button>
              {prompt.ctaHref && (
                <Link href={prompt.ctaHref} className="btn btn-primary" onClick={() => closePrompt("clicked")}>{prompt.ctaLabel || "Découvrir"}</Link>
              )}
            </div>
          </div>
        </div>
      )}

      {prompt && !inQuiet && prompt.kind === "banner" && (
        <div role="complementary" aria-label="Information" className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-xl items-start gap-3 rounded-2xl border border-line-strong bg-surface-2/95 px-4 py-3 shadow-xl backdrop-blur lg:bottom-5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{prompt.title}</p>
            <p className="mt-0.5 text-xs leading-5 text-ink-muted">{prompt.body}</p>
            {prompt.ctaHref && (
              <Link href={prompt.ctaHref} onClick={() => closePrompt("clicked")} className="mt-2 inline-block text-xs font-semibold text-accent hover:underline">
                {prompt.ctaLabel || "Découvrir"} →
              </Link>
            )}
          </div>
          <button type="button" className="btn btn-ghost min-h-0 px-2 py-1" aria-label="Fermer" onClick={() => closePrompt("dismissed")}>
            <X size={15} />
          </button>
        </div>
      )}

      {install && (!inQuiet || install.mode === "help") && (
        <div
          role="dialog"
          aria-label="Installer l'application"
          className={
            install.variant === "card"
              ? "fixed inset-x-3 top-20 z-40 mx-auto max-w-sm rounded-2xl border border-accent/30 bg-surface p-4 shadow-2xl"
              : "fixed inset-x-3 bottom-20 z-40 mx-auto max-w-xl rounded-2xl border border-accent/30 bg-surface-2/95 p-4 shadow-2xl backdrop-blur lg:bottom-5"
          }
        >
          <div className="flex items-start gap-3">
            <img src="/icons/icon-192.png" alt="" width={40} height={40} className="size-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Installer Thot</p>
              <p className="mt-0.5 text-xs leading-5 text-ink-muted">{install.message}</p>
              {install.mode === "ios" && (
                <ol className="mt-2 space-y-1.5 text-xs text-ink-soft">
                  <li className="flex items-center gap-2"><span className="tabular text-ink-muted">1.</span> Touchez <Share size={14} className="text-info" aria-label="Partager" /> <strong>Partager</strong> dans la barre de Safari</li>
                  <li className="flex items-center gap-2"><span className="tabular text-ink-muted">2.</span> Choisissez <PlusSquare size={14} aria-hidden /> <strong>Sur l’écran d’accueil</strong></li>
                  <li className="flex items-center gap-2"><span className="tabular text-ink-muted">3.</span> Touchez <strong>Ajouter</strong></li>
                </ol>
              )}
              {install.mode === "help" && (
                <p className="mt-2 text-xs text-ink-soft">
                  Dans Chrome ou Edge : menu ⋮ puis « Installer Thot ». Sur Android : menu ⋮ puis « Ajouter à l’écran d’accueil ». Votre navigateur actuel ne propose pas l’installation automatique.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {install.mode === "native" && (
                  <button type="button" className="btn btn-primary min-h-0 px-3 py-1.5" onClick={() => void acceptInstall()}>
                    <Download size={14} /> Installer
                  </button>
                )}
                <button type="button" className="btn btn-ghost min-h-0 px-3 py-1.5" onClick={() => (install.mode === "help" ? setInstall(null) : dismissInstall())}>
                  {install.mode === "ios" ? "J’ai compris" : install.mode === "help" ? "Fermer" : "Pas maintenant"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
