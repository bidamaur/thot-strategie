"use client";

import { ArrowLeft, Ban, Bell, BellOff, Crown, Flag, Lock, MapPin, Medal, Swords, UserCheck, UserMinus, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/page-header";
import { useViewer } from "./community-hub";
import { ChallengeDialog, InviteFriendsDialog, ReportDialog } from "./dialogs";
import { Feed } from "./feed";
import { PostCard, type PostData } from "./post-card";
import type { RoomData } from "./rooms-settings";
import { api, Avatar, Notice, RoomIcon, Spinner, timeAgo } from "./shared";

// ── Page d'un salon ───────────────────────────────────────────────────

export function RoomPage({ slug }: { slug: string }) {
  const viewer = useViewer();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(() => {
    api<{ room: RoomData }>(`/api/community/rooms/${encodeURIComponent(slug)}`)
      .then((d) => setRoom(d.room))
      .catch((e: Error) => setError(e.message));
  }, [slug]);
  useEffect(() => {
    load();
  }, [load]);

  async function membership(action: "join" | "leave" | "follow" | "unfollow") {
    await api(`/api/community/rooms/${encodeURIComponent(slug)}`, { method: "POST", json: { action } }).catch(() => undefined);
    load();
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!room || viewer === undefined) return <Spinner />;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link href="/communaute?tab=salons" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="size-4" /> Tous les salons</Link>
      <header className="card flex flex-wrap items-start gap-4 p-5">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-xl text-accent"><RoomIcon icon={room.icon} className="size-6" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">{room.name} {room.visibility === "PRIVATE" && <Lock className="size-4 text-gold" aria-label="Salon privé" />}</h1>
          {room.description && <p className="mt-1 text-sm text-ink-muted">{room.description}</p>}
          <p className="mt-1 text-xs text-ink-muted">{room.postCount ?? 0} publication(s) · {room.memberCount ?? 0} membre(s)</p>
        </div>
        {viewer && (
          <div className="flex flex-wrap gap-2">
            {room.access?.canModerate && room.visibility === "PRIVATE" && (
              <button type="button" onClick={() => setInviting(true)} className="btn btn-primary min-h-0 px-3 py-1.5 text-sm"><UserPlus className="size-4" /> Inviter</button>
            )}
            {room.access?.isMember && room.access.follow ? (
              <button type="button" onClick={() => membership("unfollow")} className="btn btn-ghost min-h-0 px-3 py-1.5 text-sm"><BellOff className="size-4" /> Ne plus suivre</button>
            ) : (
              <button type="button" onClick={() => membership(room.access?.isMember ? "follow" : "join")} className="btn btn-ghost min-h-0 px-3 py-1.5 text-sm"><Bell className="size-4" /> Suivre</button>
            )}
            {room.access?.isMember && room.access.role !== "OWNER" && room.visibility === "PRIVATE" && (
              <button type="button" onClick={() => membership("leave")} className="btn btn-ghost min-h-0 px-3 py-1.5 text-sm">Quitter</button>
            )}
          </div>
        )}
      </header>
      <Feed
        viewer={viewer}
        rooms={[{ slug: room.slug, name: room.name, access: room.access }]}
        fixedRoom={room.slug}
        query={{ room: room.slug }}
        emptyTitle="Aucune publication dans ce salon"
      />
      {inviting && <InviteFriendsDialog kind="room" target={room.slug} title={`Inviter dans « ${room.name} »`} onClose={() => { setInviting(false); load(); }} />}
    </div>
  );
}

// ── Page d'une publication ────────────────────────────────────────────

export function PostPage({ postId }: { postId: string }) {
  const viewer = useViewer();
  const [post, setPost] = useState<PostData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ post: PostData }>(`/api/community/posts/${encodeURIComponent(postId)}`)
      .then((d) => setPost(d.post))
      .catch((e: Error) => setError(e.message));
  }, [postId]);
  if (error) return <div className="mx-auto w-full max-w-2xl"><EmptyState title="Publication indisponible">{error}</EmptyState></div>;
  if (!post || viewer === undefined) return <Spinner />;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link href={post.room ? `/communaute/salons/${post.room.slug}` : post.club ? `/clubs/${post.club.slug}` : "/communaute"} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Retour
      </Link>
      <PostCard post={post} viewer={viewer} expanded onRemoved={() => setError("Publication supprimée.")} />
    </div>
  );
}

// ── Profil public d'un joueur ─────────────────────────────────────────

