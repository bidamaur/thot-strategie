"use client";

import { ArrowLeft, Crown, ImagePlus, Share2, Shield, Trophy, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageShell } from "@/components/ui/page-header";
import { useViewer } from "@/components/community/community-hub";
import { InviteFriendsDialog } from "@/components/community/dialogs";
import { Feed } from "@/components/community/feed";

interface ClubDetail {
  club: {
    id: string;
    name: string;
    description: string | null;
    city: string | null;
    country: string | null;
    accentColor: string | null;
    logo: string | null;
    isPrivate: boolean;
    maxMembers: number;
    owner: { id: string; username: string };
    members: { role: "OWNER" | "ADMIN" | "MEMBER"; joinedAt: string; user: { id: string; username: string; elo: number } }[];
    tournaments: { id: string; name: string; status: string; type: string; maxPlayers: number; _count: { participants: number } }[];
  };
  ranking: { position: number; userId: string; username: string; elo: number }[];
  myRole: "OWNER" | "ADMIN" | "MEMBER" | null;
}

const STATUS_LABELS: Record<string, string> = { OPEN: "Inscriptions", IN_PROGRESS: "En cours", COMPLETED: "Terminé", DRAFT: "Brouillon" };

export function ClubDetailClient({ slug }: { slug: string }) {
  const [data, setData] = useState<ClubDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const viewer = useViewer();

  const load = useCallback(() => {
    fetch(`/api/clubs/${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Club introuvable.");
        setData(json);
      })
      .catch((caught: Error) => setError(caught.message));
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(body: Record<string, string>) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/clubs/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) setError(json.error ?? "Action impossible.");
    load();
  }

  if (!data) {
    return (
      <PageShell width="max-w-5xl">
        {error ? <EmptyState title={error}><Link href="/clubs" className="text-accent underline">Retour aux clubs</Link></EmptyState> : <div className="card h-48 animate-pulse" />}
      </PageShell>
    );
  }

  const { club, ranking, myRole } = data;
  const isManager = myRole === "OWNER" || myRole === "ADMIN";

  async function customize(file: File) {
    const form = new FormData();
    form.append("logo", file);
    const response = await fetch(`/api/clubs/${encodeURIComponent(slug)}/logo`, { method: "POST", body: form });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) setError(json.error ?? "Personnalisation impossible.");
    load();
  }

  return (
    <PageShell width="max-w-5xl">
      <Link href="/clubs" className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Clubs
      </Link>

      <header className="card overflow-hidden">
        <div className="h-20" style={{ background: `linear-gradient(120deg, ${club.accentColor ?? "var(--accent)"}55, transparent)` }} />
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-4">
            {club.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={club.logo} alt="" className="-mt-12 size-20 shrink-0 rounded-2xl border-4 border-surface object-cover" />
            )}
            <div>
            <h1 className="text-2xl font-semibold">{club.name}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Fondé par {club.owner.username}
              {(club.city || club.country) && ` · ${[club.city, club.country].filter(Boolean).join(", ")}`}
              {` · ${club.members.length}/${club.maxMembers} membres`}
            </p>
            {club.description && <p className="mt-3 max-w-2xl text-sm text-ink-soft">{club.description}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {myRole && (!club.isPrivate || isManager) && (
              <button type="button" onClick={() => setInviting(true)} className="btn btn-ghost"><UserPlus className="size-4" /> Inviter des amis</button>
            )}
            {!club.isPrivate && viewer && (
              <Link href={`/communaute?share=CLUB&id=${club.id}&label=${encodeURIComponent(club.name)}`} className="btn btn-ghost" aria-label="Partager dans la communauté" title="Partager dans la communauté">
                <Share2 className="size-4" />
              </Link>
            )}
            {myRole === "OWNER" && (
              <label className="btn btn-ghost cursor-pointer" title="Logo du club (privilège Premium)">
                <ImagePlus className="size-4" /> Logo
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && customize(e.target.files[0])} />
              </label>
            )}
            {myRole === null && (
              <button type="button" disabled={busy} onClick={() => act({ action: "join" })} className="btn btn-primary">Rejoindre</button>
            )}
            {myRole && myRole !== "OWNER" && (
              <button type="button" disabled={busy} onClick={() => act({ action: "leave" })} className="btn btn-ghost">Quitter</button>
            )}
            {isManager && (
              <Link href={`/tournois?club=${club.id}`} className="btn btn-primary">
                <Trophy className="size-4" /> Organiser un tournoi
              </Link>
            )}
          </div>
        </div>
      </header>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="card p-5">
          <h2 className="text-base font-semibold">Classement interne</h2>
          <ol className="mt-3 divide-y divide-line">
            {ranking.map((row) => {
              const member = club.members.find((m) => m.user.id === row.userId);
              return (
                <li key={row.userId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="tabular w-6 text-ink-muted">{row.position}</span>
                    <span className="truncate font-medium">{row.username}</span>
                    {member?.role === "OWNER" && <Crown className="size-3.5 shrink-0 text-gold" aria-label="Fondateur" />}
                    {member?.role === "ADMIN" && <Shield className="size-3.5 shrink-0 text-accent" aria-label="Responsable" />}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular font-semibold">{row.elo}</span>
                    {myRole === "OWNER" && member && member.role !== "OWNER" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => act({ action: "setRole", userId: row.userId, role: member.role === "ADMIN" ? "MEMBER" : "ADMIN" })}
                        className="btn btn-ghost min-h-0 px-2 py-1 text-xs"
                      >
                        {member.role === "ADMIN" ? "Retirer resp." : "Nommer resp."}
                      </button>
                    )}
                    {isManager && member && member.role === "MEMBER" && (
                      <button type="button" disabled={busy} onClick={() => act({ action: "remove", userId: row.userId })} className="rounded-lg p-1 text-ink-muted hover:text-danger" aria-label={`Exclure ${row.username}`}>
                        <UserMinus className="size-4" />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold">Compétitions du club</h2>
          {club.tournaments.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">Aucun tournoi pour l’instant.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {club.tournaments.map((t) => (
                <li key={t.id} className="card-muted px-3 py-2.5">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-ink-muted">
                    {STATUS_LABELS[t.status] ?? t.status} · {t._count.participants}/{t.maxPlayers} joueurs
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Mur du club</h2>
        <p className="-mt-2 text-sm text-ink-muted">Annonces, discussions et organisation entre membres{club.isPrivate ? " (visible par les membres seulement)" : ""}.</p>
        <Feed
          viewer={viewer ?? null}
          rooms={[]}
          club={slug}
          query={{ club: slug }}
          showComposer={!!myRole}
          emptyTitle="Aucune publication sur le mur du club"
        />
      </section>
      {inviting && <InviteFriendsDialog kind="club" target={slug} title={`Inviter dans « ${club.name} »`} onClose={() => setInviting(false)} />}
    </PageShell>
  );
}
