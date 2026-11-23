"use client";

import { ArrowLeft, BellRing, Check, CheckCircle2, Clock, Copy, Crown, Heart, Phone, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { GATE_EVENT, recordInterest, type GateRequest } from "@/lib/client/premium-gate";
import type { CheckoutConfig } from "@/lib/monetization/payments";
import { formatCfa, formatNumber, formatPhone, PROVIDER_LABELS, ussdTelHref, type Provider } from "@/lib/monetization/rules";
import { OperatorBadge, PaymentStatusChip } from "./operator-badge";

type Config = CheckoutConfig & { loggedIn: boolean; onWaitlist: boolean };
type Instruction = { id: Provider; label: string; number: string; instructions: string; amount: number; ussd: string | null };
type Step = "choose" | "pay" | "declare" | "done";

/**
 * Fenêtre unique de paiement : Premium (choix du niveau → instructions Orange /
 * MTN → déclaration) et dons. Hors Cameroun : message de lancement et liste
 * d'attente. Montants, numéros et codes USSD viennent exclusivement du serveur.
 */
export function CheckoutHost() {
  const [request, setRequest] = useState<(GateRequest & { n: number; closed?: boolean }) | null>(null);
  const close = useCallback(() => setRequest((prev) => (prev ? { ...prev, closed: true } : prev)), []);

  useEffect(() => {
    const onOpen = (event: Event) => setRequest((prev) => ({ ...(event as CustomEvent<GateRequest>).detail, n: (prev?.n ?? 0) + 1, closed: false }));
    window.addEventListener(GATE_EVENT, onOpen);
    return () => window.removeEventListener(GATE_EVENT, onOpen);
  }, []);

  // Ouverte uniquement sur action du joueur (jamais de sollicitation automatique).
  if (!request) return null;
  if (request.closed) return null;
  return <CheckoutDialog key={request.n} request={request} onClose={close} />;
}

function CheckoutDialog({ request, onClose }: { request: GateRequest; onClose: () => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState<Step>("choose");
  const [tierLevel, setTierLevel] = useState<number | null>(request.tierLevel ?? null);
  const [amount, setAmount] = useState<number | null>(null);
  const [instructions, setInstructions] = useState<Instruction[] | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [result, setResult] = useState<{ reference: string; message: string } | null>(null);
  const [waitlisted, setWaitlisted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const premium = request.mode === "premium";

  useEffect(() => {
    let active = true;
    fetch("/api/monetization/checkout", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((c: Config) => {
        if (!active) return;
        setConfig(c);
        setWaitlisted(c.onWaitlist);
        // Consultation d'une fonctionnalité Premium : mesurée (agrégée par joueur et fonctionnalité).
        if (premium && c.loggedIn) void recordInterest(request.feature ?? "PREMIUM_OFFER", { tierLevel: request.tierLevel });
      })
      .catch(() => active && setError("Chargement impossible. Vérifiez votre connexion."));
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      active = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [premium, request.feature, request.tierLevel, onClose]);

  const tier = config?.tiers.find((t) => t.level === tierLevel) ?? null;
  const due = premium ? tier?.priceCfa ?? null : amount;

  const goPay = useCallback(async () => {
    setError("");
    const query = premium ? `purpose=PREMIUM&tier=${tierLevel}` : `purpose=DONATION&amount=${amount}`;
    const r = await fetch(`/api/monetization/instructions?${query}`, { cache: "no-store" });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) return setError(json.error ?? "Instructions indisponibles.");
    setInstructions(json.providers);
    setProvider((p) => p ?? json.providers[0]?.id ?? null);
    if (premium && tierLevel) void recordInterest("PREMIUM_OFFER", { tierLevel });
    setStep("pay");
  }, [premium, tierLevel, amount]);

  async function joinWaitlist(feature: "PREMIUM_OFFER" | "DONATION") {
    const r = await recordInterest(request.feature && feature === "PREMIUM_OFFER" ? request.feature : feature, { waitlist: true, tierLevel: request.tierLevel });
    if (r && "interest" in r && r.interest?.waitlist) setWaitlisted(true);
    else setError(r?.error ?? "Inscription impossible pour le moment.");
  }

  const pending = config?.pending.find((p) => p.purpose === (premium ? "PREMIUM" : "DONATION"));
  const title = premium ? "Premium" : "Soutenir la plateforme";

  let body: React.ReactNode;
  if (!config) {
    body = error ? <p className="text-sm text-danger">{error}</p> : (
      <div className="space-y-3" aria-busy="true">
        {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" />)}
      </div>
    );
  } else if (!config.loggedIn) {
    body = (
      <div className="space-y-4 text-sm">
        <p className="text-ink-soft">{premium ? "Connectez-vous pour choisir une offre Premium." : "Connectez-vous pour faire un don et suivre sa confirmation."}</p>
        <Link href="/" onClick={onClose} className="btn btn-primary w-full">Se connecter</Link>
      </div>
    );
  } else if (!config.eligibility.mobileMoney) {
    body = (
      <ComingSoon
        premium={premium}
        config={config}
        waitlisted={waitlisted}
        onWaitlist={() => joinWaitlist(premium ? "PREMIUM_OFFER" : "DONATION")}
        onClose={onClose}
      />
    );
  } else if (pending && step !== "done") {
    body = (
      <div className="space-y-4 text-sm">
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3">
          <Clock className="mt-0.5 size-5 shrink-0 text-gold" />
          <div className="min-w-0">
            <p className="font-medium">Déclaration {pending.reference} en cours de vérification</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Envoyée le {new Date(pending.createdAt).toLocaleDateString("fr-FR")}{pending.tierName ? ` · ${pending.tierName}` : ""} · {formatCfa(pending.expectedAmount)}.
              Vous serez notifié dès qu’un administrateur l’aura vérifiée.
            </p>
          </div>
        </div>
        <PaymentStatusChip status="PENDING" />
        <Link href={premium ? "/premium#mes-paiements" : "/soutenir"} onClick={onClose} className="btn btn-ghost w-full border border-line-strong">Suivre mes déclarations</Link>
      </div>
    );
  } else if (step === "choose") {
    body = premium ? (
      <TierChoice config={config} value={tierLevel} onChange={setTierLevel} onNext={goPay} error={error} />
    ) : (
      <DonationChoice config={config} value={amount} onChange={setAmount} onNext={goPay} error={error} />
    );
  } else if (step === "pay" && instructions && due) {
    body = (
      <PayStep
        premium={premium}
        tierName={tier?.name ?? null}
        durationDays={tier?.durationDays ?? null}
        instructions={instructions}
        provider={provider}
        onProvider={setProvider}
        onBack={() => setStep("choose")}
        onPaid={() => setStep("declare")}
      />
    );
  } else if (step === "declare" && due && provider) {
    body = (
      <DeclareStep
        premium={premium}
        tierLevel={tierLevel}
        amount={due}
        provider={provider}
        providers={instructions ?? []}
        proofEnabled={config.proofImageEnabled}
        onBack={() => setStep("pay")}
        onDone={(reference) => {
          setResult({ reference, message: premium ? config.messages.premiumSubmitted : config.messages.donationSubmitted });
          setStep("done");
        }}
      />
    );
  } else if (step === "done" && result) {
    body = (
      <div className="space-y-4 text-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <CheckCircle2 className="size-10 text-accent" />
          <p className="font-medium text-ink">Déclaration transmise</p>
          <p className="text-ink-soft">{result.message}</p>
        </div>
        <dl className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-surface-2 p-3 text-xs">
          <dt className="text-ink-muted">Référence</dt>
          <dd className="tabular text-right font-semibold">{result.reference}</dd>
          <dt className="text-ink-muted">Statut</dt>
          <dd className="text-right"><PaymentStatusChip status="PENDING" /></dd>
        </dl>
        <button type="button" onClick={onClose} className="btn btn-primary w-full">Fermer</button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="card flex max-h-[92dvh] w-full max-w-lg flex-col rounded-b-none animate-rise sm:rounded-b-[var(--radius-card)]"
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className={`flex size-9 items-center justify-center rounded-xl ${premium ? "bg-gold/10 text-gold" : "bg-danger/10 text-danger"}`}>
            {premium ? <Crown className="size-5" /> : <Heart className="size-5" />}
          </span>
          <h2 className="flex-1 text-base font-semibold">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} className="btn btn-ghost min-h-0 p-2" aria-label="Fermer">
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4">{body}</div>
      </section>
    </div>
  );
}

function ComingSoon({ premium, config, waitlisted, onWaitlist, onClose }: { premium: boolean; config: Config; waitlisted: boolean; onWaitlist: () => void; onClose: () => void }) {
  const reason = config.eligibility.reason;
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-2xl border border-gold/20 bg-gold/[0.06] p-4">
        {premium ? (
          <>
            <p className="text-[15px] font-semibold uppercase leading-snug tracking-wide text-gold">{config.messages.comingSoonTitle}</p>
            <p className="mt-2 leading-6 text-ink-soft">{config.messages.comingSoonBody}</p>
          </>
        ) : (
          <p className="leading-6 text-ink-soft">{config.messages.donationInternational}</p>
        )}
      </div>
      {reason === "COUNTRY_MISSING" && (
        <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink-muted">
          Vous êtes au Cameroun ? Indiquez votre pays dans <Link href="/dashboard" onClick={onClose} className="text-accent hover:underline">votre profil</Link> pour payer par Orange Money ou MTN Mobile Money.
        </p>
      )}
      {config.waitlistEnabled &&
        (waitlisted ? (
          <p className="flex items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2.5 text-accent">
            <Check className="size-4" /> Vous serez prévenu dès le lancement.
          </p>
        ) : (
          <button type="button" onClick={onWaitlist} className="btn btn-primary w-full">
            <BellRing className="size-4" /> Me prévenir au lancement
          </button>
        ))}
      {premium && (
        <Link href="/premium" onClick={onClose} className="btn btn-ghost w-full border border-line-strong">Découvrir les avantages Premium</Link>
      )}
    </div>
  );
}

function TierChoice({ config, value, onChange, onNext, error }: { config: Config; value: number | null; onChange: (l: number) => void; onNext: () => void; error: string }) {
  if (config.tiers.length === 0) return <p className="text-sm text-ink-muted">Aucune offre n’est proposée à l’achat pour le moment.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">Choisissez votre niveau. Le montant exact et les instructions de paiement s’afficheront ensuite.</p>
      <div role="radiogroup" aria-label="Niveau Premium" className="space-y-2">
        {config.tiers.map((t) => {
          const below = config.currentLevel > t.level;
          const selected = value === t.level;
          return (
            <button
              key={t.level}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={below}
              onClick={() => onChange(t.level)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-40 ${
                selected ? "border-gold/60 bg-gold/[0.08]" : "border-line bg-surface-2 hover:border-line-strong"
              }`}
            >
              <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-gold bg-gold text-accent-ink" : "border-line-strong"}`}>
                {selected && <Check className="size-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  P{t.level} · {t.name}
                  {config.currentLevel === t.level && <span className="ml-2 text-xs font-normal text-accent">niveau actuel : prolongation</span>}
                </span>
                <span className="block truncate text-xs text-ink-muted">{t.tagline}</span>
              </span>
              <span className="text-right">
                <span className="tabular block text-sm font-semibold">{formatCfa(t.priceCfa)}</span>
                <span className="block text-[11px] text-ink-muted">{t.durationDays} jours</span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="button" disabled={value === null} onClick={onNext} className="btn btn-primary w-full">Continuer vers le paiement</button>
    </div>
  );
}

function DonationChoice({ config, value, onChange, onNext, error }: { config: Config; value: number | null; onChange: (n: number | null) => void; onNext: () => void; error: string }) {
  const d = config.donations;
  const [custom, setCustom] = useState("");
  if (!d.enabled) return <p className="text-sm text-ink-muted">Les dons sont fermés pour le moment.</p>;
  const customValue = Number(custom.replace(/\s/g, ""));
  const customValid = Number.isInteger(customValue) && customValue >= d.min && customValue <= d.max;
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-ink-soft">
        Votre don aide à faire vivre la plateforme : serveurs, tournois et nouvelles fonctionnalités. Il ne donne aucun avantage de jeu et n’active pas le Premium.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {d.amounts.map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={value === a && !custom}
            onClick={() => {
              setCustom("");
              onChange(a);
            }}
            className={`tabular rounded-xl border px-2 py-3 text-sm font-semibold transition ${value === a && !custom ? "border-danger/50 bg-danger/10 text-ink" : "border-line bg-surface-2 hover:border-line-strong"}`}
          >
            {formatNumber(a)}
            <span className="block text-[10px] font-normal text-ink-muted">FCFA</span>
          </button>
        ))}
      </div>
      {d.custom && (
        <label className="block text-xs text-ink-muted">
          Montant libre (FCFA, de {formatNumber(d.min)} à {formatNumber(d.max)})
          <input
            inputMode="numeric"
            value={custom}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d]/g, "").slice(0, 8);
              setCustom(v);
              const n = Number(v);
              onChange(v && Number.isInteger(n) && n >= d.min && n <= d.max ? n : null);
            }}
            placeholder="Autre montant"
            className="field mt-1 w-full"
          />
          {custom && !customValid && <span className="mt-1 block text-danger">Montant hors limites.</span>}
        </label>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="button" disabled={!value} onClick={onNext} className="btn btn-primary w-full">
        {value ? `Donner ${formatCfa(value)}` : "Choisissez un montant"}
      </button>
    </div>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function PayStep(props: {
  premium: boolean;
  tierName: string | null;
  durationDays: number | null;
  instructions: Instruction[];
  provider: Provider | null;
  onProvider: (p: Provider) => void;
  onBack: () => void;
  onPaid: () => void;
}) {
  const current = props.instructions.find((i) => i.id === props.provider) ?? props.instructions[0];
  const [copied, setCopied] = useState<string | null>(null);
  if (!current) return <p className="text-sm text-ink-muted">Aucun opérateur n’est disponible pour le moment.</p>;
  const copy = async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }
  };
  return (
    <div className="space-y-4 text-sm">
      <button type="button" onClick={props.onBack} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Modifier {props.premium ? "le niveau" : "le montant"}
      </button>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-line bg-surface-2 p-3">
        {props.premium && (
          <>
            <dt className="text-ink-muted">Offre</dt>
            <dd className="text-right font-medium">{props.tierName}</dd>
            <dt className="text-ink-muted">Durée</dt>
            <dd className="text-right">{props.durationDays} jours, sans renouvellement automatique</dd>
          </>
        )}
        <dt className="text-ink-muted">Montant exact</dt>
        <dd className="tabular text-right text-lg font-semibold text-ink">{formatCfa(current.amount)}</dd>
      </dl>

      {props.instructions.length > 1 && (
        <div role="tablist" aria-label="Opérateur" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
          {props.instructions.map((i) => (
            <button
              key={i.id}
              type="button"
              role="tab"
              aria-selected={i.id === current.id}
              onClick={() => props.onProvider(i.id)}
              className={`flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold uppercase tracking-wide ${i.id === current.id ? "bg-surface text-ink shadow" : "text-ink-muted"}`}
            >
              <OperatorBadge provider={i.id} size="sm" />
              {i.label}
            </button>
          ))}
        </div>
      )}

      <div role="tabpanel" className="space-y-3">
        <div className="flex items-center gap-3">
          <OperatorBadge provider={current.id} />
          <div className="min-w-0">
            <p className="text-xs text-ink-muted">Numéro destinataire {current.label}</p>
            <p className="tabular text-base font-semibold">{formatPhone(current.number)}</p>
          </div>
          <button type="button" onClick={() => copy("number", current.number)} className="btn btn-ghost ml-auto min-h-0 px-2.5 py-1.5 text-xs" aria-label="Copier le numéro">
            {copied === "number" ? <Check className="size-4 text-accent" /> : <Copy className="size-4" />}
          </button>
        </div>

        {current.ussd ? (
          <div className="rounded-xl border border-line-strong bg-canvas p-3">
            <p className="text-xs text-ink-muted">Code de transfert à composer</p>
            <p className="tabular mt-1 select-all break-all font-mono text-lg font-semibold tracking-wide">{current.ussd}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => copy("ussd", current.ussd!)} className="btn btn-ghost border border-line-strong text-xs uppercase tracking-wide">
                {copied === "ussd" ? <><Check className="size-4 text-accent" /> Code copié</> : <><Copy className="size-4" /> Copier le code USSD</>}
              </button>
              <a href={ussdTelHref(current.ussd)} className="btn btn-ghost border border-line-strong text-xs">
                <Phone className="size-4" /> Composer sur ce téléphone
              </a>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-ink-soft">
            Envoyez exactement <strong className="text-ink">{formatCfa(current.amount)}</strong> au <strong className="text-ink">{formatPhone(current.number)}</strong> depuis votre compte {current.label}.
          </p>
        )}
        <p className="text-xs leading-5 text-ink-muted">{current.instructions}</p>
        <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-xs text-ink-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
          Le paiement n’est pas automatique : c’est vous qui le confirmez sur votre téléphone. Ne communiquez jamais votre code secret ; la plateforme ne vous le demandera pas.
        </p>
      </div>

      <button type="button" onClick={props.onPaid} className="btn btn-primary w-full uppercase tracking-wide">J’ai effectué le paiement</button>
    </div>
  );
}

function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function DeclareStep(props: {
  premium: boolean;
  tierLevel: number | null;
  amount: number;
  provider: Provider;
  providers: Instruction[];
  proofEnabled: boolean;
  onBack: () => void;
  onDone: (reference: string) => void;
}) {
  const [provider, setProvider] = useState<Provider>(props.provider);
  const [phone, setPhone] = useState("");
  const [declared, setDeclared] = useState(String(props.amount));
  const [ref, setRef] = useState("");
  const [paidAt, setPaidAt] = useState(localNow);
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ref.trim()) return setError("La référence de transaction est obligatoire.");
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("purpose", props.premium ? "PREMIUM" : "DONATION");
    form.set("provider", provider);
    if (props.premium && props.tierLevel) form.set("tierLevel", String(props.tierLevel));
    if (!props.premium) form.set("amount", String(props.amount));
    form.set("senderPhone", phone);
    form.set("declaredAmount", declared);
    form.set("transactionRef", ref);
    form.set("paidAt", new Date(paidAt).toISOString());
    if (proof) form.set("proof", proof);
    const r = await fetch("/api/monetization/payments", { method: "POST", body: form });
    const json = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(json.error ?? "Envoi impossible.");
    props.onDone(json.payment.reference);
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      <button type="button" onClick={props.onBack} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Revoir les instructions
      </button>
      <p className="text-ink-soft">Recopiez les informations du SMS de confirmation reçu de votre opérateur.</p>
      <fieldset>
        <legend className="mb-1 text-xs text-ink-muted">Opérateur</legend>
        <div className="grid grid-cols-2 gap-2">
          {props.providers.map((p) => (
            <label key={p.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs ${provider === p.id ? "border-accent/50 bg-accent/10" : "border-line bg-surface-2"}`}>
              <input type="radio" name="provider" value={p.id} checked={provider === p.id} onChange={() => setProvider(p.id)} className="sr-only" />
              <OperatorBadge provider={p.id} size="sm" />
              {PROVIDER_LABELS[p.id]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-xs text-ink-muted">
        Numéro de téléphone expéditeur
        <input required inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value.slice(0, 20))} placeholder="6XX XX XX XX" className="field mt-1 w-full" />
      </label>
      <label className="block text-xs text-ink-muted">
        Montant envoyé (FCFA)
        <input required inputMode="numeric" value={declared} onChange={(e) => setDeclared(e.target.value.replace(/[^\d]/g, "").slice(0, 9))} className="field tabular mt-1 w-full" />
        {Number(declared) !== props.amount && declared && (
          <span className="mt-1 block text-[#e8c46a]">Montant attendu : {formatCfa(props.amount)}. Un écart peut entraîner le rejet de la déclaration.</span>
        )}
      </label>
      <label className="block text-xs text-ink-muted">
        Référence de transaction (obligatoire, telle qu’elle figure dans le SMS)
        <input required value={ref} onChange={(e) => setRef(e.target.value.slice(0, 60))} autoCapitalize="characters" spellCheck={false} placeholder="Ex. CI241119.1530.A12345" className="field mt-1 w-full font-mono" />
      </label>
      <label className="block text-xs text-ink-muted">
        Date et heure du paiement
        <input required type="datetime-local" value={paidAt} max={localNow()} onChange={(e) => setPaidAt(e.target.value)} className="field mt-1 w-full" />
      </label>
      {props.proofEnabled && (
        <label className="block text-xs text-ink-muted">
          Capture d’écran du SMS (facultative, visible uniquement par l’administration)
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setProof(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-surface-3 file:px-3 file:py-1.5 file:text-ink" />
        </label>
      )}
      {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary w-full">{busy ? "Envoi…" : "Envoyer ma déclaration"}</button>
      <p className="text-center text-[11px] text-ink-muted">
        {props.premium ? "Votre Premium sera activé après vérification de la transaction par l’administration." : "Votre don sera confirmé après vérification de la transaction."}
      </p>
    </form>
  );
}
