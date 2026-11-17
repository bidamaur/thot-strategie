"use client";

import {
  Crown,
  Lock,
  Megaphone,
  MessageCircle,
  Shield,
  Star,
  Swords,
  Target,
  Trophy,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

/** Appel JSON aux API communautaires : renvoie les données ou lève un Error avec le message serveur. */
export async function api<T = Record<string, unknown>>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(url, {
    cache: "no-store",
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Action impossible pour le moment.");
  return data;
}

/**
 * Lance un chargement asynchrone après le rendu (et l'annule si le composant
 * est démonté aussitôt : évite les doubles requêtes du mode strict).
 */
export function useLoadEffect(load: () => unknown) {
  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);
}

export interface AuthorLike {
  id: string;
  username: string;
  avatar: string | null;
  elo?: number;
  premiumLevel: number;
  isAdmin?: boolean;
}

export function Avatar({ user, size = 40, online }: { user: { username: string; avatar: string | null }; size?: number; online?: boolean | null }) {
  const initials = user.username.slice(0, 2).toUpperCase();
  const isImage = user.avatar && (user.avatar.startsWith("/") || user.avatar.startsWith("http"));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="flex size-full items-center justify-center overflow-hidden rounded-full border border-line bg-surface-3 text-ink-soft"
        style={{ fontSize: Math.max(11, size * 0.36) }}
      >
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatar!} alt="" className="size-full object-cover" loading="lazy" />
        ) : user.avatar ? (
          <span aria-hidden="true">{user.avatar}</span>
        ) : (
          <span aria-hidden="true" className="font-semibold">{initials}</span>
        )}
      </span>
      {online !== undefined && online !== null && (
        <span
          aria-label={online ? "En ligne" : "Hors ligne"}
          className={`absolute bottom-0 right-0 size-3 rounded-full border-2 border-surface ${online ? "bg-accent" : "bg-surface-3"}`}
        />
      )}
    </span>
  );
}

/** Pseudo cliquable + badges (Premium, équipe). */
export function PlayerName({ user, showElo = true, className = "" }: { user: AuthorLike; showElo?: boolean; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <Link href={`/joueurs/${encodeURIComponent(user.username)}`} className="truncate font-semibold hover:text-accent">
        {user.username}
      </Link>
      {user.premiumLevel > 0 && <Crown className="size-3.5 shrink-0 text-gold" aria-label={`Premium niveau ${user.premiumLevel}`} />}
      {user.isAdmin && <Shield className="size-3.5 shrink-0 text-info" aria-label="Équipe Thot Stratégie" />}
      {showElo && typeof user.elo === "number" && <span className="tabular shrink-0 text-xs text-ink-muted">{user.elo}</span>}
    </span>
  );
}

const RTF = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("fr", { numeric: "auto" }) : null;

export function timeAgo(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (!RTF) return new Date(iso).toLocaleString("fr-FR");
  if (abs < 60) return "à l’instant";
  if (abs < 3600) return RTF.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return RTF.format(Math.round(diff / 3600), "hour");
  if (abs < 7 * 86_400) return RTF.format(Math.round(diff / 86_400), "day");
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: abs > 300 * 86_400 ? "numeric" : undefined });
}

export function RoomIcon({ icon, className = "size-4" }: { icon: string | null; className?: string }) {
  switch (icon) {
    case "chess":
      return <span className={`${className} inline-flex items-center justify-center leading-none`} aria-hidden="true">♞</span>;
    case "draughts":
      return <span className={`${className} inline-flex items-center justify-center leading-none`} aria-hidden="true">⛀</span>;
    case "swords":
      return <Swords className={className} />;
    case "trophy":
      return <Trophy className={className} />;
    case "shield":
      return <Shield className={className} />;
    case "target":
      return <Target className={className} />;
    case "news":
      return <Megaphone className={className} />;
    case "lock":
      return <Lock className={className} />;
    case "star":
      return <Star className={className} />;
    default:
      return <MessageCircle className={className} />;
  }
}

/** Boîte de dialogue accessible (Échap, clic extérieur, focus initial). */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card max-h-[92dvh] w-full overflow-y-auto rounded-b-none p-5 animate-rise sm:rounded-b-[var(--radius-card)] ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="btn btn-ghost min-h-0 p-1.5" aria-label="Fermer">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label = "Chargement…" }: { label?: string }) {
  return (
    <p role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-ink-muted">
      <span className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      {label}
    </p>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const styles =
    tone === "error"
      ? "border-danger/25 bg-danger/10 text-danger"
      : tone === "success"
        ? "border-accent/25 bg-accent/10 text-accent"
        : "border-line bg-surface-2 text-ink-soft";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-3 py-2 text-sm ${styles}`}>
      {children}
    </p>
  );
}
