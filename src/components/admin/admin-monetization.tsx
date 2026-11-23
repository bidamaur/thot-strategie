"use client";

import { AlertTriangle, BellRing, Check, ExternalLink, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { OperatorBadge, PaymentStatusChip } from "@/components/monetization/operator-badge";
import type { AdminPayment } from "@/lib/monetization/payments";
import { formatCfa, formatPhone, INTEREST_FEATURES, PROVIDER_LABELS, REJECT_REASONS, type Provider, type RejectReason } from "@/lib/monetization/rules";
import { AdminSettingsPanel } from "./admin-settings-panel";

type Tab = "dashboard" | "premium" | "donations" | "interests" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Tableau de bord" },
  { id: "premium", label: "Paiements Premium" },
  { id: "donations", label: "Donations" },
  { id: "interests", label: "Intérêts Premium" },
  { id: "settings", label: "Paramètres" },
];

const COUNTRY_NAMES: Record<string, string> = {
  CM: "Cameroun", CI: "Côte d’Ivoire", SN: "Sénégal", GA: "Gabon", TD: "Tchad", CF: "Centrafrique", CG: "Congo", CD: "RD Congo",
  GQ: "Guinée équatoriale", NG: "Nigeria", BJ: "Bénin", TG: "Togo", BF: "Burkina Faso", ML: "Mali", NE: "Niger", GN: "Guinée",
  MA: "Maroc", DZ: "Algérie", TN: "Tunisie", FR: "France", BE: "Belgique", CH: "Suisse", CA: "Canada", US: "États-Unis",
  GB: "Royaume-Uni", DE: "Allemagne", NL: "Pays-Bas", UNKNOWN: "Non renseigné",
};
const countryName = (code: string | null) => COUNTRY_NAMES[code ?? "UNKNOWN"] ?? code ?? "Non renseigné";
const num = (n: number) => new Intl.NumberFormat("fr-FR").format(n);
const dateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const monthLabel = (key: string) => new Date(`${key}-01T12:00:00Z`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" });

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error ?? "Chargement impossible.");
  return json as T;
}

/** Rubrique MONÉTISATION de l'administration. */
export function AdminMonetization() {
  const [tab, setTab] = useState<Tab>("dashboard");
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Monétisation</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Paiements Mobile Money vérifiés manuellement, dons et intérêts Premium. Une déclaration n’est jamais un revenu tant qu’elle n’a pas été validée.
        </p>
      </div>
      <nav role="tablist" aria-label="Monétisation" className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${tab === t.id ? "bg-surface text-ink shadow" : "text-ink-muted hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "dashboard" && <DashboardTab onOpen={setTab} />}
      {tab === "premium" && <PaymentsTab key="premium" purpose="PREMIUM" />}
      {tab === "donations" && <PaymentsTab key="donations" purpose="DONATION" />}
      {tab === "interests" && <InterestsTab />}
      {tab === "settings" && <AdminSettingsPanel only={["monetization", "premium"]} title="Paramètres commerciaux" />}
    </div>
  );
}

// ── Petits éléments ─────────────────────────────────────────────────────

function Tile({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`tabular mt-0.5 text-xl font-semibold ${tone === "warn" ? "text-[#e8c46a]" : "text-ink"}`}>{value}</p>
      {hint && <p className="text-[11px] text-ink-muted">{hint}</p>}
    </div>
  );
}

