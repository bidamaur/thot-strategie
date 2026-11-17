"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

interface Item {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

const POLL_MS = 60_000;

/**
 * Cloche de notifications : un simple compteur interrogé toutes les 60 s quand
 * l'onglet est visible (aucune connexion temps réel permanente). Désactivée en
 * salle de jeu pour ne rien ajouter pendant une partie.
 */
export function NotificationBell({ paused }: { paused: boolean }) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (document.hidden) return;
    try {
      const response = await fetch("/api/community/notifications?count=1", { cache: "no-store" });
      if (response.ok) setUnread(((await response.json()) as { unread: number }).unread);
    } catch {
      // hors ligne : on réessaiera
    }
  }, []);

  useEffect(() => {
    if (paused) return;
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(refresh, POLL_MS);
    const onVisible = () => !document.hidden && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("thot:notifications", refresh);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("thot:notifications", refresh);
    };
  }, [paused, refresh]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    fetch("/api/community/notifications", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items: Item[]; unread: number } | null) => {
        setItems(d?.items.slice(0, 8) ?? []);
        if (d) setUnread(d.unread);
      })
      .catch(() => setItems([]));
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function markAll() {
    await fetch("/api/community/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ read: "all" }) }).catch(() => undefined);
    setUnread(0);
    setItems((list) => list?.map((n) => ({ ...n, read: true })) ?? null);
  }

  async function follow(item: Item) {
    setOpen(false);
    if (!item.read) {
      setUnread((n) => Math.max(0, n - 1));
      await fetch("/api/community/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ read: [item.id] }) }).catch(() => undefined);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={unread > 0 ? `Notifications (${unread} non lues)` : "Notifications"}
        aria-expanded={open}
        className="btn btn-ghost relative min-h-0 px-2.5 py-1.5"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="tabular absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-ink">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-xl animate-rise">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="flex items-center gap-1 text-xs text-accent hover:underline"><CheckCheck size={14} /> Tout lire</button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items === null && <li className="px-4 py-6 text-center text-sm text-ink-muted">Chargement…</li>}
            {items?.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-muted">Aucune notification.</li>}
            {items?.map((n) => (
              <li key={n.id}>
                <Link href={n.link ?? "/communaute?tab=notifications"} onClick={() => follow(n)} className={`flex gap-2 px-4 py-2.5 text-sm hover:bg-surface-2 ${n.read ? "text-ink-soft" : "bg-accent/[0.05] font-medium"}`}>
                  {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />}
                  <span className="min-w-0">
                    <span className="block">{n.title}</span>
                    {n.body && <span className="block truncate text-xs font-normal text-ink-muted">{n.body}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/communaute?tab=notifications" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-xs font-medium text-accent hover:bg-surface-2">
            Tout voir et régler mes notifications
          </Link>
        </div>
      )}
    </div>
  );
}
