"use client";

import { Ban, Check, Eye, EyeOff, Flag, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * Administration de la communauté : salons (création, renommage, activation,
 * permissions) et espace de modération (signalements, sanctions).
 * Les limites et options (taille, fréquences, images…) sont dans Paramètres › Communauté.
 */

interface AdminRoom {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  isActive: boolean;
  visibility: "PUBLIC" | "PRIVATE";
  postPermission: "EVERYONE" | "MEMBERS" | "MODERATORS";
  commentsEnabled: boolean;
  sortOrder: number;
  postCount: number | null;
  memberCount: number | null;
  owner: string | null;
}

interface Report {
  id: string;
  targetType: "POST" | "COMMENT" | "USER";
  reasonLabel: string;
  details: string | null;
  status: string;
  resolution: string | null;
  createdAt: string;
  reporter: string;
  resolvedBy: string | null;
  targetUser: { username: string } | null;
  post: { id: string; title: string | null; body: string; isHidden: boolean; deleted: boolean; imageUrl: string | null } | null;
  comment: { id: string; body: string; isHidden: boolean; deleted: boolean; postId: string } | null;
}

interface Sanction {
  id: string;
  username: string;
  type: "WARNING" | "MUTE" | "SUSPENSION";
  reason: string;
  issuedBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  active: boolean;
}

const ICONS = ["chat", "chess", "draughts", "swords", "trophy", "shield", "target", "news", "lock", "star"];

async function call<T>(url: string, init?: { method?: string; json?: unknown }): Promise<T> {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    cache: "no-store",
    headers: init?.json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error ?? "Action impossible.");
  return data as T;
}

function RoomRow({ room, onSaved }: { room: AdminRoom; onSaved: (message: string, error?: boolean) => void }) {
  const [draft, setDraft] = useState(room);
  const dirty = JSON.stringify(draft) !== JSON.stringify(room);
  async function save() {
    try {
      await call(`/api/admin/community/rooms/${room.id}`, {
        method: "PATCH",
        json: {
          name: draft.name,
          description: draft.description ?? "",
          icon: draft.icon,
          isActive: draft.isActive,
          postPermission: draft.postPermission,
          commentsEnabled: draft.commentsEnabled,
          sortOrder: draft.sortOrder,
          visibility: draft.visibility,
        },
      });
      onSaved(`Salon « ${draft.name} » enregistré.`);
    } catch (e) {
      onSaved((e as Error).message, true);
    }
  }
  async function remove() {
    if (!window.confirm(`Supprimer définitivement « ${room.name} » ? Les publications restent mais ne seront plus rattachées à un salon. Préférez la désactivation.`)) return;
    try {
      await call(`/api/admin/community/rooms/${room.id}`, { method: "DELETE" });
      onSaved("Salon supprimé.");
    } catch (e) {
      onSaved((e as Error).message, true);
    }
  }
  return (
    <tr className="border-t border-line align-top">
      <td className="p-2">
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="field py-1" aria-label="Nom" />
        <input value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="field mt-1 py-1 text-xs" placeholder="Description" aria-label="Description" />
        <p className="mt-1 text-[11px] text-ink-muted">/{room.slug} · {room.postCount ?? 0} publ. · {room.memberCount ?? 0} membres{room.owner ? ` · créé par ${room.owner}` : ""}</p>
      </td>
      <td className="p-2">
        <select value={draft.icon ?? "chat"} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} className="field py-1" aria-label="Icône">
          {ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </td>
      <td className="p-2">
        <select value={draft.postPermission} onChange={(e) => setDraft({ ...draft, postPermission: e.target.value as AdminRoom["postPermission"] })} className="field py-1" aria-label="Qui publie">
          <option value="EVERYONE">Tout le monde</option>
          <option value="MEMBERS">Membres du salon</option>
          <option value="MODERATORS">Modérateurs seulement</option>
        </select>
        <select value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value as AdminRoom["visibility"] })} className="field mt-1 py-1" aria-label="Visibilité">
          <option value="PUBLIC">Public</option>
          <option value="PRIVATE">Privé</option>
        </select>
      </td>
      <td className="space-y-1 p-2 text-xs">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} /> Actif</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={draft.commentsEnabled} onChange={(e) => setDraft({ ...draft, commentsEnabled: e.target.checked })} /> Commentaires</label>
        <input type="number" min={0} value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} className="field w-20 py-1" aria-label="Ordre" />
      </td>
      <td className="p-2">
        <div className="flex gap-1">
          <button type="button" disabled={!dirty} onClick={save} className="btn btn-primary min-h-0 px-2 py-1" aria-label="Enregistrer"><Save className="size-4" /></button>
          <button type="button" onClick={remove} className="btn btn-danger min-h-0 px-2 py-1" aria-label="Supprimer"><Trash2 className="size-4" /></button>
        </div>
      </td>
    </tr>
  );
}