function Group({ step, title, note, children }: { step: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3 p-4">
      <div>
        <p className="eyebrow">{step}</p>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-ink-muted">{note}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  );
}

/** Barres horizontales à une seule série (une teinte), valeur écrite en texte et au survol. */
function Bars({ title, rows, format = num, empty = "Aucune donnée." }: { title: string; rows: { label: React.ReactNode; key: string; value: number }[]; format?: (n: number) => string; empty?: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <section className="card space-y-3 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 || max === 0 ? (
        <p className="text-xs text-ink-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-xs" title={`${typeof r.label === "string" ? r.label : r.key} : ${format(r.value)}`}>
              <span className="truncate text-ink-soft">{r.label}</span>
              <span className="h-2.5 rounded-full bg-surface-3">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
              </span>
              <span className="tabular text-right text-ink">{format(r.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Tableau de bord ─────────────────────────────────────────────────────

interface Dashboard {
  interests: { players: number; waitlist: number };
  premium: { active: number; pending: number; validated: number; rejected: number; requests: number; revenue: number };
  donations: { pending: number; validated: number; rejected: number; total: number };
  providers: { provider: string; count: number; amount: number }[];
  topFeatures: { feature: string; label: string; players: number }[];
  countries: { code: string; count: number }[];
  monthly: { month: string; premium: number; donations: number; declarations: number }[];
}

function DashboardTab({ onOpen }: { onOpen: (t: Tab) => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    let active = true;
    getJson<Dashboard>("/api/admin/monetization/dashboard")
      .then((d) => active && setData(d))
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [n]);
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <div className="card h-64 animate-pulse" aria-busy="true" />;
  const pending = data.premium.pending + data.donations.pending;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {pending > 0 && (
          <button type="button" onClick={() => onOpen(data.premium.pending ? "premium" : "donations")} className="flex items-center gap-2 rounded-xl border border-[#e0b44c]/40 bg-[#e0b44c]/10 px-3 py-2 text-sm text-[#e8c46a]">
            <AlertTriangle className="size-4" /> {pending} déclaration{pending > 1 ? "s" : ""} à vérifier
          </button>
        )}
        <button type="button" onClick={() => setN((x) => x + 1)} className="btn btn-ghost ml-auto min-h-0 border border-line px-3 py-1.5 text-xs"><RefreshCw className="size-3.5" /> Actualiser</button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        <Group step="1 · Intérêts" title="Intérêts commerciaux" note="Consultations des offres et inscriptions volontaires : aucun engagement.">
          <Tile label="Joueurs intéressés" value={num(data.interests.players)} />
          <Tile label="Liste d’attente" value={num(data.interests.waitlist)} />
        </Group>
        <Group step="2 · Déclarations" title="Déclarations de paiement" note="Envoyées par les joueurs, non vérifiées : jamais comptées comme revenus.">
          <Tile label="Demandes Premium" value={num(data.premium.requests)} />
          <Tile label="En attente" value={num(pending)} tone={pending ? "warn" : undefined} hint={`${data.premium.pending} Premium · ${data.donations.pending} dons`} />
          <Tile label="Rejetées" value={num(data.premium.rejected + data.donations.rejected)} />
        </Group>
        <Group step="3 · Vérifiés" title="Paiements vérifiés" note="Réception confirmée par un administrateur.">
          <Tile label="Premium validés" value={num(data.premium.validated)} />
          <Tile label="Dons validés" value={num(data.donations.validated)} />
          <Tile label="Premium actifs" value={num(data.premium.active)} hint="abonnements en cours" />
        </Group>
        <Group step="4 · Encaissé" title="Revenus réellement encaissés" note="Somme des montants reçus des paiements validés.">
          <Tile label="Premium" value={formatCfa(data.premium.revenue)} />
          <Tile label="Dons" value={formatCfa(data.donations.total)} />
        </Group>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Bars
          title="Encaissé par opérateur"
          rows={data.providers.map((p) => ({ key: p.provider, label: <span className="flex items-center gap-1.5"><OperatorBadge provider={p.provider} size="sm" />{p.count} paiement{p.count > 1 ? "s" : ""}</span>, value: p.amount }))}
          format={formatCfa}
          empty="Aucun paiement validé."
        />
        <Bars title="Fonctionnalités les plus demandées (joueurs)" rows={data.topFeatures.map((f) => ({ key: f.feature, label: f.label, value: f.players }))} />
        <Bars title="Intérêts par pays (joueurs × fonctionnalités)" rows={data.countries.map((c) => ({ key: c.code, label: countryName(c.code), value: c.count }))} />
      </div>
      <MonthlyTable rows={data.monthly} />
    </div>
  );
}

function MonthlyTable({ rows }: { rows: Dashboard["monthly"] }) {
  const max = Math.max(1, ...rows.map((r) => r.premium + r.donations));
  return (
    <section className="card overflow-x-auto p-0">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="px-4 pt-4 text-left text-sm font-semibold">Évolution mensuelle (12 derniers mois)</caption>
        <thead>
          <tr className="border-b border-line text-xs text-ink-muted">
            <th scope="col" className="px-4 py-2 text-left font-medium">Mois</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Déclarations</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Premium encaissé</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Dons encaissés</th>
            <th scope="col" className="w-1/3 px-4 py-2 text-left font-medium">Total encaissé</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month} className="border-b border-line last:border-0">
              <th scope="row" className="px-4 py-2 text-left font-normal capitalize">{monthLabel(r.month)}</th>
              <td className="tabular px-3 py-2 text-right">{r.declarations}</td>
              <td className="tabular px-3 py-2 text-right">{formatCfa(r.premium)}</td>
              <td className="tabular px-3 py-2 text-right">{formatCfa(r.donations)}</td>
              <td className="px-4 py-2" title={formatCfa(r.premium + r.donations)}>
                <span className="block h-2 rounded-full bg-surface-3">
                  {r.premium + r.donations > 0 && <span className="block h-full rounded-full bg-accent" style={{ width: `${((r.premium + r.donations) / max) * 100}%` }} />}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── Déclarations ────────────────────────────────────────────────────────

function PaymentsTab({ purpose }: { purpose: "PREMIUM" | "DONATION" }) {
  const [filters, setFilters] = useState({ status: "PENDING", provider: "", tier: "", from: "", to: "", q: "" });
  const [items, setItems] = useState<AdminPayment[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [total, setTotal] = useState<number | null>(null);

  const query = useCallback(
    (after?: string | null) => {
      const p = new URLSearchParams({ purpose });
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      if (after) p.set("cursor", after);
      return `/api/admin/monetization/payments?${p}`;
    },
    [filters, purpose],
  );

  useEffect(() => {
    let active = true;
    getJson<{ items: AdminPayment[]; nextCursor: string | null }>(query())
      .then((d) => {
        if (!active) return;
        setItems(d.items);
        setCursor(d.nextCursor);
        setError("");
      })
      .catch((e: Error) => active && setError(e.message));
    if (purpose === "DONATION") {
      getJson<Dashboard>("/api/admin/monetization/dashboard").then((d) => active && setTotal(d.donations.total)).catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [query, n, purpose]);

  async function more() {
    if (!cursor) return;
    const d = await getJson<{ items: AdminPayment[]; nextCursor: string | null }>(query(cursor));
    setItems((list) => [...(list ?? []), ...d.items]);
    setCursor(d.nextCursor);
  }

  const set = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      {purpose === "DONATION" && total !== null && (
        <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
          Total des donations effectivement reçues : <strong className="tabular text-ink">{formatCfa(total)}</strong>
          <span className="text-ink-muted"> (dons validés uniquement)</span>
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <div role="group" aria-label="Statut" className="flex gap-1 rounded-xl bg-surface-2 p-1">
          {[["PENDING", "En attente"], ["VALIDATED", "Validés"], ["REJECTED", "Rejetés"], ["", "Tous"]].map(([v, l]) => (
            <button key={v} type="button" aria-pressed={filters.status === v} onClick={() => set("status", v!)} className={`rounded-lg px-2.5 py-1.5 ${filters.status === v ? "bg-surface text-ink shadow" : "text-ink-muted"}`}>{l}</button>
          ))}
        </div>
        <select value={filters.provider} onChange={(e) => set("provider", e.target.value)} className="field min-h-0 w-auto py-1.5 text-xs" aria-label="Opérateur">
          <option value="">Tous opérateurs</option>
          <option value="ORANGE_MONEY">Orange Money</option>
          <option value="MTN_MOMO">MTN Mobile Money</option>
        </select>
        {purpose === "PREMIUM" && (
          <select value={filters.tier} onChange={(e) => set("tier", e.target.value)} className="field min-h-0 w-auto py-1.5 text-xs" aria-label="Niveau">
            <option value="">Tous niveaux</option>
            {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>P{l}</option>)}
          </select>
        )}
        <label className="text-ink-muted">Du <input type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} className="field ml-1 min-h-0 w-auto py-1.5 text-xs" /></label>
        <label className="text-ink-muted">au <input type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} className="field ml-1 min-h-0 w-auto py-1.5 text-xs" /></label>
        <label className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted" />
          <input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Pseudo, référence, numéro…" className="field min-h-0 py-1.5 pl-8 text-xs" />
        </label>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!items ? (
        <div className="card h-48 animate-pulse" aria-busy="true" />
      ) : items.length === 0 ? (
        <p className="card p-5 text-sm text-ink-muted">Aucune déclaration pour ces filtres.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[980px] text-xs">
            <thead>
              <tr className="border-b border-line text-left text-ink-muted">
                {["Réf. interne", "Joueur", "Pays", purpose === "PREMIUM" ? "Niveau" : "Objet", "Attendu", "Opérateur", "Expéditeur", "Réf. transaction", "Déclaré le", "Statut"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} onClick={() => setSelected(p.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setSelected(p.id)} className="tabular font-semibold text-accent hover:underline">{p.reference}</button>
                  </td>
                  <td className="px-3 py-2">{p.user.username}</td>
                  <td className="px-3 py-2">{countryName(p.countryCode)}{p.user.verifiedCountryCode ? " ✓" : ""}</td>
                  <td className="px-3 py-2">{p.tierLevel ? `P${p.tierLevel} · ${p.tierName}` : "Don"}</td>
                  <td className="tabular px-3 py-2">
                    {formatCfa(p.expectedAmount)}
                    {p.amountMismatch && <span className="block text-[#e8c46a]">déclaré {formatCfa(p.declaredAmount)}</span>}
                  </td>
                  <td className="px-3 py-2"><span className="flex items-center gap-1.5"><OperatorBadge provider={p.provider} size="sm" />{PROVIDER_LABELS[p.provider as Provider]}</span></td>
                  <td className="tabular px-3 py-2">{formatPhone(p.senderPhone)}</td>
                  <td className="px-3 py-2 font-mono">{p.transactionRef}</td>
                  <td className="tabular px-3 py-2">{dateTime(p.createdAt)}</td>
                  <td className="px-3 py-2"><PaymentStatusChip status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursor && (
            <div className="border-t border-line p-2 text-center">
              <button type="button" onClick={more} className="btn btn-ghost min-h-0 px-3 py-1.5 text-xs">Afficher plus</button>
            </div>
          )}
        </div>
      )}
      {selected && <PaymentDetail id={selected} onClose={() => setSelected(null)} onChanged={() => setN((x) => x + 1)} />}
    </div>
  );
}

type Detail = AdminPayment & {
  sameReference: { reference: string; status: string; provider: string; createdAt: string; username: string }[];
  userHistory: Record<string, number>;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right">{children}</dd>
    </>
  );
}

function PaymentDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [p, setP] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"view" | "validate" | "reject">("view");
  const [received, setReceived] = useState("");
  const [reason, setReason] = useState<RejectReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [country, setCountry] = useState("");
  const [n, setN] = useState(0);

  useEffect(() => {
    let active = true;
    getJson<{ payment: Detail }>(`/api/admin/monetization/payments/${id}`)
      .then(({ payment }) => {
        if (!active) return;
        setP(payment);
        setReceived(String(payment.declaredAmount));
        setCountry(payment.user.verifiedCountryCode ?? "");
      })
      .catch((e: Error) => active && setError(e.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      active = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [id, n, onClose]);

  async function post(action: "validate" | "reject") {
    if (!p) return;
    const body = action === "validate" ? { confirm: true, receivedAmount: Number(received) } : { reason, note };
    setBusy(true);
    setError("");
    const r = await fetch(`/api/admin/monetization/payments/${p.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(json.error ?? "Opération impossible.");
    setMode("view");
    setN((x) => x + 1);
    onChanged();
  }

  async function saveCountry() {
    if (!p) return;
    const r = await fetch(`/api/admin/monetization/users/${p.user.id}/country`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verifiedCountryCode: country || null }) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) return setError(json.error ?? "Enregistrement impossible.");
    setN((x) => x + 1);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label="Déclaration de paiement" onClick={(e) => e.stopPropagation()} className="card flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-b-none sm:rounded-b-[var(--radius-card)]">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          {p && <OperatorBadge provider={p.provider} />}
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">{p ? `${p.reference} · ${p.purpose === "PREMIUM" ? `Premium P${p.tierLevel} ${p.tierName}` : "Don"}` : "Déclaration"}</h3>
            {p && <PaymentStatusChip status={p.status} />}
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost min-h-0 p-2" aria-label="Fermer"><X className="size-5" /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {!p ? (
            error ? <p className="text-danger">{error}</p> : <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
          ) : (
            <>
              {p.sameReference.length > 0 && (
                <p className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Même référence de transaction déjà utilisée : {p.sameReference.map((s) => `${s.reference} (${s.username}, ${s.status.toLowerCase()}, ${PROVIDER_LABELS[s.provider as Provider]})`).join(" · ")}
                </p>
              )}
              {p.amountMismatch && (
                <p className="flex items-start gap-2 rounded-xl border border-[#e0b44c]/40 bg-[#e0b44c]/10 px-3 py-2 text-xs text-[#e8c46a]">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Montant déclaré ({formatCfa(p.declaredAmount)}) différent du montant attendu ({formatCfa(p.expectedAmount)}).
                </p>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-line bg-surface-2/60 p-3 text-xs">
                <Row label="Joueur">{p.user.username}{p.user.email ? ` · ${p.user.email}` : ""}</Row>
                <Row label="Pays déclaré">{p.user.country ?? "—"}</Row>
                <Row label="Pays retenu">{countryName(p.countryCode)}{p.user.verifiedCountryCode ? " (confirmé par l’administration)" : " (déduit du profil)"}</Row>
                {p.purpose === "PREMIUM" && <Row label="Niveau demandé">P{p.tierLevel} · {p.tierName} · {p.durationDays} jours</Row>}
                <Row label="Montant attendu"><strong className="tabular">{formatCfa(p.expectedAmount)}</strong></Row>
                <Row label="Montant déclaré"><span className="tabular">{formatCfa(p.declaredAmount)}</span></Row>
                {p.receivedAmount !== null && <Row label="Montant reçu"><span className="tabular">{formatCfa(p.receivedAmount)}</span></Row>}
                <Row label="Opérateur">{PROVIDER_LABELS[p.provider as Provider]}</Row>
                <Row label="Numéro destinataire"><span className="tabular">{formatPhone(p.recipientPhone)}</span></Row>
                <Row label="Numéro expéditeur"><span className="tabular">{formatPhone(p.senderPhone)}</span></Row>
                <Row label="Référence de transaction"><span className="font-mono text-sm font-semibold">{p.transactionRef}</span></Row>
                <Row label="Date du paiement (déclarée)">{dateTime(p.paidAt)}</Row>
                <Row label="Déclaré le">{dateTime(p.createdAt)}</Row>
                <Row label="Historique du joueur">{Object.entries(p.userHistory).map(([s, c]) => `${c} ${s === "VALIDATED" ? "validé(s)" : s === "REJECTED" ? "rejeté(s)" : "en attente"}`).join(" · ") || "première déclaration"}</Row>
                {p.reviewedAt && <Row label="Traité">{dateTime(p.reviewedAt)} par {p.reviewedBy ?? "—"}</Row>}
                {p.premiumExpiresAt && <Row label="Premium accordé">du {dateTime(p.premiumStartsAt!)} au {dateTime(p.premiumExpiresAt)}</Row>}
                {p.status === "REJECTED" && <Row label="Motif">{REJECT_REASONS[p.rejectReason as RejectReason] ?? p.rejectReason}{p.rejectNote ? ` : ${p.rejectNote}` : ""}</Row>}
              </dl>
              {p.hasProof && (
                <a href={`/api/admin/monetization/payments/${p.id}/proof`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
                  <ExternalLink className="size-3.5" /> Voir la capture du SMS
                </a>
              )}
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line p-3 text-xs">
                <label className="text-ink-muted">
                  Pays confirmé (code ISO, vide = pays du profil)
                  <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))} placeholder="CM" className="field mt-1 min-h-0 w-24 py-1.5 font-mono" />
                </label>
                <button type="button" onClick={saveCountry} className="btn btn-ghost min-h-0 border border-line-strong px-3 py-1.5 text-xs">Enregistrer le pays</button>
              </div>

              {p.status === "PENDING" && mode === "view" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => setMode("validate")} className="btn btn-primary"><Check className="size-4" /> Valider le paiement</button>
                  <button type="button" onClick={() => setMode("reject")} className="btn btn-danger"><X className="size-4" /> Rejeter le paiement</button>
                </div>
              )}
              {mode === "validate" && (
                <div className="space-y-3 rounded-xl border border-accent/30 bg-accent/[0.05] p-3">
                  <p className="font-medium">Confirmer la validation</p>
                  <p className="text-xs text-ink-muted">
                    Vérifiez sur le compte {PROVIDER_LABELS[p.provider as Provider]} ({formatPhone(p.recipientPhone)}) la réception de la transaction <strong className="font-mono text-ink">{p.transactionRef}</strong>.
                    {p.purpose === "PREMIUM" ? " La validation activera immédiatement le niveau demandé." : " Un don n’active jamais le Premium."}
                  </p>
                  <label className="block text-xs text-ink-muted">
                    Montant réellement reçu (FCFA)
                    <input inputMode="numeric" value={received} onChange={(e) => setReceived(e.target.value.replace(/[^\d]/g, ""))} className="field tabular mt-1" />
                  </label>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy || !received} onClick={() => post("validate")} className="btn btn-primary flex-1">{busy ? "Validation…" : "Je confirme la réception et je valide"}</button>
                    <button type="button" onClick={() => setMode("view")} className="btn btn-ghost">Annuler</button>
                  </div>
                </div>
              )}
              {mode === "reject" && (
                <div className="space-y-3 rounded-xl border border-danger/30 bg-danger/[0.05] p-3">
                  <p className="font-medium">Motif du rejet (obligatoire)</p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {(Object.entries(REJECT_REASONS) as [RejectReason, string][]).map(([k, l]) => (
                      <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${reason === k ? "border-danger/50 bg-danger/10" : "border-line"}`}>
                        <input type="radio" name="reason" checked={reason === k} onChange={() => setReason(k)} className="accent-[var(--danger)]" /> {l}
                      </label>
                    ))}
                  </div>
                  <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={2} placeholder={reason === "OTHER" ? "Précisez le motif (obligatoire)" : "Précision pour le joueur (facultatif)"} className="field w-full text-xs" />
                  <div className="flex gap-2">
                    <button type="button" disabled={busy || !reason || (reason === "OTHER" && note.trim().length < 3)} onClick={() => post("reject")} className="btn btn-danger flex-1">{busy ? "Rejet…" : "Rejeter et prévenir le joueur"}</button>
                    <button type="button" onClick={() => setMode("view")} className="btn btn-ghost">Annuler</button>
                  </div>
                </div>
              )}
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Intérêts ────────────────────────────────────────────────────────────

interface Interests {
  players: number;
  waitlistPlayers: number;
  features: { feature: string; label: string; players: number; views: number }[];
  tiers: { level: number; players: number; views: number }[];
  countries: { code: string; count: number }[];
  monthly: { month: string; interests: number; waitlist: number }[];
  recent: { feature: string; label: string; tierLevel: number; views: number; waitlist: boolean; lastAt: string; country: string | null; countryCode: string | null; username: string }[];
}

function InterestsTab() {
  const [f, setF] = useState({ feature: "", country: "", waitlist: false, from: "", to: "" });
  const [data, setData] = useState<Interests | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let active = true;
    const p = new URLSearchParams();
    if (f.feature) p.set("feature", f.feature);
    if (f.country) p.set("country", f.country);
    if (f.waitlist) p.set("waitlist", "1");
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
    getJson<Interests>(`/api/admin/monetization/interests?${p}`)
      .then((d) => active && setData(d))
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [f]);

  async function notifyAll() {
    if (!window.confirm("Envoyer la notification « Les offres Premium sont ouvertes » à toute la liste d’attente ? Chaque joueur n’est prévenu qu’une fois.")) return;
    const r = await fetch("/api/admin/monetization/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    const json = await r.json().catch(() => ({}));
    setMsg(r.ok ? `${json.notified} joueur(s) prévenu(s).` : json.error ?? "Envoi impossible.");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <select value={f.feature} onChange={(e) => setF({ ...f, feature: e.target.value })} className="field min-h-0 w-auto py-1.5 text-xs" aria-label="Fonctionnalité">
          <option value="">Toutes fonctionnalités</option>
          {Object.entries(INTEREST_FEATURES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} className="field min-h-0 w-auto py-1.5 text-xs" aria-label="Pays">
          <option value="">Tous pays</option>
          {Object.entries(COUNTRY_NAMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-ink-muted"><input type="checkbox" checked={f.waitlist} onChange={(e) => setF({ ...f, waitlist: e.target.checked })} /> Liste d’attente uniquement</label>
        <label className="text-ink-muted">Du <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="field ml-1 min-h-0 w-auto py-1.5 text-xs" /></label>
        <label className="text-ink-muted">au <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="field ml-1 min-h-0 w-auto py-1.5 text-xs" /></label>
        <button type="button" onClick={notifyAll} className="btn btn-ghost ml-auto min-h-0 border border-line-strong px-3 py-1.5 text-xs"><BellRing className="size-3.5" /> Prévenir la liste d’attente</button>
      </div>
      {msg && <p role="status" className="text-sm text-accent">{msg}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {!data ? (
        <div className="card h-48 animate-pulse" aria-busy="true" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <Tile label="Joueurs intéressés" value={num(data.players)} />
            <Tile label="Inscrits sur la liste d’attente" value={num(data.waitlistPlayers)} />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Bars title="Fonctionnalités sollicitées (joueurs)" rows={data.features.map((x) => ({ key: x.feature, label: x.label, value: x.players }))} />
            <Bars title="Niveaux Premium demandés (joueurs)" rows={data.tiers.map((x) => ({ key: String(x.level), label: `P${x.level}`, value: x.players }))} />
            <Bars title="Pays d’origine" rows={data.countries.map((x) => ({ key: x.code, label: countryName(x.code), value: x.count }))} />
          </div>
          <section className="card overflow-x-auto p-0">
            <table className="w-full min-w-[480px] text-sm">
              <caption className="px-4 pt-4 text-left text-sm font-semibold">Évolution des demandes</caption>
              <thead>
                <tr className="border-b border-line text-xs text-ink-muted">
                  <th scope="col" className="px-4 py-2 text-left font-medium">Mois</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Nouveaux intérêts</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Inscriptions liste d’attente</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((m) => (
                  <tr key={m.month} className="border-b border-line last:border-0">
                    <th scope="row" className="px-4 py-2 text-left font-normal capitalize">{monthLabel(m.month)}</th>
                    <td className="tabular px-3 py-2 text-right">{m.interests}</td>
                    <td className="tabular px-3 py-2 text-right">{m.waitlist}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-xs">
              <caption className="px-4 pt-4 text-left text-sm font-semibold">Dernières sollicitations</caption>
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  {["Joueur", "Fonctionnalité", "Niveau", "Sollicitations", "Pays", "Liste d’attente", "Dernière"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={`${r.username}-${r.feature}-${r.tierLevel}-${i}`} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">{r.username}</td>
                    <td className="px-3 py-2">{r.label}</td>
                    <td className="px-3 py-2">{r.tierLevel ? `P${r.tierLevel}` : "—"}</td>
                    <td className="tabular px-3 py-2">{r.views}</td>
                    <td className="px-3 py-2">{r.countryCode ? countryName(r.countryCode) : r.country ?? "—"}</td>
                    <td className="px-3 py-2">{r.waitlist ? <Check className="size-4 text-accent" aria-label="Inscrit" /> : "—"}</td>
                    <td className="tabular px-3 py-2">{dateTime(r.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
