"use client";

import { AlertTriangle, RotateCcw, Save, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SettingCategory } from "@/lib/settings/registry";

interface SettingRow {
  key: string;
  category: SettingCategory;
  label: string;
  description?: string;
  critical?: boolean;
  type: "number" | "boolean" | "enum" | "json" | "string";
  placeholder?: string;
  default: unknown;
  min?: number;
  max?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  value: unknown;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

type Categories = Record<SettingCategory, { label: string; description: string }>;

/**
 * Panneau de paramétrage centralisé : toutes les règles métier de la
 * plateforme, validées côté serveur et tracées dans le journal d'audit.
 */
export function AdminSettingsPanel({ only, title }: { only?: SettingCategory[]; title?: string } = {}) {
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [categories, setCategories] = useState<Categories | null>(null);
  const [active, setActive] = useState<SettingCategory>(only?.[0] ?? "points");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [filter, setFilter] = useState("");
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/settings", { cache: "no-store" });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setLoadError(json.error ?? "Chargement impossible.");
      return;
    }
    setSettings(json.settings);
    setCategories(json.categories);
    setDrafts({});
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return settings.filter((s) =>
      only && !only.includes(s.category)
        ? false
        : q ? `${s.label} ${s.key} ${s.description ?? ""}`.toLowerCase().includes(q) : s.category === active,
    );
  }, [settings, active, filter, only]);

  const draftOf = (row: SettingRow) =>
    drafts[row.key] ?? (row.type === "json" ? JSON.stringify(row.value, null, 2) : String(row.value));

  async function save(row: SettingRow, override?: unknown) {
    let value: unknown = override;
    if (value === undefined) {
      const raw = draftOf(row);
      if (row.type === "number") value = Number(raw);
      else if (row.type === "json") {
        try {
          value = JSON.parse(raw);
        } catch {
          setStatus((s) => ({ ...s, [row.key]: { ok: false, text: "JSON invalide." } }));
          return;
        }
      } else value = raw;
    }
    if (row.critical && !window.confirm(`« ${row.label} » est un paramètre sensible. Confirmer la modification ?`)) return;
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: row.key, value }),
    });
    const json = await response.json().catch(() => ({}));
    setStatus((s) => ({
      ...s,
      [row.key]: response.ok ? { ok: true, text: "Enregistré et tracé." } : { ok: false, text: json.error ?? "Erreur." },
    }));
    if (response.ok) await load();
  }

  async function reset(row: SettingRow) {
    if (!window.confirm(`Rétablir la valeur par défaut de « ${row.label} » ?`)) return;
    const response = await fetch(`/api/admin/settings?key=${encodeURIComponent(row.key)}`, { method: "DELETE" });
    setStatus((s) => ({ ...s, [row.key]: response.ok ? { ok: true, text: "Valeur par défaut rétablie." } : { ok: false, text: "Erreur." } }));
    if (response.ok) await load();
  }

  if (loadError) return <p className="text-sm text-danger">{loadError}</p>;
  if (!categories) return <div className="card h-64 animate-pulse" />;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">{title ?? "Paramètres de la plateforme"}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Toutes les règles métier sont modifiables ici. Chaque changement est validé, tracé dans le journal d’audit et
          appliqué en quelques secondes. Les tournois déjà lancés conservent leurs règles figées.
        </p>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <nav className="flex gap-1 overflow-x-auto lg:w-56 lg:shrink-0 lg:flex-col" aria-label="Catégories">
          {(Object.keys(categories) as SettingCategory[]).filter((id) => !only || only.includes(id)).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setActive(id);
                setFilter("");
              }}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition ${
                active === id && !filter ? "bg-surface-3 text-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {categories[id].label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Rechercher un paramètre…" className="field pl-9" />
          </label>
          {!filter && <p className="text-sm text-ink-muted">{categories[active].description}</p>}
          {!filter && active === "storage" && <StorageTest />}

          {visible.map((row) => {
            const dirty = drafts[row.key] !== undefined;
            const msg = status[row.key];
            return (
              <div key={row.key} className={`card p-4 ${row.critical ? "border-gold/30" : ""}`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      {row.critical && <AlertTriangle className="size-4 text-gold" aria-label="Paramètre sensible" />}
                      {row.label}
                    </p>
                    {row.description && <p className="mt-0.5 text-xs text-ink-muted">{row.description}</p>}
                    <p className="mt-1 font-mono text-[11px] text-ink-muted/70">
                      {row.key}
                      {row.isDefault ? " · valeur par défaut" : row.updatedBy ? ` · modifié par ${row.updatedBy}` : ""}
                    </p>
                  </div>

                  {row.type === "boolean" ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.value === true}
                      onClick={() => save(row, !(row.value === true))}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition ${row.value === true ? "bg-accent" : "bg-surface-3"}`}
                    >
                      <span className={`absolute top-0.5 size-5 rounded-full bg-ink transition-all ${row.value === true ? "left-[22px]" : "left-0.5"}`} />
                      <span className="sr-only">{row.label}</span>
                    </button>
                  ) : row.type === "json" ? null : row.type === "string" ? (
                    <input
                      type="text"
                      value={draftOf(row)}
                      placeholder={row.placeholder}
                      onChange={(e) => setDrafts((d) => ({ ...d, [row.key]: e.target.value }))}
                      className="field w-full font-mono md:w-72"
                    />
                  ) : (
                    <div className="flex shrink-0 items-center gap-2">
                      <input
                        type="number"
                        value={draftOf(row)}
                        min={row.min}
                        max={row.max}
                        onChange={(e) => setDrafts((d) => ({ ...d, [row.key]: e.target.value }))}
                        className="field w-32 tabular"
                      />
                      {row.unit && <span className="text-xs text-ink-muted">{row.unit}</span>}
                    </div>
                  )}
                </div>

                {row.type === "json" && (
                  <textarea
                    value={draftOf(row)}
                    onChange={(e) => setDrafts((d) => ({ ...d, [row.key]: e.target.value }))}
                    rows={Math.min(18, Math.max(3, draftOf(row).split("\n").length))}
                    spellCheck={false}
                    className="field mt-3 font-mono text-xs"
                  />
                )}

                {(row.type !== "boolean") && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" disabled={!dirty} onClick={() => save(row)} className="btn btn-primary min-h-0 px-3 py-1.5 text-xs">
                      <Save className="size-3.5" /> Enregistrer
                    </button>
                    {!row.isDefault && (
                      <button type="button" onClick={() => reset(row)} className="btn btn-ghost min-h-0 px-3 py-1.5 text-xs">
                        <RotateCcw className="size-3.5" /> Défaut
                      </button>
                    )}
                    {row.min !== undefined && row.max !== undefined && (
                      <span className="text-[11px] text-ink-muted">Entre {row.min} et {row.max}</span>
                    )}
                  </div>
                )}
                {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  actor: string | null;
  createdAt: string;
}

export function AdminAuditView() {
  const [logs, setLogs] = useState<AuditRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/audit?limit=150", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => setLogs(json.logs ?? []))
      .catch(() => setLogs([]));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Journal d’audit</h2>
        <p className="mt-1 text-sm text-ink-muted">Paramètres, soldes, rôles, Premium et clubs : qui a changé quoi, et quand.</p>
      </div>
      {!logs && <div className="card h-48 animate-pulse" />}
      {logs && logs.length === 0 && <p className="text-sm text-ink-muted">Aucune opération tracée.</p>}
      {logs && logs.length > 0 && (
        <ul className="card divide-y divide-line">
          {logs.map((log) => (
            <li key={log.id} className="px-4 py-3">
              <button type="button" onClick={() => setOpen(open === log.id ? null : log.id)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
                <span className="text-sm">
                  <span className="font-semibold">{log.action}</span>{" "}
                  <span className="text-ink-muted">· {log.entity} {log.entityId ?? ""}</span>
                </span>
                <span className="text-xs text-ink-muted">
                  {log.actor ?? "système"} · {new Date(log.createdAt).toLocaleString("fr-FR")}
                </span>
              </button>
              {open === log.id && (
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <pre className="card-muted overflow-x-auto p-3 text-[11px] text-ink-muted">{JSON.stringify(log.before, null, 2)}</pre>
                  <pre className="card-muted overflow-x-auto p-3 text-[11px] text-ink-soft">{JSON.stringify(log.after, null, 2)}</pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Vérifie l'emplacement de sauvegarde actuel (enregistrer les paramètres avant de tester). */
function StorageTest() {
  const [state, setState] = useState<{ busy: boolean; ok?: boolean; message?: string; url?: string }>({ busy: false });
  async function run() {
    setState({ busy: true });
    const response = await fetch("/api/admin/storage/test", { method: "POST" }).catch(() => null);
    const json = (await response?.json().catch(() => ({}))) ?? {};
    setState({ busy: false, ok: !!response?.ok && json.readable !== false, message: json.message ?? json.error ?? "Test impossible.", url: json.url });
  }
  return (
    <div className="card-muted flex flex-wrap items-center gap-3 p-3 text-sm">
      <button type="button" onClick={run} disabled={state.busy} className="btn btn-primary min-h-0 px-3 py-1.5">
        {state.busy ? "Test en cours…" : "Tester le stockage"}
      </button>
      <span className={state.message ? (state.ok ? "text-accent" : "text-danger") : "text-ink-muted"}>
        {state.message ?? "Envoie une petite image dans l’emplacement configuré, la relit puis la supprime."}
      </span>
    </div>
  );
}
