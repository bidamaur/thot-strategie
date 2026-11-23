"use client";

import { CalendarClock, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Heatmap } from "@/lib/availability/compute";

const h = (n: number) => `${String(n).padStart(2, "0")}h`;

/**
 * Synthèse des disponibilités des participants d'un tournoi pas encore commencé :
 * nombre de joueurs disponibles par jour et par heure (dans le fuseau du lecteur),
 * meilleurs créneaux mis en avant. Purement indicatif : les horaires officiels
 * restent décidés par l'organisateur.
 */
export function TournamentAvailability({ tournamentId, isOrganizer }: { tournamentId: string; isOrganizer: boolean }) {
  const [state, setState] = useState<{ heatmap: Heatmap } | { error: string } | null>(null);

  useEffect(() => {
    let active = true;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Africa/Douala";
    fetch(`/api/tournaments/${tournamentId}/availability?tz=${encodeURIComponent(tz)}`, { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json().catch(() => ({}));
        if (!active) return;
        if (!r.ok) setState({ error: json.error ?? "Synthèse indisponible." });
        else if (json.available) setState({ heatmap: json.heatmap });
        else setState({ error: json.reason ?? "Synthèse indisponible." });
      })
      .catch(() => active && setState({ error: "Synthèse indisponible." }));
    return () => {
      active = false;
    };
  }, [tournamentId]);

  if (!state) return <section className="card h-40 animate-pulse" aria-busy="true" />;
  if ("error" in state) return null;
  const m = state.heatmap;

  return (
    <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="dispo-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="dispo-title" className="flex items-center gap-2 text-base font-semibold">
            <CalendarClock className="size-4 text-accent" /> Disponibilités des participants
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {m.withAvailability} participant{m.withAvailability > 1 ? "s" : ""} sur {m.participants} {m.withAvailability > 1 ? "ont" : "a"} indiqué leurs disponibilités ·
            heures affichées dans votre fuseau ({m.timeZone.replaceAll("_", " ")}) · 7 prochains jours
          </p>
        </div>
        <Link href="/disponibilites" className="text-xs font-medium text-accent hover:underline">Mes disponibilités</Link>
      </div>

      {m.withAvailability === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-3 text-sm text-ink-muted">
          Aucun participant n’a encore indiqué ses disponibilités.
        </p>
      ) : (
        <>
          {m.best.length > 0 && (
            <div className="rounded-xl border border-accent/25 bg-accent/[0.06] p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-accent"><Sparkles className="size-3.5" /> Meilleurs créneaux</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {m.best.map((b) => (
                  <li key={`${b.weekday}-${b.from}`} className="tabular rounded-lg border border-line bg-surface px-2.5 py-1 text-xs">
                    <strong className="text-ink">{b.label}</strong> {h(b.from)}–{h(b.to)} ·{" "}
                    <span className="text-accent">{b.count}/{m.participants} disponibles</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-max min-w-full border-separate border-spacing-0.5 text-[11px]">
              <caption className="sr-only">Nombre de participants disponibles par jour et par heure</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-surface pr-2 text-left font-medium text-ink-muted">Jour</th>
                  {m.hours.map((hour) => (
                    <th key={hour} scope="col" className="tabular w-9 text-center font-medium text-ink-muted">{h(hour)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.rows.map((row) => (
                  <tr key={row.date}>
                    <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-surface pr-2 text-left font-medium">
                      {row.label}
                      <span className="block text-[10px] font-normal text-ink-muted">
                        {new Date(`${row.date}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })}
                      </span>
                    </th>
                    {m.hours.map((hour) => {
                      const n = row.counts[hour] ?? 0;
                      const ratio = m.max ? n / m.max : 0;
                      return (
                        <td
                          key={hour}
                          title={`${row.label} ${h(hour)}–${h(hour + 1)} : ${n} disponible${n > 1 ? "s" : ""}`}
                          className={`tabular h-8 w-9 rounded-md text-center align-middle ${n === 0 ? "bg-surface-2 text-ink-muted/40" : ratio >= 0.999 ? "font-semibold text-accent-ink" : "text-ink"}`}
                          style={n > 0 ? { background: `color-mix(in srgb, var(--accent) ${Math.round(18 + ratio * 72)}%, var(--surface-2))` } : undefined}
                        >
                          {n || "·"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-ink-muted">
            Indicatif : les disponibilités ne réservent rien et ne modifient jamais les horaires du tournoi.
            {isOrganizer ? " Vous restez seul maître de la programmation." : ""}
          </p>
        </>
      )}
    </section>
  );
}
