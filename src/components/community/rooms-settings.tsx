"use client";

import { BarChart3, Bell, BellOff, Crown, Lock, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, Avatar, Modal, Notice, RoomIcon, Spinner, useLoadEffect } from "./shared";

export interface RoomData {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  postPermission: "EVERYONE" | "MEMBERS" | "MODERATORS";
  postCount: number | null;
  memberCount: number | null;
  access: { canPost: boolean; canModerate: boolean; isMember: boolean; follow: boolean; role: string | null } | null;
}

interface MeData {
  username: string;
  bio: string;
  privacy: Record<string, boolean | string | null>;
  canCustomize: boolean;
  notifications: { type: string; label: string; enabled: boolean; mandatory: boolean }[];
  restrictions: { type: string; expiresAt: string | null }[];
  premium: { tier: string; privateRooms: number; pinInOwnSpaces: boolean; communityStats: boolean; maxBulkInvites: number; clubCustomization: boolean; profileThemes: boolean };
}

export function RoomsPanel({ rooms, onChanged, loggedIn }: { rooms: RoomData[]; onChanged: () => void; loggedIn: boolean }) {
  const [creating, setCreating] = useState(false);
  const [premium, setPremium] = useState<MeData["premium"] | null>(null);
  const [form, setForm] = useState({ name: "", description: "", icon: "lock", postPermission: "MEMBERS" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (loggedIn) api<MeData>("/api/community/me").then((d) => setPremium(d.premium)).catch(() => undefined);
  }, [loggedIn]);

  async function membership(slug: string, action: "join" | "leave" | "follow" | "unfollow") {
    await api(`/api/community/rooms/${slug}`, { method: "POST", json: { action } }).catch(() => undefined);
    onChanged();
  }
  async function create() {
    setError("");
    try {
      await api("/api/community/rooms", { method: "POST", json: form });
      setCreating(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const publicRooms = rooms.filter((r) => r.visibility === "PUBLIC");
  const privateRooms = rooms.filter((r) => r.visibility === "PRIVATE");
  return (
    <div className="space-y-5">
      <ul className="grid gap-3 sm:grid-cols-2">
        {publicRooms.map((r) => (
          <li key={r.id} className="card flex flex-col p-4">
            <Link href={`/communaute/salons/${r.slug}`} className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-lg text-accent"><RoomIcon icon={r.icon} className="size-5" /></span>
              <span className="min-w-0">
                <span className="block font-semibold hover:text-accent">{r.name}</span>
                {r.description && <span className="mt-0.5 block text-sm text-ink-muted">{r.description}</span>}
              </span>
            </Link>
            <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-muted">
              <span className="tabular">{r.postCount ?? 0} publication(s){r.postPermission === "MODERATORS" ? " · annonces officielles" : ""}</span>
              {loggedIn &&
                (r.access?.isMember && r.access.follow ? (
                  <button type="button" onClick={() => membership(r.slug, "unfollow")} className="btn btn-ghost min-h-0 px-2 py-1 text-xs" title="Ne plus être notifié des publications importantes">
                    <BellOff className="size-3.5" /> Suivi
                  </button>
                ) : (
                  <button type="button" onClick={() => membership(r.slug, r.access?.isMember ? "follow" : "join")} className="btn btn-ghost min-h-0 px-2 py-1 text-xs" title="Être notifié des publications importantes">
                    <Bell className="size-3.5" /> Suivre
                  </button>
                ))}
            </div>
          </li>
        ))}
      </ul>

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Lock className="size-4 text-gold" /> Salons privés</h2>
          {premium && premium.privateRooms > 0 && (
            <button type="button" onClick={() => setCreating(true)} className="btn btn-primary min-h-0 px-3 py-1.5 text-xs"><Plus className="size-4" /> Créer un salon privé</button>
          )}
        </div>
        {privateRooms.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            {premium && premium.privateRooms > 0
              ? `Votre niveau ${premium.tier} permet ${premium.privateRooms} salon(s) privé(s) pour échanger avec vos amis ou votre équipe.`
              : <>Les salons privés sont un privilège <Link href="/premium" className="text-gold hover:underline">Premium</Link>. Toutes les discussions publiques restent ouvertes à tous.</>}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {privateRooms.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <RoomIcon icon={r.icon} className="size-4 text-gold" />
                <Link href={`/communaute/salons/${r.slug}`} className="flex-1 truncate text-sm font-medium hover:text-accent">{r.name}</Link>
                <span className="text-xs text-ink-muted">{r.memberCount} membre(s)</span>
                {r.access?.role === "OWNER" && <span className="chip">Créateur</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {creating && (
        <Modal title="Nouveau salon privé" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} className="field" placeholder="Nom du salon" />
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={300} rows={2} className="field" placeholder="Description" />
            <label className="block text-sm">
              <span className="eyebrow">Qui peut publier ?</span>
              <select value={form.postPermission} onChange={(e) => setForm({ ...form, postPermission: e.target.value })} className="field mt-1.5">
                <option value="MEMBERS">Tous les membres</option>
                <option value="MODERATORS">Seulement moi et les animateurs</option>
              </select>
            </label>
            <p className="text-xs text-ink-muted">Après création, invitez vos amis depuis la page du salon.</p>
            {error && <Notice tone="error">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="btn btn-ghost">Annuler</button>
              <button type="button" onClick={create} disabled={form.name.trim().length < 3} className="btn btn-primary">Créer</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const PRIVACY_LABELS: [string, string][] = [
  ["showRatings", "Mes classements ELO"],
  ["showStats", "Mes statistiques et dernières parties"],
  ["showClubs", "Mes clubs"],
  ["showFriends", "Mon nombre d’amis"],
  ["showPosts", "Mes publications sur mon profil"],
  ["showOnline", "Mon statut en ligne"],
  ["showLocation", "Ma ville et mon pays"],
];

export function SettingsPanel() {
  const [me, setMe] = useState<MeData | null>(null);
  const [bio, setBio] = useState("");
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; username: string; avatar: string | null }[]>([]);
  const [stats, setStats] = useState<{ posts: number; reactionsReceived: number; commentsReceived: number; newFriends: number; topPosts: { id: string; title: string; reactions: number; comments: number }[] } | null>(null);

  const load = useCallback(async () => {
    const data = await api<MeData>("/api/community/me");
    setMe(data);
    setBio(data.bio);
    const friends = await api<{ blocked: typeof blocked }>("/api/community/friends").catch(() => ({ blocked: [] }));
    setBlocked(friends.blocked);
    if (data.premium.communityStats) setStats(await api<NonNullable<typeof stats>>("/api/community/stats").catch(() => null));
  }, []);
  const initialLoad = useCallback(() => load().catch((e: Error) => setNotice({ tone: "error", text: e.message })), [load]);
  useLoadEffect(initialLoad);

  async function save(body: Record<string, unknown>, message = "Enregistré.") {
    setNotice(null);
    try {
      await api("/api/community/me", { method: "PATCH", json: body });
      setNotice({ tone: "success", text: message });
      await load();
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    }
  }

  if (!me) return <Spinner />;
  const disabled = me.notifications.filter((n) => !n.enabled).map((n) => n.type);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {notice && <div className="lg:col-span-2"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
      {me.restrictions.length > 0 && (
        <div className="lg:col-span-2">
          <Notice tone="error">
            Restriction en cours : {me.restrictions.map((r) => `${r.type === "MUTE" ? "publication suspendue" : "accès suspendu"}${r.expiresAt ? ` jusqu’au ${new Date(r.expiresAt).toLocaleString("fr-FR")}` : ""}`).join(" · ")}
          </Notice>
        </div>
      )}
      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold">Présentation</h2>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} rows={3} className="field" placeholder="Quelques mots sur vous, votre jeu préféré, votre club…" />
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-muted">{bio.length}/280</span>
          <button type="button" onClick={() => save({ bio }, "Présentation enregistrée.")} className="btn btn-primary min-h-0 px-3 py-1.5">Enregistrer</button>
        </div>
        <Link href={`/joueurs/${encodeURIComponent(me.username)}`} className="text-sm text-accent hover:underline">Voir mon profil public</Link>
        {me.canCustomize && (
          <label className="flex items-center gap-3 text-sm">
            <Crown className="size-4 text-gold" /> Couleur de mon profil
            <input
              type="color"
              value={(me.privacy.accent as string | null) ?? "#86c7a8"}
              onChange={(e) => save({ privacy: { accent: e.target.value } }, "Couleur enregistrée.")}
              className="h-8 w-12 cursor-pointer rounded border border-line bg-transparent"
            />
          </label>
        )}
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-accent" /> Confidentialité — visible par les autres</h2>
        {PRIVACY_LABELS.map(([key, label]) => (
          <label key={key} className="flex items-center justify-between gap-3 py-1 text-sm">
            {label}
            <input type="checkbox" checked={me.privacy[key] !== false} onChange={(e) => save({ privacy: { [key]: e.target.checked } })} />
          </label>
        ))}
        <label className="flex items-center justify-between gap-3 py-1 text-sm">
          Demandes d’amitié
          <select value={String(me.privacy.friendRequests)} onChange={(e) => save({ privacy: { friendRequests: e.target.value } })} className="field w-auto py-1">
            <option value="EVERYONE">De tout le monde</option>
            <option value="NOBODY">Personne</option>
          </select>
        </label>
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Bell className="size-4 text-accent" /> Notifications reçues</h2>
        {me.notifications.map((n) => (
          <label key={n.type} className="flex items-center justify-between gap-3 py-1 text-sm">
            <span>{n.label}{n.mandatory && <span className="text-xs text-ink-muted"> (obligatoire)</span>}</span>
            <input
              type="checkbox"
              checked={n.enabled}
              disabled={n.mandatory}
              onChange={(e) => save({ disabledNotifications: e.target.checked ? disabled.filter((t) => t !== n.type) : [...disabled, n.type] })}
            />
          </label>
        ))}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold">Joueurs bloqués</h2>
        {blocked.length === 0 ? (
          <p className="text-sm text-ink-muted">Aucun. Un joueur bloqué ne peut plus vous écrire, vous défier ni voir votre profil.</p>
        ) : (
          <ul className="divide-y divide-line">
            {blocked.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-2">
                <Avatar user={b} size={28} />
                <span className="flex-1 text-sm">{b.username}</span>
                <button type="button" onClick={async () => { await api("/api/community/friends", { method: "POST", json: { action: "unblock", target: b.id } }); await load(); }} className="btn btn-ghost min-h-0 px-2.5 py-1 text-xs">Débloquer</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3 p-4 lg:col-span-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Crown className="size-4 text-gold" /> Privilèges communautaires · {me.premium.tier}</h2>
        <ul className="grid gap-1.5 text-sm text-ink-soft sm:grid-cols-2">
          <li>Salons privés : <strong>{me.premium.privateRooms}</strong></li>
          <li>Invitations groupées : <strong>{me.premium.maxBulkInvites}</strong> amis à la fois</li>
          <li>Épingler dans vos espaces : <strong>{me.premium.pinInOwnSpaces ? "oui" : "non"}</strong></li>
          <li>Personnalisation du profil : <strong>{me.premium.profileThemes ? "oui" : "non"}</strong></li>
          <li>Personnalisation de club : <strong>{me.premium.clubCustomization ? "oui" : "non"}</strong></li>
          <li>Statistiques avancées : <strong>{me.premium.communityStats ? "oui" : "non"}</strong></li>
        </ul>
        <p className="text-xs text-ink-muted">Publier, commenter, réagir, ajouter des amis et les défier restent gratuits pour tous. Aucun privilège n’influence le jeu.</p>
        {stats && (
          <div className="card-muted p-3">
            <p className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="size-4 text-accent" /> Vos 30 derniers jours</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              {[["Publications", stats.posts], ["Réactions reçues", stats.reactionsReceived], ["Commentaires reçus", stats.commentsReceived], ["Nouveaux amis", stats.newFriends]].map(([label, value]) => (
                <div key={label as string} className="rounded-lg bg-surface p-2">
                  <p className="tabular text-lg font-semibold">{value}</p>
                  <p className="text-xs text-ink-muted">{label}</p>
                </div>
              ))}
            </div>
            {stats.topPosts.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {stats.topPosts.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <Link href={`/communaute/publication/${p.id}`} className="truncate hover:text-accent">{p.title}</Link>
                    <span className="tabular shrink-0 text-xs text-ink-muted">{p.reactions} réactions · {p.comments} comm.</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
