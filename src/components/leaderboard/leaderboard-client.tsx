"use client";

import { Medal } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page-header";

const VARIANTS = [
  { id: "INTERNATIONAL", label: "Dames 10×10" },
  { id: "ENGLISH", label: "Dames 8×8" },
  { id: "CHESS", label: "Échecs" },
] as const;

const CADENCES = [
  { id: "BLITZ", label: "Blitz" },
  { id: "RAPID", label: "Rapide" },
  { id: "CLASSICAL", label: "Classique" },
  { id: "BULLET", label: "Bullet" },
  { id: "UNLIMITED", label: "Sans pendule" },
] as const;

interface Row {
  position: number;
  user: { id: string; username: string; avatar: string | null; country: string | null; city: string | null };
  rating: { eloRating: number; gamesPlayed: number; wins: number; losses: number; draws: number; provisional: boolean; level: string };
}

export function LeaderboardClient() {
  const [variant, setVariant] = useState<string>("INTERNATIONAL");
  const [cadence, setCadence] = useState<string>("BLITZ");
  const [provisional, setProvisional] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [me, setMe] = useState<{ eloRating: number; gamesPlayed: number; provisional: boolean; level: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setRows(null);
    setError("");
    const params = new URLSearchParams({ variant, timeControl: cadence, limit: "100" });
    if (provisional) params.set("provisional", "1");
    fetch(`/api/player/leaderboard?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? "Erreur de chargement.");
        setRows(json.leaderboard);
        setMe(json.userPosition);
      })
      .catch((caught: Error) => {
        if (caught.name !== "AbortError") setError(caught.message);
      });
    return () => controller.abort();
  }, [variant, cadence, provisional]);

  return (
    <PageShell width="max-w-5xl">
      <PageHeader
        eyebrow="Classements ALO/ELO"
        title="Les meilleurs joueurs"
        description="Un classement par jeu et par cadence, calculé uniquement côté serveur à partir des parties classées."
      />

      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {VARIANTS.map((v) => (
            <button key={v.id} type="button" onClick={() => setVariant(v.id)} className={`btn min-h-0 px-3 py-1.5 ${variant === v.id ? "btn-primary" : "btn-ghost"}`}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} className="field w-auto py-1.5" aria-label="Cadence">
            {CADENCES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 px-2 text-xs text-ink-muted">
            <input type="checkbox" checked={provisional} onChange={(e) => setProvisional(e.target.checked)} className="accent-[var(--accent)]" />
            Inclure provisoires
          </label>
        </div>
      </div>

      {me && (
        <div className="card-muted flex items-center justify-between px-4 py-3 text-sm">
          <span className="text-ink-muted">Votre classement dans cette catégorie</span>
          <span className="tabular font-semibold">
            {me.eloRating}{me.provisional ? "?" : ""} · {me.level} · {me.gamesPlayed} parties
          </span>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
      {!rows && !error && <div className="card h-64 animate-pulse" />}
      {rows && rows.length === 0 && (
        <EmptyState title="Aucun joueur classé dans cette catégorie">
          Les classements apparaissent après les premières parties classées{provisional ? "" : " confirmées"}.
        </EmptyState>
      )}
      {rows && rows.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-ink-muted">
              <tr>
                <th className="w-12 px-4 py-3 font-medium">#</th>
                <th className="px-2 py-3 font-medium">Joueur</th>
                <th className="hidden px-2 py-3 font-medium sm:table-cell">Niveau</th>
                <th className="hidden px-2 py-3 text-right font-medium md:table-cell">V / N / D</th>
                <th className="px-4 py-3 text-right font-medium">ELO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.user.id} className="transition-colors hover:bg-surface-2">
                  <td className="tabular px-4 py-2.5 text-ink-muted">
                    {row.position <= 3 ? <Medal className={`size-4 ${row.position === 1 ? "text-gold" : row.position === 2 ? "text-zinc-300" : "text-amber-500"}`} /> : row.position}
                  </td>
                  <td className="px-2 py-2.5">
                    <span className="font-medium">{row.user.username}</span>
                    {(row.user.city || row.user.country) && (
                      <span className="block text-xs text-ink-muted">{[row.user.city, row.user.country].filter(Boolean).join(", ")}</span>
                    )}
                  </td>
                  <td className="hidden px-2 py-2.5 text-ink-soft sm:table-cell">{row.rating.level}</td>
                  <td className="tabular hidden px-2 py-2.5 text-right text-ink-muted md:table-cell">
                    {row.rating.wins} / {row.rating.draws} / {row.rating.losses}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right font-semibold">
                    {row.rating.eloRating}{row.rating.provisional && <span className="text-ink-muted">?</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
