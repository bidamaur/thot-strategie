"use client";

import {
  ChevronDown,
  EyeOff,
  Flag,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Swords,
  Trash2,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChallengeDialog, ReportDialog } from "./dialogs";
import { api, Avatar, Notice, PlayerName, RoomIcon, timeAgo, useLoadEffect, type AuthorLike } from "./shared";

export type ReactionType = "LIKE" | "BRAVO" | "INTERESTING" | "CONGRATS";

export const REACTION_META: Record<ReactionType, { label: string; emoji: string }> = {
  LIKE: { label: "J’aime", emoji: "👍" },
  BRAVO: { label: "Bravo", emoji: "👏" },
  INTERESTING: { label: "Intéressant", emoji: "💡" },
  CONGRATS: { label: "Félicitations", emoji: "🎉" },
};

export interface PostData {
  id: string;
  author: AuthorLike;
  room: { slug: string; name: string; icon: string | null } | null;
  club: { slug: string; name: string } | null;
  title: string | null;
  body: string;
  imageUrl: string | null;
  link: { type: "TOURNAMENT" | "CLUB"; label: string; detail: string; href: string; open: boolean } | null;
  isPinned: boolean;
  isHidden: boolean;
  commentCount: number;
  reactionCount: number;
  reactions: Partial<Record<ReactionType, number>>;
  myReaction: ReactionType | null;
  createdAt: string;
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
  canModerate: boolean;
  canPin: boolean;
  canComment: boolean;
}

interface CommentData {
  id: string;
  parentId: string | null;
  author: AuthorLike;
  body: string | null;
  removed: boolean;
  isHidden: boolean;
  reactionCount: number;
  replyCount: number;
  myReaction: ReactionType | null;
  createdAt: string;
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
}

export interface Viewer {
  id: string;
  username: string;
}