export function AdminCommunity() {
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [sanctions, setSanctions] = useState<Sanction[]>([]);
  const [stats, setStats] = useState<{ openReports: number; hiddenPosts: number; activeSanctions: number; posts24h: number } | null>(null);
  const [status, setStatus] = useState<"OPEN" | "RESOLVED" | "DISMISSED">("OPEN");
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [newRoom, setNewRoom] = useState({ name: "", description: "", icon: "chat", postPermission: "EVERYONE" });
  const [sanction, setSanction] = useState({ userId: "", type: "MUTE", reason: "", durationHours: "24" });

  const load = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([
        call<{ rooms: AdminRoom[] }>("/api/admin/community/rooms"),
        call<{ reports: Report[]; sanctions: Sanction[]; stats: NonNullable<typeof stats> }>(`/api/admin/community/moderation?status=${status}`),
      ]);
      setRooms(r.rooms);
      setReports(m.reports);
      setSanctions(m.sanctions);
      setStats(m.stats);
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  }, [status]);
  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const done = (text: string, error = false) => {
    setMessage({ text, error });
    void load();
  };

  async function moderate(body: Record<string, unknown>, success: string) {
    try {
      await call("/api/admin/community/moderation", { method: "POST", json: body });
      done(success);
    } catch (e) {
      done((e as Error).message, true);
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <p role="status" className={`rounded-xl border px-4 py-2 text-sm ${message.error ? "border-danger/30 bg-danger/10 text-danger" : "border-accent/30 bg-accent/10 text-accent"}`}>{message.text}</p>
      )}

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Signalements ouverts", stats.openReports],
            ["Contenus masqués", stats.hiddenPosts],
            ["Sanctions actives", stats.activeSanctions],
            ["Publications (24 h)", stats.posts24h],
          ].map(([label, value]) => (
            <div key={label as string} className="card p-4">
              <p className="text-xs text-ink-muted">{label}</p>
              <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Flag className="size-4 text-danger" /> Signalements</h2>
          <div className="flex gap-1 text-xs">
            {(["OPEN", "RESOLVED", "DISMISSED"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setStatus(s)} className={`rounded-lg px-2.5 py-1 ${status === s ? "bg-surface-3 text-ink" : "text-ink-muted"}`}>
                {s === "OPEN" ? "À traiter" : s === "RESOLVED" ? "Sanctionnés" : "Classés"}
              </button>
            ))}
            <button type="button" onClick={() => void load()} className="rounded-lg px-2 py-1 text-ink-muted" aria-label="Actualiser"><RefreshCw className="size-3.5" /></button>
          </div>
        </div>
        {reports.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Aucun signalement.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {reports.map((r) => {
              const content = r.post ?? r.comment;
              return (
                <li key={r.id} className="card-muted p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    <span className="chip">{r.targetType === "POST" ? "Publication" : r.targetType === "COMMENT" ? "Commentaire" : "Joueur"}</span>
                    <strong className="text-ink">{r.reasonLabel}</strong>
                    <span>signalé par {r.reporter}</span>
                    {r.targetUser && <span>· auteur : <strong>{r.targetUser.username}</strong></span>}
                    <span>· {new Date(r.createdAt).toLocaleString("fr-FR")}</span>
                    {r.resolvedBy && <span>· traité par {r.resolvedBy}</span>}
                  </div>
                  {r.details && <p className="mt-1 italic text-ink-soft">« {r.details} »</p>}
                  {content && (
                    <blockquote className="mt-2 whitespace-pre-wrap rounded-lg border-l-2 border-line-strong bg-surface px-3 py-2 text-ink-soft">
                      {r.post?.title && <strong className="block">{r.post.title}</strong>}
                      {content.body}
                      {(content.isHidden || content.deleted) && <span className="mt-1 block text-xs text-gold">{content.deleted ? "Supprimé" : "Masqué"}</span>}
                    </blockquote>
                  )}
                  {r.status === "OPEN" ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {content && (
                        <>
                          <button type="button" onClick={() => moderate({ action: "resolve", reportId: r.id, decision: "HIDE" }, "Contenu masqué.")} className="btn btn-ghost min-h-0 px-2.5 py-1 text-xs"><EyeOff className="size-3.5" /> Masquer</button>
                          <button type="button" onClick={() => moderate({ action: "resolve", reportId: r.id, decision: "DELETE" }, "Contenu supprimé.")} className="btn btn-danger min-h-0 px-2.5 py-1 text-xs"><Trash2 className="size-3.5" /> Supprimer</button>
                          {content.isHidden && (
                            <button type="button" onClick={() => moderate({ action: "resolve", reportId: r.id, decision: "RESTORE" }, "Contenu rétabli.")} className="btn btn-ghost min-h-0 px-2.5 py-1 text-xs"><Eye className="size-3.5" /> Rétablir</button>
                          )}
                        </>
                      )}
                      <button type="button" onClick={() => moderate({ action: "resolve", reportId: r.id, decision: "DISMISS" }, "Signalement classé.")} className="btn btn-ghost min-h-0 px-2.5 py-1 text-xs"><Check className="size-3.5" /> Classer sans suite</button>
                      {r.targetUser && (
                        <button type="button" onClick={() => setSanction({ ...sanction, userId: r.targetUser!.username, reason: r.reasonLabel })} className="btn btn-ghost min-h-0 px-2.5 py-1 text-xs"><Ban className="size-3.5" /> Sanctionner</button>
                      )}
                    </div>
                  ) : (
                    r.resolution && <p className="mt-2 text-xs text-ink-muted">Décision : {r.resolution}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Ban className="size-4 text-danger" /> Sanctions</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_150px_1fr_120px_auto]">
          <input value={sanction.userId} onChange={(e) => setSanction({ ...sanction, userId: e.target.value })} className="field" placeholder="Pseudo du joueur" aria-label="Pseudo" />
          <select value={sanction.type} onChange={(e) => setSanction({ ...sanction, type: e.target.value })} className="field" aria-label="Type">
            <option value="WARNING">Avertissement</option>
            <option value="MUTE">Restriction (ne peut plus publier)</option>
            <option value="SUSPENSION">Suspension communautaire</option>
          </select>
          <input value={sanction.reason} onChange={(e) => setSanction({ ...sanction, reason: e.target.value })} className="field" placeholder="Motif (communiqué au joueur)" aria-label="Motif" />
          <input value={sanction.durationHours} onChange={(e) => setSanction({ ...sanction, durationHours: e.target.value })} className="field" placeholder="Durée (h), vide = illimitée" aria-label="Durée en heures" />
          <button
            type="button"
            onClick={() => moderate({ action: "sanction", ...sanction }, "Sanction appliquée et notifiée au joueur.")}
            disabled={!sanction.userId || sanction.reason.length < 3}
            className="btn btn-danger"
          >
            Appliquer
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-muted">Les sanctions portent sur l’espace communautaire (publier, commenter, réagir, demander en ami, défier). Elles n’affectent ni les parties ni les portefeuilles.</p>
        {sanctions.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-xs text-ink-muted">
                <tr><th className="p-2 text-left">Joueur</th><th className="p-2 text-left">Type</th><th className="p-2 text-left">Motif</th><th className="p-2 text-left">Jusqu’au</th><th className="p-2 text-left">Par</th><th /></tr>
              </thead>
              <tbody>
                {sanctions.map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="p-2 font-medium">{s.username}</td>
                    <td className="p-2">{s.type === "WARNING" ? "Avertissement" : s.type === "MUTE" ? "Restriction" : "Suspension"}</td>
                    <td className="p-2 text-ink-soft">{s.reason}</td>
                    <td className="p-2 text-xs text-ink-muted">{s.revokedAt ? "Levée" : s.expiresAt ? new Date(s.expiresAt).toLocaleString("fr-FR") : s.type === "WARNING" ? "—" : "Illimitée"}</td>
                    <td className="p-2 text-xs text-ink-muted">{s.issuedBy ?? "—"}</td>
                    <td className="p-2">{s.active && <button type="button" onClick={() => moderate({ action: "revoke", sanctionId: s.id }, "Sanction levée.")} className="btn btn-ghost min-h-0 px-2 py-1 text-xs"><X className="size-3.5" /> Lever</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-4">
        <h2 className="text-base font-semibold">Salons et catégories</h2>
        <p className="mt-1 text-xs text-ink-muted">Chaque salon sert aussi de catégorie de publication. Désactiver un salon le masque sans supprimer ses publications.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-xs text-ink-muted">
              <tr><th className="p-2 text-left">Nom et description</th><th className="p-2 text-left">Icône</th><th className="p-2 text-left">Permissions</th><th className="p-2 text-left">État / ordre</th><th /></tr>
            </thead>
            <tbody>
              {rooms.map((room) => <RoomRow key={`${room.id}-${room.name}-${room.isActive}-${room.sortOrder}`} room={room} onSaved={done} />)}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-2 border-t border-line pt-4 md:grid-cols-[1fr_1.4fr_120px_180px_auto]">
          <input value={newRoom.name} onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })} className="field" placeholder="Nouveau salon" aria-label="Nom du nouveau salon" />
          <input value={newRoom.description} onChange={(e) => setNewRoom({ ...newRoom, description: e.target.value })} className="field" placeholder="Description" aria-label="Description du nouveau salon" />
          <select value={newRoom.icon} onChange={(e) => setNewRoom({ ...newRoom, icon: e.target.value })} className="field" aria-label="Icône">
            {ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <select value={newRoom.postPermission} onChange={(e) => setNewRoom({ ...newRoom, postPermission: e.target.value })} className="field" aria-label="Qui publie">
            <option value="EVERYONE">Tout le monde publie</option>
            <option value="MODERATORS">Annonces (modérateurs)</option>
          </select>
          <button
            type="button"
            disabled={newRoom.name.trim().length < 3}
            onClick={async () => {
              try {
                await call("/api/admin/community/rooms", { method: "POST", json: { ...newRoom, sortOrder: (rooms.at(-1)?.sortOrder ?? 0) + 10 } });
                setNewRoom({ name: "", description: "", icon: "chat", postPermission: "EVERYONE" });
                done("Salon créé.");
              } catch (e) {
                done((e as Error).message, true);
              }
            }}
            className="btn btn-primary"
          >
            <Plus className="size-4" /> Créer
          </button>
        </div>
      </section>
    </div>
  );
}
