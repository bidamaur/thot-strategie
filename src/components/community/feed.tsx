"use client";

import { ImagePlus, Link2, Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PostCard, type PostData, type Viewer } from "./post-card";
import { api, Avatar, Notice, Spinner, useLoadEffect } from "./shared";
import { EmptyState } from "@/components/ui/page-header";

export interface RoomOption {
  slug: string;
  name: string;
  access: { canPost: boolean } | null;
}

export interface Attachment {
  type: "TOURNAMENT" | "CLUB";
  id: string;
  label: string;
}

export function Composer({
  viewer,
  rooms,
  fixedRoom,
  club,
  attachment,
  onPosted,
}: {
  viewer: Viewer & { avatar?: string | null };
  rooms: RoomOption[];
  fixedRoom?: string;
  club?: string;
  attachment?: Attachment | null;
  onPosted: (post: PostData) => void;
}) {
  const postable = rooms.filter((r) => r.access?.canPost);
  const [open, setOpen] = useState(!!attachment);
  const [room, setRoom] = useState(fixedRoom ?? postable[0]?.slug ?? "general");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [link, setLink] = useState<Attachment | null>(attachment ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Salon effectif : celui choisi s'il reste autorisé, sinon le premier disponible.
  const targetRoom = fixedRoom ?? (postable.some((r) => r.slug === room) ? room : postable[0]?.slug ?? "general");

  async function upload(file: File) {
    setError("");
    const form = new FormData();
    form.append("image", file);
    try {
      const { url } = await api<{ url: string }>("/api/community/uploads", { method: "POST", body: form });
      setImageUrl(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const { post } = await api<{ post: PostData }>("/api/community/posts", {
        method: "POST",
        json: {
          room: club ? undefined : targetRoom,
          club,
          title,
          body,
          imageUrl,
          linkType: link?.type,
          linkId: link?.id,
        },
      });
      onPosted(post);
      setTitle("");
      setBody("");
      setImageUrl(null);
      setLink(null);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="card flex w-full items-center gap-3 p-3 text-left text-sm text-ink-muted transition-colors hover:border-line-strong">
        <Avatar user={{ username: viewer.username, avatar: viewer.avatar ?? null }} size={36} />
        <span className="flex-1">Partagez une partie, une idée, une question…</span>
        <span className="btn btn-primary min-h-0 px-3 py-1.5">Publier</span>
      </button>
    );
  }

  return (
    <div className="card space-y-3 p-4">
      {!fixedRoom && !club && (
        <label className="block text-sm">
          <span className="eyebrow">Salon</span>
          <select value={targetRoom} onChange={(e) => setRoom(e.target.value)} className="field mt-1.5">
            {postable.map((r) => (
              <option key={r.slug} value={r.slug}>{r.name}</option>
            ))}
          </select>
        </label>
      )}
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} className="field" placeholder="Titre (facultatif)" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="field" placeholder="Votre message…" autoFocus />
      {imageUrl && (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="max-h-48 rounded-xl border border-line" />
          <button type="button" onClick={() => setImageUrl(null)} className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white" aria-label="Retirer l’image">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {link && (
        <p className="chip">
          <Link2 className="size-3.5" /> {link.label}
          <button type="button" onClick={() => setLink(null)} aria-label="Retirer le lien"><X className="size-3" /></button>
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-ghost min-h-0 px-2.5 py-1.5" aria-label="Ajouter une image">
          <ImagePlus className="size-4" /> <span className="hidden sm:inline">Image</span>
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost ml-auto">Annuler</button>
        <button type="button" onClick={submit} disabled={busy || body.trim().length < 2} className="btn btn-primary">
          <Send className="size-4" /> Publier
        </button>
      </div>
    </div>
  );
}

/** Fil paginé (chargement progressif, aucune requête tant que la page n'est pas affichée). */
export function Feed({
  viewer,
  query,
  rooms,
  fixedRoom,
  club,
  attachment,
  showComposer = true,
  emptyTitle = "Aucune publication pour l’instant",
}: {
  viewer: (Viewer & { avatar?: string | null }) | null;
  query: Record<string, string>;
  rooms: RoomOption[];
  fixedRoom?: string;
  club?: string;
  attachment?: Attachment | null;
  showComposer?: boolean;
  emptyTitle?: string;
}) {
  const [posts, setPosts] = useState<PostData[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "error">("loading");
  const [error, setError] = useState("");
  const [canPost, setCanPost] = useState<boolean | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const queryKey = JSON.stringify(query);

  const load = useCallback(
    async (next: string | null) => {
      setState("loading");
      try {
        const params = new URLSearchParams({ ...JSON.parse(queryKey), limit: "10" });
        if (next) params.set("cursor", next);
        const data = await api<{ items: PostData[]; nextCursor: string | null; space: { canPost: boolean } | null }>(`/api/community/feed?${params}`);
        setPosts((list) => (next ? [...list, ...data.items.filter((p) => !list.some((x) => x.id === p.id))] : data.items));
        setCursor(data.nextCursor);
        if (data.space) setCanPost(data.space.canPost);
        setState("idle");
      } catch (e) {
        setError((e as Error).message);
        setState("error");
      }
    },
    [queryKey],
  );

  const initialLoad = useCallback(() => load(null), [load]);
  useLoadEffect(initialLoad);

  // Chargement progressif quand le bas du fil devient visible.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor || state !== "idle") return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void load(cursor), { rootMargin: "400px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, load, state]);

  const composerAllowed = viewer && showComposer && (canPost ?? rooms.some((r) => r.access?.canPost));

  return (
    <div className="space-y-4">
      {composerAllowed && (
        <Composer
          viewer={viewer}
          rooms={rooms}
          fixedRoom={fixedRoom}
          club={club}
          attachment={attachment}
          onPosted={(post) => setPosts((list) => [post, ...list])}
        />
      )}
      {posts.map((post) => (
        <PostCard key={post.id} post={post} viewer={viewer} onRemoved={(id) => setPosts((list) => list.filter((p) => p.id !== id))} />
      ))}
      {state === "loading" && <Spinner label="Chargement des publications…" />}
      {state === "error" && <Notice tone="error">{error}</Notice>}
      {state === "idle" && posts.length === 0 && (
        <EmptyState title={emptyTitle}>{viewer ? "Lancez la discussion !" : "Connectez-vous pour participer."}</EmptyState>
      )}
      <div ref={sentinel} aria-hidden="true" />
      {cursor && state === "idle" && (
        <div className="text-center">
          <button type="button" onClick={() => load(cursor)} className="btn btn-ghost">Voir plus</button>
        </div>
      )}
    </div>
  );
}
