"use client";

import { Lock, MapPin, Plus, Search, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page-header";

interface ClubSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  country: string | null;
  city: string | null;
  accentColor: string | null;
  isPrivate: boolean;
  maxMembers: number;
  owner: { username: string };
  _count: { members: number; tournaments: number };
  isMember: boolean;
}

export function ClubsClient() {
  const [clubs, setClubs] = useState<ClubSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", city: "", country: "" });
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback((q: string) => {
    const params = q ? `?q=${encodeURIComponent(q)}` : "";
    fetch(`/api/clubs${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => setClubs(json.clubs ?? []))
      .catch(() => setClubs([]));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => load(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query, load]);

  async function createClub(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const response = await fetch("/api/clubs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const json = await response.json().catch(() => ({}));
    setSubmitting(false);
    if (!response.ok) {
      setMessage(json.error ?? "Création impossible.");
      return;
    }
    window.location.href = `/clubs/${json.club.slug}`;
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Communauté"
        title="Clubs"
        description="Rejoignez un club pour jouer ses championnats internes, suivre son classement et représenter votre quartier ou votre ville."
        actions={
          <button type="button" onClick={() => setShowCreate((v) => !v)} className="btn btn-primary">
            <Plus className="size-4" /> Créer un club
          </button>
        }
      />

      {showCreate && (
        <form onSubmit={createClub} className="card grid gap-3 p-5 animate-rise sm:grid-cols-2">
          <label className="text-xs font-medium text-ink-muted sm:col-span-2">
            Nom du club
            <input required minLength={3} maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="field mt-1.5" />
          </label>
          <label className="text-xs font-medium text-ink-muted sm:col-span-2">
            Présentation
            <textarea maxLength={1000} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="field mt-1.5 resize-y" />
          </label>
          <label className="text-xs font-medium text-ink-muted">
            Ville
            <input maxLength={80} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="field mt-1.5" />
          </label>
          <label className="text-xs font-medium text-ink-muted">
            Pays
            <input maxLength={80} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="field mt-1.5" />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" disabled={submitting} className="btn btn-primary">
              {submitting ? "Création…" : "Créer le club"}
            </button>
            <p className="text-xs text-ink-muted">Création : membres Premium, ou joueurs disposant du minimum de points fixé par l’administration.</p>
          </div>
          {message && <p className="text-sm text-danger sm:col-span-2">{message}</p>}
        </form>
      )}

      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un club, une ville, un pays…" className="field pl-9" />
      </label>

      {!clubs && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="card h-36 animate-pulse" />)}</div>}
      {clubs && clubs.length === 0 && <EmptyState title="Aucun club trouvé">Soyez le premier à fonder un club dans votre ville.</EmptyState>}
      {clubs && clubs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map((club) => (
            <Link key={club.id} href={`/clubs/${club.slug}`} className="card group flex flex-col p-5 transition hover:border-line-strong">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-accent-ink"
                    style={{ background: club.accentColor ?? "var(--accent)" }}
                  >
                    {club.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold group-hover:text-accent">{club.name}</h2>
                    <p className="truncate text-xs text-ink-muted">par {club.owner.username}</p>
                  </div>
                </div>
                {club.isMember ? <span className="chip chip-rated">Membre</span> : club.isPrivate ? <Lock className="size-4 text-ink-muted" /> : null}
              </div>
              {club.description && <p className="mt-3 line-clamp-2 text-sm text-ink-soft">{club.description}</p>}
              <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-4 text-xs text-ink-muted">
                <span className="flex items-center gap-1"><Users className="size-3.5" /> {club._count.members}/{club.maxMembers}</span>
                <span className="flex items-center gap-1"><Trophy className="size-3.5" /> {club._count.tournaments}</span>
                {(club.city || club.country) && (
                  <span className="flex items-center gap-1"><MapPin className="size-3.5" /> {[club.city, club.country].filter(Boolean).join(", ")}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}