interface ProfileData {
  id: string;
  username: string;
  avatar: string | null;
  bio: string | null;
  accent: string | null;
  memberSince: string;
  location: string | null;
  online: boolean | null;
  premiumLevel: number;
  isAdmin: boolean;
  relationship: { status: string; friendshipId: string | null; favorite: boolean };
  acceptsFriendRequests: boolean;
  ratings: { general: number; pools: { variant: string; cadence: string | null; rating: number; games: number }[] } | null;
  stats: { games: number; wins: number; losses: number; draws: number; tournamentWins: number; podiums: number } | null;
  recentMatches: { id: string; gameType: string; variant: string | null; mode: string; opponent: string; result: string; date: string }[];
  clubs: { slug: string; name: string; logo: string | null; role: string }[] | null;
  community: { friends: number | null; posts: number; comments: number; showPosts: boolean };
  badges: { id: string; label: string; description: string }[];
  isSelf: boolean;
}

const VARIANT_LABEL: Record<string, string> = { CHESS: "Échecs", INTERNATIONAL: "Dames int.", ENGLISH: "Dames angl." };
const CADENCE_LABEL: Record<string, string> = { BULLET: "Bullet", BLITZ: "Blitz", RAPID: "Rapide", CLASSICAL: "Classique", UNLIMITED: "Sans pendule" };

