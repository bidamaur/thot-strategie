"use client";

import { Info, Search } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { allCountries, countryCodeFromName, countryName, FEATURED_COUNTRIES, flagEmoji } from "@/lib/countries";

/**
 * Les drapeaux emoji s'affichent sur Android, iPhone, Mac et Linux, mais pas
 * sous Windows (deux lettres grises à la place). Détection une fois par
 * navigateur : si le drapeau n'est pas dessiné en couleur, on affiche une
 * pastille avec le code du pays.
 */
let flagSupport: boolean | null = null;
function detectFlagSupport(): boolean {
  if (flagSupport !== null) return flagSupport;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 24;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return (flagSupport = false);
    ctx.font = "20px sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(flagEmoji("CM"), 0, 0);
    const data = ctx.getImageData(0, 0, 24, 24).data;
    let colored = false;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
      if (a > 0 && Math.max(r, g, b) - Math.min(r, g, b) > 60) {
        colored = true;
        break;
      }
    }
    flagSupport = colored;
  } catch {
    flagSupport = false;
  }
  return flagSupport;
}
const subscribe = () => () => undefined;

export function useFlagSupport() {
  return useSyncExternalStore(subscribe, detectFlagSupport, () => false);
}

/** Drapeau d'un pays (code ISO ou nom saisi). Rien si le pays est inconnu. */
export function CountryFlag({ country, className = "" }: { country: string | null | undefined; className?: string }) {
  const supported = useFlagSupport();
  const code = country ? countryCodeFromName(country) : null;
  if (!code) return null;
  const label = countryName(code);
  return supported ? (
    <span role="img" aria-label={label} title={label} className={`inline-block leading-none ${className}`}>
      {flagEmoji(code)}
    </span>
  ) : (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex h-[1.1em] min-w-[1.6em] items-center justify-center rounded-[3px] border border-line-strong bg-surface-3 px-0.5 text-[0.62em] font-bold leading-none tracking-tight text-ink-soft ${className}`}
    >
      {code}
    </span>
  );
}

/** Message affiché lors du choix du pays (paiements et retraits locaux). */
export function CountryPaymentNotice() {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-gold/25 bg-gold/[0.06] px-3 py-2.5 text-xs leading-5 text-ink-soft">
      <Info className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
      <span>
        <strong className="text-ink">Indiquez le pays où vous vivez réellement.</strong> Les paiements et les retraits se font
        pays par pays, avec les moyens de paiement locaux (au Cameroun : Orange Money et MTN Mobile Money). Si vous
        choisissez un autre pays, vous risquez de ne pas pouvoir payer, ni retirer vos gains le moment venu.
      </span>
    </p>
  );
}

/**
 * Choix du pays avec drapeaux et recherche. La valeur est le nom français
 * (ex. « Cameroun ») ; une valeur ancienne en texte libre reste affichée.
 */
export function CountrySelect({
  value,
  onChange,
  id,
  className = "",
  allowEmpty = true,
}: {
  value: string;
  onChange: (name: string) => void;
  id?: string;
  className?: string;
  allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const code = countryCodeFromName(value);
  const list = useMemo(() => {
    const all = allCountries();
    const q = query.trim().toLowerCase();
    if (q) return all.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q);
    const featured = FEATURED_COUNTRIES.map((f) => all.find((c) => c.code === f)!).filter(Boolean);
    return [...featured, ...all.filter((c) => !FEATURED_COUNTRIES.includes(c.code))];
  }, [query]);

  return (
    <div className={`relative ${className}`}>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-left text-sm text-white outline-none focus:border-emerald-300/60"
      >
        {code ? <CountryFlag country={code} className="text-lg" /> : null}
        <span className={`flex-1 truncate ${value ? "" : "text-ink-muted"}`}>{code ? countryName(code) : value || "Choisir un pays"}</span>
        <span aria-hidden className="text-ink-muted">▾</span>
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl">
          <label className="relative block border-b border-line">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un pays…"
              aria-label="Rechercher un pays"
              className="w-full bg-transparent py-2.5 pl-9 pr-3 text-sm outline-none"
            />
          </label>
          <ul role="listbox" aria-label="Pays" className="max-h-64 overflow-y-auto overscroll-contain py-1">
            {allowEmpty && !query && (
              <li>
                <button type="button" role="option" aria-selected={!value} onClick={() => { onChange(""); setOpen(false); }} className="w-full px-3 py-2 text-left text-sm text-ink-muted hover:bg-surface-2">
                  Non renseigné
                </button>
              </li>
            )}
            {list.map((c, i) => (
              <li key={c.code} className={!query && i === FEATURED_COUNTRIES.length ? "mt-1 border-t border-line pt-1" : ""}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.code === code}
                  onClick={() => {
                    onChange(c.name);
                    setQuery("");
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-2 ${c.code === code ? "text-accent" : "text-ink"}`}
                >
                  <CountryFlag country={c.code} className="text-lg" />
                  {c.name}
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">Aucun pays trouvé.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
