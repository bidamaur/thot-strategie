"use client";

import { CalendarClock, Info, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/ui/page-header";
import { DAY_KEYS, DAY_LABELS, fromMinutes, MAX_SLOTS_PER_DAY, normalizeWeekly, toMinutes, type Slot, type Weekly } from "@/lib/availability/compute";

interface Saved {
  saved: boolean;
  timeZone: string | null;
  weekly: Weekly;
  override: { from: string; to: string; weekly: Weekly } | null;
  updatedAt: string | null;
}

const emptyWeek = (): Weekly => Object.fromEntries(DAY_KEYS.map((k) => [k, []]));
const today = () => new Date().toLocaleDateString("sv-SE");

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

/** Saisie d'une semaine : disponible oui/non par jour, plusieurs plages, ajout/modification/suppression. */
function WeekEditor({ value, onChange, label }: { value: Weekly; onChange: (w: Weekly) => void; label: string }) {
  const setDay = (key: string, slots: Slot[]) => onChange({ ...value, [key]: slots });
  return (
    <div className="divide-y divide-line" aria-label={label}>
      {DAY_KEYS.map((key, i) => {
        const slots = value[key] ?? [];
        const available = slots.length > 0;
        return (
          <div key={key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
            <div className="flex items-center justify-between gap-3 sm:w-44 sm:pt-1.5">
              <span className="text-sm font-medium">{DAY_LABELS[i]}</span>
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  checked={available}
                  onChange={(e) => setDay(key, e.target.checked ? [["18:00", "21:00"]] : [])}
                  className="size-4 accent-[var(--accent)]"
                />
                {available ? "Disponible" : "Indisponible"}
              </label>
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {slots.map(([start, end], j) => (
                <span key={j} className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface-2 px-2 py-1">
                  <input
                    type="time"
                    value={start}
                    step={900}
                    aria-label={`${DAY_LABELS[i]} plage ${j + 1} : début`}
                    onChange={(e) => setDay(key, slots.map((s, k) => (k === j ? [e.target.value, s[1]] : s)))}
                    className="tabular w-[5.5rem] bg-transparent text-sm outline-none"
                  />
                  <span className="text-ink-muted">–</span>
                  <input
                    type="time"
                    value={end === "24:00" ? "23:59" : end}
                    step={900}
                    aria-label={`${DAY_LABELS[i]} plage ${j + 1} : fin`}
                    onChange={(e) => setDay(key, slots.map((s, k) => (k === j ? [s[0], e.target.value === "23:59" ? "24:00" : e.target.value] : s)))}
                    className="tabular w-[5.5rem] bg-transparent text-sm outline-none"
                  />
                  <button type="button" onClick={() => setDay(key, slots.filter((_, k) => k !== j))} className="rounded p-1 text-ink-muted hover:text-danger" aria-label={`Supprimer la plage ${start} – ${end}`}>
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              ))}
              {available && slots.length < MAX_SLOTS_PER_DAY && toMinutes(slots.at(-1)?.[1] ?? "00:00") < 1440 && (
                <button
                  type="button"
                  onClick={() => {
                    // Nouvelle plage juste après la dernière (2 h, sans dépasser minuit).
                    const start = Math.max(toMinutes(slots.at(-1)?.[1] ?? "14:00"), 0);
                    setDay(key, [...slots, [fromMinutes(start), fromMinutes(Math.min(start + 120, 1440))] as Slot]);
                  }}
                  className="inline-flex items-center gap-1 rounded-xl border border-dashed border-line-strong px-2.5 py-1.5 text-xs text-ink-muted hover:text-ink"
                >
                  <Plus className="size-3.5" /> Ajouter une plage
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AvailabilityEditor() {
  const [loaded, setLoaded] = useState<Saved | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [weekly, setWeekly] = useState<Weekly>(emptyWeek);
  const [timeZone, setTimeZone] = useState("Africa/Douala");
  const [overrideOn, setOverrideOn] = useState(false);
  const [override, setOverride] = useState<{ from: string; to: string; weekly: Weekly }>({ from: today(), to: today(), weekly: emptyWeek() });
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const zoneList = useMemo(() => zones(), []);

  useEffect(() => {
    let active = true;
    fetch("/api/availability", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          if (active) setUnauthorized(true);
          return;
        }
        const { availability } = (await r.json()) as { availability: Saved };
        if (!active) return;
        setLoaded(availability);
        setWeekly(availability.weekly);
        setTimeZone(availability.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Africa/Douala");
        if (availability.override) {
          setOverrideOn(true);
          setOverride(availability.override);
        }
      })
      .catch(() => active && setStatus({ ok: false, text: "Chargement impossible." }));
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    // Contrôle immédiat (le serveur refait toutes les vérifications).
    for (const w of [weekly, ...(overrideOn ? [override.weekly] : [])]) {
      const check = normalizeWeekly(w);
      if (!check.ok) return setStatus({ ok: false, text: check.error });
    }
    setBusy(true);
    setStatus(null);
    const r = await fetch("/api/availability", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeZone, weekly, override: overrideOn ? override : null }),
    });
    const json = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setStatus({ ok: false, text: json.error ?? "Enregistrement impossible." });
    setLoaded(json.availability);
    setWeekly(json.availability.weekly);
    setStatus({ ok: true, text: "Disponibilités enregistrées." });
  }

  async function clear() {
    if (!window.confirm("Effacer toutes vos disponibilités ?")) return;
    await fetch("/api/availability", { method: "DELETE" });
    setWeekly(emptyWeek());
    setOverrideOn(false);
    setLoaded((l) => (l ? { ...l, saved: false } : l));
    setStatus({ ok: true, text: "Disponibilités effacées." });
  }

  if (unauthorized) {
    return (
      <PageShell>
        <p className="card p-5 text-sm text-ink-soft">
          <Link href="/" className="text-accent hover:underline">Connectez-vous</Link> pour indiquer vos disponibilités.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <header className="space-y-2">
        <p className="eyebrow flex items-center gap-2"><CalendarClock size={14} /> Mon espace</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Mes disponibilités</h1>
        <p className="flex max-w-2xl items-start gap-2 text-sm text-ink-muted">
          <Info className="mt-0.5 size-4 shrink-0" />
          Indiquez quand vous jouez habituellement. Ces informations sont strictement indicatives : ce n’est ni une réservation ni un engagement. Les organisateurs de vos tournois voient seulement le nombre de joueurs disponibles par créneau, jamais votre nom.
        </p>
      </header>

      {!loaded && !status ? (
        <div className="card h-64 animate-pulse" aria-busy="true" />
      ) : (
        <>
          <section className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
              <h2 className="text-base font-semibold">Semaine habituelle</h2>
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                Fuseau horaire
                <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className="field min-h-0 max-w-[14rem] py-1.5 text-xs">
                  {(zoneList.includes(timeZone) ? zoneList : [timeZone, ...zoneList]).map((z) => (
                    <option key={z} value={z}>{z.replaceAll("_", " ")}</option>
                  ))}
                </select>
              </label>
            </div>
            <WeekEditor value={weekly} onChange={setWeekly} label="Semaine habituelle" />
          </section>

          <section className="card p-4 sm:p-5">
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={overrideOn} onChange={(e) => setOverrideOn(e.target.checked)} className="size-4 accent-[var(--accent)]" />
              <span>
                <span className="block text-base font-semibold">Modification temporaire</span>
                <span className="block text-xs text-ink-muted">Vacances, examens, déplacement… Remplace votre semaine habituelle sur une période (90 jours maximum).</span>
              </span>
            </label>
            {overrideOn && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-3 text-xs text-ink-muted">
                  <label>Du <input type="date" value={override.from} onChange={(e) => setOverride({ ...override, from: e.target.value })} className="field ml-1 min-h-0 py-1.5" /></label>
                  <label>au <input type="date" value={override.to} min={override.from} onChange={(e) => setOverride({ ...override, to: e.target.value })} className="field ml-1 min-h-0 py-1.5" /></label>
                </div>
                <WeekEditor value={override.weekly} onChange={(w) => setOverride({ ...override, weekly: w })} label="Semaine temporaire" />
              </div>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={busy} className="btn btn-primary">
              <Save className="size-4" /> {busy ? "Enregistrement…" : "Enregistrer mes disponibilités"}
            </button>
            {loaded?.saved && (
              <button type="button" onClick={clear} className="btn btn-ghost border border-line-strong">
                <Trash2 className="size-4" /> Tout effacer
              </button>
            )}
            {status && <p role="status" className={`text-sm ${status.ok ? "text-accent" : "text-danger"}`}>{status.text}</p>}
          </div>
        </>
      )}
    </PageShell>
  );
}