export function PlayerProfile({ username }: { username: string }) {
  const viewer = useViewer();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [challenge, setChallenge] = useState(false);
  const [reporting, setReporting] = useState(false);

  const load = useCallback(() => {
    api<{ profile: ProfileData }>(`/api/community/players/${encodeURIComponent(username)}`)
      .then((d) => setProfile(d.profile))
      .catch((e: Error) => setError(e.message));
  }, [username]);
  useEffect(() => {
    load();
  }, [load]);

  async function friendAction(body: Record<string, unknown>, success: string) {
    setNotice(null);
    try {
      await api("/api/community/friends", { method: "POST", json: body });
      setNotice({ tone: "success", text: success });
      load();
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    }
  }

  if (error) return <div className="mx-auto w-full max-w-2xl"><EmptyState title="Profil indisponible">{error}</EmptyState></div>;
  if (!profile || viewer === undefined) return <Spinner />;
  const rel = profile.relationship.status;
  const winRate = profile.stats && profile.stats.games > 0 ? Math.round((profile.stats.wins / profile.stats.games) * 100) : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="card overflow-hidden">
        <div className="h-20 sm:h-24" style={{ background: `linear-gradient(120deg, ${profile.accent ?? "var(--accent)"}33, transparent 70%)` }} />
        <div className="-mt-10 flex flex-wrap items-end gap-4 px-5 pb-5">
          <span className="rounded-full border-4 border-surface"><Avatar user={profile} size={84} online={profile.online} /></span>
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
              {profile.username}
              {profile.premiumLevel > 0 && <span className="chip border-gold/40 text-gold"><Crown className="size-3.5" /> Premium</span>}
              {profile.isAdmin && <span className="chip">Équipe</span>}
            </h1>
            <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-ink-muted">
              {profile.online !== null && <span>{profile.online ? "En ligne" : "Hors ligne"}</span>}
              {profile.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> {profile.location}</span>}
              <span>Membre depuis {new Date(profile.memberSince).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</span>
            </p>
          </div>
          {viewer && !profile.isSelf && (
            <div className="flex flex-wrap gap-2">
              {rel === "FRIENDS" ? (
                <>
                  <button type="button" onClick={() => setChallenge(true)} className="btn btn-primary"><Swords className="size-4" /> Défier</button>
                  <span className="btn btn-ghost pointer-events-none"><UserCheck className="size-4" /> Ami</span>
                </>
              ) : rel === "REQUEST_SENT" ? (
                <span className="btn btn-ghost pointer-events-none">Demande envoyée</span>
              ) : rel === "REQUEST_RECEIVED" ? (
                <button type="button" onClick={() => friendAction({ action: "accept", friendshipId: profile.relationship.friendshipId }, "Vous êtes maintenant amis.")} className="btn btn-primary"><UserCheck className="size-4" /> Accepter la demande</button>
              ) : rel === "BLOCKED_BY_ME" ? (
                <button type="button" onClick={() => friendAction({ action: "unblock", target: profile.id }, "Joueur débloqué.")} className="btn btn-ghost">Débloquer</button>
              ) : (
                profile.acceptsFriendRequests && (
                  <button type="button" onClick={() => friendAction({ action: "request", target: profile.id }, "Demande d’amitié envoyée.")} className="btn btn-primary"><UserPlus className="size-4" /> Ajouter</button>
                )
              )}
              {rel === "FRIENDS" && (
                <button type="button" onClick={() => window.confirm("Retirer de vos amis ?") && friendAction({ action: "remove", target: profile.id }, "Ami retiré.")} className="btn btn-ghost" aria-label="Retirer des amis" title="Retirer des amis"><UserMinus className="size-4" /></button>
              )}
              {rel !== "BLOCKED_BY_ME" && (
                <button type="button" onClick={() => window.confirm(`Bloquer ${profile.username} ? Il ne pourra plus interagir avec vous.`) && friendAction({ action: "block", target: profile.id }, "Joueur bloqué.")} className="btn btn-ghost" aria-label="Bloquer" title="Bloquer"><Ban className="size-4" /></button>
              )}
              <button type="button" onClick={() => setReporting(true)} className="btn btn-ghost" aria-label="Signaler" title="Signaler"><Flag className="size-4" /></button>
            </div>
          )}
          {profile.isSelf && <Link href="/communaute?tab=parametres" className="btn btn-ghost">Modifier mon profil</Link>}
        </div>
        {profile.bio && <p className="whitespace-pre-wrap border-t border-line px-5 py-4 text-sm text-ink-soft">{profile.bio}</p>}
      </header>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          {profile.ratings && (
            <section className="card p-4">
              <h2 className="text-sm font-semibold">Classements</h2>
              {profile.ratings.pools.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">Classement général : <strong className="tabular">{profile.ratings.general}</strong>. Pas encore de partie classée.</p>
              ) : (
                <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {profile.ratings.pools.slice(0, 6).map((p) => (
                    <li key={`${p.variant}-${p.cadence}`} className="card-muted p-3">
                      <p className="text-xs text-ink-muted">{VARIANT_LABEL[p.variant] ?? p.variant} · {CADENCE_LABEL[p.cadence ?? ""] ?? "—"}</p>
                      <p className="tabular text-xl font-semibold">{p.rating}</p>
                      <p className="text-xs text-ink-muted">{p.games} parties</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {profile.stats && (
            <section className="card p-4">
              <h2 className="text-sm font-semibold">Statistiques</h2>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                {[
                  ["Parties", profile.stats.games],
                  ["Victoires", profile.stats.wins],
                  ["Nulles", profile.stats.draws],
                  ["Défaites", profile.stats.losses],
                  ["Tournois gagnés", profile.stats.tournamentWins],
                  ["Podiums", profile.stats.podiums],
                ].map(([label, value]) => (
                  <div key={label as string} className="card-muted p-2.5">
                    <p className="tabular text-lg font-semibold">{value}</p>
                    <p className="text-[11px] text-ink-muted">{label}</p>
                  </div>
                ))}
              </div>
              {winRate !== null && <p className="mt-2 text-xs text-ink-muted">{winRate} % de victoires</p>}
              {profile.recentMatches.length > 0 && (
                <ul className="mt-4 divide-y divide-line text-sm">
                  {profile.recentMatches.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 py-2">
                      <span className={`w-16 text-xs font-semibold ${m.result === "WIN" ? "text-accent" : m.result === "LOSS" ? "text-danger" : "text-ink-muted"}`}>
                        {m.result === "WIN" ? "Victoire" : m.result === "LOSS" ? "Défaite" : "Nulle"}
                      </span>
                      <span className="flex-1 truncate">contre {m.opponent}</span>
                      <span className="text-xs text-ink-muted">{m.gameType === "CHESS" ? "♞" : "⛀"} {timeAgo(m.date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {profile.community.showPosts ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">Publications récentes</h2>
              <Feed viewer={viewer} rooms={[]} showComposer={false} query={{ author: profile.username }} emptyTitle="Aucune publication" />
            </section>
          ) : null}
        </div>
        <aside className="flex flex-col gap-5">
          <section className="card p-4">
            <h2 className="text-sm font-semibold">Communauté</h2>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ["Amis", profile.community.friends ?? "—"],
                ["Publications", profile.community.posts],
                ["Commentaires", profile.community.comments],
              ].map(([label, value]) => (
                <div key={label as string} className="card-muted p-2">
                  <dd className="tabular text-lg font-semibold">{value}</dd>
                  <dt className="text-[11px] text-ink-muted">{label}</dt>
                </div>
              ))}
            </dl>
          </section>
          {profile.badges.length > 0 && (
            <section className="card p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><Medal className="size-4 text-gold" /> Badges et distinctions</h2>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {profile.badges.map((b) => (
                  <li key={b.id} className="chip border-gold/30 text-gold" title={b.description}>{b.label}</li>
                ))}
              </ul>
            </section>
          )}
          {profile.clubs && profile.clubs.length > 0 && (
            <section className="card p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4 text-accent" /> Clubs</h2>
              <ul className="mt-2 space-y-1.5">
                {profile.clubs.map((c) => (
                  <li key={c.slug} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/clubs/${c.slug}`} className="truncate hover:text-accent">{c.name}</Link>
                    {c.role !== "MEMBER" && <span className="chip">{c.role === "OWNER" ? "Fondateur" : "Responsable"}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
      {challenge && <ChallengeDialog opponent={profile} onClose={() => setChallenge(false)} />}
      {reporting && <ReportDialog targetType="USER" targetId={profile.id} onClose={() => setReporting(false)} />}
    </div>
  );
}
