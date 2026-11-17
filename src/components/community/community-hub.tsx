"use client";

import { Bell, Medal, MessagesSquare, Newspaper, Settings, Swords, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { ChallengesPanel, NotificationsPanel } from "./activity-panels";
import { Feed } from "./feed";
import { FriendsPanel } from "./friends-panel";
import { RoomsPanel, SettingsPanel, type RoomData } from "./rooms-settings";
import { api, RoomIcon, Spinner } from "./shared";

const TABS = [
  { id: "fil", label: "Fil", icon: Newspaper },
  { id: "amis", label: "Amis", icon: Users },
  { id: "defis", label: "Défis & invitations", icon: Swords },
  { id: "salons", label: "Salons", icon: MessagesSquare },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "parametres", label: "Paramètres", icon: Settings },
] as const;

type TabId = (typeof TABS)[number]["id"];

export interface SessionViewer {
  id: string;
  username: string;
  avatar: string | null;
  isAdmin: boolean;
}

export function useViewer() {
  const [viewer, setViewer] = useState<SessionViewer | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: SessionViewer } | null) => setViewer(d?.user ?? null))
      .catch(() => setViewer(null));
  }, []);
  return viewer;
}

export function CommunityHub() {
  const router = useRouter();
  const params = useSearchParams();
  const viewer = useViewer();
  const requested = params.get("tab");
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : "fil";
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [unread, setUnread] = useState(0);
  const [roomFilter, setRoomFilter] = useState<string | null>(null);
  // Partage depuis une page de tournoi ou de club : le formulaire s'ouvre avec le lien joint.
  const shareType = params.get("share");
  const attachment =
    (shareType === "TOURNAMENT" || shareType === "CLUB") && params.get("id")
      ? { type: shareType as "TOURNAMENT" | "CLUB", id: params.get("id")!, label: params.get("label") ?? (shareType === "TOURNAMENT" ? "Tournoi" : "Club") }
      : null;

  const loadRooms = useCallback(() => {
    api<{ rooms: RoomData[] }>("/api/community/rooms").then((d) => setRooms(d.rooms)).catch(() => undefined);
  }, []);
  useEffect(() => {
    loadRooms();
  }, [loadRooms]);
  useEffect(() => {
    if (!viewer) return;
    api<{ unread: number }>("/api/community/notifications?count=1").then((d) => setUnread(d.unread)).catch(() => undefined);
  }, [viewer, tab]);

  const select = (id: TabId) => router.replace(id === "fil" ? "/communaute" : `/communaute?tab=${id}`, { scroll: false });

  if (viewer === undefined) return <Spinner />;

  const needsLogin = !viewer && tab !== "fil" && tab !== "salons";
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Communauté"
        title="Joueurs, amis et discussions"
        description="Échangez autour des échecs et des dames, retrouvez vos amis, lancez des défis et suivez vos clubs."
      />

      <nav aria-label="Rubriques de la communauté" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div role="tablist" className="flex min-w-max gap-1 rounded-2xl border border-line bg-surface p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => select(id)}
              className={`relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm transition-colors ${
                tab === id ? "bg-surface-3 font-semibold text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              <Icon className="size-4" />
              {label}
              {id === "notifications" && unread > 0 && (
                <span className="tabular rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-ink">{unread > 99 ? "99+" : unread}</span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {needsLogin ? (
        <div className="card p-8 text-center">
          <p className="font-semibold">Connectez-vous pour accéder à cette rubrique.</p>
          <Link href="/" className="btn btn-primary mt-4">Se connecter</Link>
        </div>
      ) : tab === "fil" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
              <button type="button" onClick={() => setRoomFilter(null)} className={`chip ${roomFilter === null ? "border-accent text-accent" : ""}`}>Tout</button>
              {rooms.filter((r) => r.visibility === "PUBLIC").map((r) => (
                <button key={r.slug} type="button" onClick={() => setRoomFilter(r.slug)} className={`chip ${roomFilter === r.slug ? "border-accent text-accent" : ""}`}>
                  <RoomIcon icon={r.icon} className="size-3.5" /> {r.name}
                </button>
              ))}
            </div>
            <Feed
              key={roomFilter ?? "all"}
              viewer={viewer}
              rooms={rooms}
              attachment={attachment}
              fixedRoom={roomFilter ?? undefined}
              query={roomFilter ? { room: roomFilter } : {}}
            />
          </div>
          <aside className="hidden flex-col gap-4 lg:flex">
            <section className="card p-4">
              <h2 className="eyebrow">Salons</h2>
              <ul className="mt-2 space-y-0.5">
                <li>
                  <button type="button" onClick={() => setRoomFilter(null)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${roomFilter === null ? "bg-surface-3 text-ink" : "text-ink-soft hover:bg-surface-2"}`}>
                    <Newspaper className="size-4" /> Tout le fil
                  </button>
                </li>
                {rooms.map((r) => (
                  <li key={r.slug}>
                    <button type="button" onClick={() => setRoomFilter(r.slug)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${roomFilter === r.slug ? "bg-surface-3 text-ink" : "text-ink-soft hover:bg-surface-2"}`}>
                      <RoomIcon icon={r.icon} className="size-4" />
                      <span className="flex-1 truncate">{r.name}</span>
                      {r.postCount ? <span className="tabular text-xs text-ink-muted">{r.postCount}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
              {roomFilter && (
                <Link href={`/communaute/salons/${roomFilter}`} className="mt-2 block px-2 text-xs text-accent hover:underline">Ouvrir la page du salon</Link>
              )}
            </section>
            <section className="card space-y-2 p-4 text-sm">
              <h2 className="eyebrow">Raccourcis</h2>
              <button type="button" onClick={() => select("amis")} className="flex w-full items-center gap-2 text-left text-ink-soft hover:text-ink"><Users className="size-4" /> Trouver des amis</button>
              <button type="button" onClick={() => select("defis")} className="flex w-full items-center gap-2 text-left text-ink-soft hover:text-ink"><Swords className="size-4" /> Mes défis et invitations</button>
              <Link href="/clubs" className="flex items-center gap-2 text-ink-soft hover:text-ink"><Users className="size-4" /> Clubs</Link>
              <Link href="/classements" className="flex items-center gap-2 text-ink-soft hover:text-ink"><Medal className="size-4" /> Classements</Link>
            </section>
          </aside>
        </div>
      ) : tab === "amis" ? (
        <FriendsPanel />
      ) : tab === "defis" ? (
        <ChallengesPanel />
      ) : tab === "salons" ? (
        <RoomsPanel rooms={rooms} onChanged={loadRooms} loggedIn={!!viewer} />
      ) : tab === "notifications" ? (
        <NotificationsPanel onUnreadChange={setUnread} />
      ) : (
        <SettingsPanel />
      )}
    </div>
  );
}