/** Texte avec retours à la ligne ; React échappe le contenu (aucun HTML injecté). */
function Body({ text, clamp }: { text: string; clamp?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const long = clamp && text.length > 420;
  return (
    <div>
      <p className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink-soft ${long && !expanded ? "line-clamp-6" : ""}`}>{text}</p>
      {long && (
        <button type="button" onClick={() => setExpanded(!expanded)} className="mt-1 text-sm font-medium text-accent hover:underline">
          {expanded ? "Réduire" : "Lire la suite"}
        </button>
      )}
    </div>
  );
}

function ReactionBar({
  counts,
  mine,
  total,
  disabled,
  onReact,
  compact = false,
}: {
  counts: Partial<Record<ReactionType, number>>;
  mine: ReactionType | null;
  total: number;
  disabled: boolean;
  onReact: (type: ReactionType | null) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const top = (Object.keys(REACTION_META) as ReactionType[]).filter((t) => (counts[t] ?? 0) > 0);
  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => (mine ? onReact(null) : setOpen((o) => !o))}
        aria-expanded={open}
        className={`btn min-h-0 px-2.5 py-1.5 text-xs ${mine ? "border border-accent/40 bg-accent/10 text-accent" : "btn-ghost"}`}
      >
        <span aria-hidden="true">{mine ? REACTION_META[mine].emoji : "👍"}</span>
        {mine ? REACTION_META[mine].label : "Réagir"}
      </button>
      {open && !mine && (
        <div className="absolute bottom-full left-0 z-20 mb-1.5 flex gap-1 rounded-full border border-line bg-surface p-1 shadow-lg animate-rise">
          {(Object.keys(REACTION_META) as ReactionType[]).map((t) => (
            <button
              key={t}
              type="button"
              title={REACTION_META[t].label}
              aria-label={REACTION_META[t].label}
              onClick={() => {
                setOpen(false);
                onReact(t);
              }}
              className="flex size-9 items-center justify-center rounded-full text-lg transition-transform hover:scale-110 hover:bg-surface-2"
            >
              {REACTION_META[t].emoji}
            </button>
          ))}
        </div>
      )}
      {!compact && total > 0 && (
        <span className="flex items-center gap-1 text-xs text-ink-muted" title={top.map((t) => `${REACTION_META[t].label} : ${counts[t]}`).join(" · ")}>
          <span aria-hidden="true">{top.map((t) => REACTION_META[t].emoji).join("")}</span>
          <span className="tabular">{total}</span>
        </span>
      )}
      {compact && total > 0 && <span className="tabular text-xs text-ink-muted">{total}</span>}
    </div>
  );
}

function Menu({ items }: { items: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label="Plus d’actions" aria-expanded={open} className="btn btn-ghost min-h-0 border-transparent p-1.5">
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <ul className="absolute right-0 z-30 mt-1 min-w-48 overflow-hidden rounded-xl border border-line bg-surface py-1 text-sm shadow-lg animate-rise">
          {items.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-2 ${item.danger ? "text-danger" : ""}`}
              >
                {item.icon}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Commentaires ──────────────────────────────────────────────────────

function CommentItem({
  comment,
  postId,
  viewer,
  canComment,
  onReply,
  onChanged,
}: {
  comment: CommentData;
  postId: string;
  viewer: Viewer | null;
  canComment: boolean;
  onReply?: (c: CommentData) => void;
  onChanged: (c: CommentData | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body ?? "");
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState("");
  const [showReplies, setShowReplies] = useState(false);

  async function save() {
    try {
      const { comment: updated } = await api<{ comment: CommentData }>(`/api/community/comments/${comment.id}`, { method: "PATCH", json: { body: draft } });
      onChanged(updated);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove() {
    if (!window.confirm("Supprimer ce commentaire ?")) return;
    try {
      await api(`/api/community/comments/${comment.id}`, { method: "DELETE" });
      onChanged(comment.replyCount > 0 ? { ...comment, removed: true, body: null, canEdit: false, canDelete: false } : null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function react(type: ReactionType | null) {
    try {
      const result = await api<{ reactionCount: number; myReaction: ReactionType | null }>(`/api/community/comments/${comment.id}/reaction`, { method: "POST", json: { type } });
      onChanged({ ...comment, reactionCount: result.reactionCount, myReaction: result.myReaction });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <li className="flex gap-2.5">
      <Avatar user={comment.author} size={30} />
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-surface-2 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <PlayerName user={comment.author} showElo={false} className="text-sm" />
            {viewer && !comment.removed && (
              <Menu
                items={[
                  ...(comment.canEdit ? [{ label: "Modifier", icon: <Pencil className="size-4" />, onClick: () => setEditing(true) }] : []),
                  ...(comment.canDelete ? [{ label: "Supprimer", icon: <Trash2 className="size-4" />, onClick: remove, danger: true }] : []),
                  ...(viewer.id !== comment.author.id ? [{ label: "Signaler", icon: <Flag className="size-4" />, onClick: () => setReporting(true) }] : []),
                ]}
              />
            )}
          </div>
          {comment.removed ? (
            <p className="text-sm italic text-ink-muted">Commentaire supprimé.</p>
          ) : editing ? (
            <div className="mt-1 space-y-2">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="field" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(false)} className="btn btn-ghost min-h-0 px-3 py-1 text-xs">Annuler</button>
                <button type="button" onClick={save} className="btn btn-primary min-h-0 px-3 py-1 text-xs">Enregistrer</button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm text-ink-soft">
              {comment.isHidden && <EyeOff className="mr-1 inline size-3.5 text-gold" aria-label="Masqué par la modération" />}
              {comment.body}
            </p>
          )}
        </div>
        {!comment.removed && (
          <div className="mt-1 flex items-center gap-3 px-1 text-xs text-ink-muted">
            <span>{timeAgo(comment.createdAt)}{comment.editedAt ? " · modifié" : ""}</span>
            {viewer && canComment && <ReactionBar counts={{}} mine={comment.myReaction} total={comment.reactionCount} disabled={false} onReact={react} compact />}
            {viewer && canComment && onReply && (
              <button type="button" onClick={() => onReply(comment)} className="font-medium hover:text-ink">Répondre</button>
            )}
          </div>
        )}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        {!comment.parentId && comment.replyCount > 0 && (
          <div className="mt-2">
            {showReplies ? (
              <CommentList postId={postId} parentId={comment.id} viewer={viewer} canComment={canComment} pageSize={20} />
            ) : (
              <button type="button" onClick={() => setShowReplies(true)} className="flex items-center gap-1 px-1 text-xs font-medium text-accent hover:underline">
                <ChevronDown className="size-3.5" /> Voir {comment.replyCount} réponse{comment.replyCount > 1 ? "s" : ""}
              </button>
            )}
          </div>
        )}
      </div>
      {reporting && <ReportDialog targetType="COMMENT" targetId={comment.id} onClose={() => setReporting(false)} />}
    </li>
  );
}

function CommentList({
  postId,
  parentId,
  viewer,
  canComment,
  pageSize = 10,
  onReply,
  appended = [],
}: {
  postId: string;
  parentId: string | null;
  viewer: Viewer | null;
  canComment: boolean;
  pageSize?: number;
  onReply?: (c: CommentData) => void;
  appended?: CommentData[];
}) {
  const [items, setItems] = useState<CommentData[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "error">("loading");

  const load = useCallback(
    async (next: string | null) => {
      setState("loading");
      try {
        const params = new URLSearchParams({ limit: String(pageSize) });
        if (parentId) params.set("parentId", parentId);
        if (next) params.set("cursor", next);
        const data = await api<{ items: CommentData[]; nextCursor: string | null }>(`/api/community/posts/${postId}/comments?${params}`);
        setItems((current) => (next ? [...current, ...data.items] : data.items));
        setCursor(data.nextCursor);
        setState("idle");
      } catch {
        setState("error");
      }
    },
    [pageSize, parentId, postId],
  );

  const initialLoad = useCallback(() => load(null), [load]);
  useLoadEffect(initialLoad);

  const all = [...items, ...appended.filter((a) => !items.some((i) => i.id === a.id))];
  return (
    <div className="space-y-2">
      <ul className="space-y-3">
        {all.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            postId={postId}
            viewer={viewer}
            canComment={canComment}
            onReply={onReply}
            onChanged={(updated) => setItems((list) => (updated ? list.map((x) => (x.id === updated.id ? updated : x)) : list.filter((x) => x.id !== c.id)))}
          />
        ))}
      </ul>
      {state === "loading" && <p className="text-xs text-ink-muted">Chargement des commentaires…</p>}
      {state === "error" && <p className="text-xs text-danger">Impossible de charger les commentaires.</p>}
      {cursor && state === "idle" && (
        <button type="button" onClick={() => load(cursor)} className="text-xs font-medium text-accent hover:underline">
          Voir plus de commentaires
        </button>
      )}
    </div>
  );
}

function CommentsSection({ post, viewer, onCountChange }: { post: PostData; viewer: Viewer | null; onCountChange: (delta: number) => void }) {
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<CommentData | null>(null);
  const [mine, setMine] = useState<CommentData[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function send() {
    if (!draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      const { comment } = await api<{ comment: CommentData }>(`/api/community/posts/${post.id}/comments`, {
        method: "POST",
        json: { body: draft, parentId: replyTo?.id },
      });
      if (!comment.parentId) setMine((list) => [...list, comment]);
      setDraft("");
      setReplyTo(null);
      onCountChange(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      <CommentList
        postId={post.id}
        parentId={null}
        viewer={viewer}
        canComment={post.canComment}
        appended={mine}
        onReply={(c) => {
          setReplyTo(c);
          inputRef.current?.focus();
        }}
      />
      {viewer && post.canComment ? (
        <div className="space-y-1.5">
          {replyTo && (
            <p className="flex items-center gap-2 text-xs text-ink-muted">
              Réponse à <strong>{replyTo.author.username}</strong>
              <button type="button" onClick={() => setReplyTo(null)} className="text-accent hover:underline">annuler</button>
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Écrire un commentaire…"
              className="field min-h-10 resize-none"
            />
            <button type="button" onClick={send} disabled={busy || !draft.trim()} className="btn btn-primary shrink-0">Envoyer</button>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      ) : !viewer ? (
        <p className="text-xs text-ink-muted">Connectez-vous pour commenter.</p>
      ) : null}
    </div>
  );
}

// ── Carte de publication ──────────────────────────────────────────────

export function PostCard({
  post: initial,
  viewer,
  expanded = false,
  onRemoved,
}: {
  post: PostData;
  viewer: Viewer | null;
  expanded?: boolean;
  onRemoved?: (id: string) => void;
}) {
  const [post, setPost] = useState(initial);
  const [showComments, setShowComments] = useState(expanded);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: initial.title ?? "", body: initial.body });
  const [reporting, setReporting] = useState(false);
  const [challenging, setChallenging] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function react(type: ReactionType | null) {
    try {
      const { post: updated } = await api<{ post: PostData }>(`/api/community/posts/${post.id}/reaction`, { method: "POST", json: { type } });
      setPost(updated);
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    }
  }
  async function save() {
    try {
      const { post: updated } = await api<{ post: PostData }>(`/api/community/posts/${post.id}`, { method: "PATCH", json: draft });
      setPost(updated);
      setEditing(false);
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    }
  }
  async function remove() {
    if (!window.confirm("Supprimer cette publication ?")) return;
    try {
      await api(`/api/community/posts/${post.id}`, { method: "DELETE" });
      onRemoved?.(post.id);
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    }
  }
  async function pin(pinned: boolean) {
    try {
      await api(`/api/community/posts/${post.id}/pin`, { method: "POST", json: { pinned } });
      setPost({ ...post, isPinned: pinned });
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    }
  }
  async function addFriend() {
    try {
      const result = await api<{ status: string }>("/api/community/friends", { method: "POST", json: { action: "request", target: post.author.id } });
      setNotice({ tone: "success", text: result.status === "ACCEPTED" ? "Vous êtes maintenant amis." : "Demande d’amitié envoyée." });
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    }
  }

  const isMine = viewer?.id === post.author.id;
  const menuItems = [
    ...(post.canEdit ? [{ label: "Modifier", icon: <Pencil className="size-4" />, onClick: () => setEditing(true) }] : []),
    ...(post.canPin ? [{ label: post.isPinned ? "Désépingler" : "Épingler", icon: post.isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />, onClick: () => pin(!post.isPinned) }] : []),
    ...(viewer && !isMine ? [{ label: `Ajouter ${post.author.username}`, icon: <UserPlus className="size-4" />, onClick: addFriend }] : []),
    ...(viewer && !isMine ? [{ label: "Signaler", icon: <Flag className="size-4" />, onClick: () => setReporting(true) }] : []),
    ...(post.canDelete ? [{ label: "Supprimer", icon: <Trash2 className="size-4" />, onClick: remove, danger: true }] : []),
  ];

  return (
    <article className={`card p-4 sm:p-5 ${post.isPinned ? "border-gold/30" : ""}`}>
      <header className="flex items-start gap-3">
        <Avatar user={post.author} size={42} />
        <div className="min-w-0 flex-1">
          <PlayerName user={post.author} />
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
            <Link href={`/communaute/publication/${post.id}`} className="hover:text-ink">{timeAgo(post.createdAt)}</Link>
            {post.editedAt && <span>· modifié</span>}
            {post.room && (
              <>
                <span>·</span>
                <Link href={`/communaute/salons/${post.room.slug}`} className="inline-flex items-center gap-1 hover:text-ink">
                  <RoomIcon icon={post.room.icon} className="size-3.5" /> {post.room.name}
                </Link>
              </>
            )}
            {post.club && (
              <>
                <span>·</span>
                <Link href={`/clubs/${post.club.slug}`} className="inline-flex items-center gap-1 hover:text-ink">
                  <Users className="size-3.5" /> {post.club.name}
                </Link>
              </>
            )}
          </p>
        </div>
        {post.isPinned && <span className="chip border-gold/40 text-gold"><Pin className="size-3" /> Épinglé</span>}
        {post.isHidden && <span className="chip border-gold/40 text-gold"><EyeOff className="size-3" /> Masqué</span>}
        {viewer && <Menu items={menuItems} />}
      </header>

      <div className="mt-3 space-y-3">
        {editing ? (
          <div className="space-y-2">
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={140} className="field" placeholder="Titre (facultatif)" />
            <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={5} className="field" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="btn btn-ghost">Annuler</button>
              <button type="button" onClick={save} className="btn btn-primary">Enregistrer</button>
            </div>
          </div>
        ) : (
          <>
            {post.title && <h3 className="text-base font-semibold leading-snug">{post.title}</h3>}
            <Body text={post.body} clamp={!expanded} />
          </>
        )}
        {post.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.imageUrl} alt="" loading="lazy" className="max-h-[480px] w-full rounded-xl border border-line object-contain bg-surface-2" />
        )}
        {post.link && (
          <Link href={post.link.href} className="card-muted flex items-center gap-3 p-3 transition-colors hover:border-accent/40">
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
              {post.link.type === "TOURNAMENT" ? <Trophy className="size-5" /> : <Users className="size-5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{post.link.label}</span>
              <span className="text-xs text-ink-muted">{post.link.detail}</span>
            </span>
            <span className="btn btn-primary min-h-0 px-3 py-1.5 text-xs">
              {post.link.type === "TOURNAMENT" ? (post.link.open ? "Rejoindre" : "Voir") : "Voir le club"}
            </span>
          </Link>
        )}
      </div>

      {notice && <div className="mt-3"><Notice tone={notice.tone}>{notice.text}</Notice></div>}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        {viewer ? (
          <ReactionBar counts={post.reactions} mine={post.myReaction} total={post.reactionCount} disabled={!post.canComment} onReact={react} />
        ) : (
          post.reactionCount > 0 && <span className="text-xs text-ink-muted">{post.reactionCount} réaction(s)</span>
        )}
        <button type="button" onClick={() => setShowComments(!showComments)} aria-expanded={showComments} className="btn btn-ghost min-h-0 px-2.5 py-1.5 text-xs">
          <MessageCircle className="size-4" />
          {post.commentCount > 0 ? `${post.commentCount} commentaire${post.commentCount > 1 ? "s" : ""}` : "Commenter"}
        </button>
        {viewer && !isMine && (
          <button type="button" onClick={() => setChallenging(true)} className="btn btn-ghost ml-auto min-h-0 px-2.5 py-1.5 text-xs">
            <Swords className="size-4" /> Défier
          </button>
        )}
      </footer>

      {showComments && (
        <CommentsSection post={post} viewer={viewer} onCountChange={(delta) => setPost((p) => ({ ...p, commentCount: p.commentCount + delta }))} />
      )}
      {reporting && <ReportDialog targetType="POST" targetId={post.id} onClose={() => setReporting(false)} />}
      {challenging && <ChallengeDialog opponent={post.author} onClose={() => setChallenging(false)} />}
    </article>
  );
}
