"use client";

import { useEffect, useState } from "react";
import { formatCfa, PROVIDER_LABELS, type Provider } from "@/lib/monetization/rules";
import { OperatorBadge, PaymentStatusChip } from "./operator-badge";

interface MyPayment {
  reference: string;
  purpose: "PREMIUM" | "DONATION";
  provider: string;
  status: string;
  tierName: string | null;
  expectedAmount: number;
  declaredAmount: number;
  transactionRef: string;
  createdAt: string;
  reviewedAt: string | null;
  rejectLabel: string | null;
  rejectNote: string | null;
  premiumExpiresAt: string | null;
}

const date = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/** Suivi des déclarations du joueur (Premium ou dons). Rien ne s'affiche s'il n'y en a aucune. */
export function MyPayments({ purpose, title }: { purpose: "PREMIUM" | "DONATION"; title: string }) {
  const [items, setItems] = useState<MyPayment[] | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/monetization/payments", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { payments: [] }))
      .then((d: { payments: MyPayment[] }) => active && setItems(d.payments.filter((p) => p.purpose === purpose)))
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, [purpose]);
  if (!items || items.length === 0) return null;
  return (
    <section id="mes-paiements" className="card space-y-3 p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <ul className="divide-y divide-line">
        {items.map((p) => (
          <li key={p.reference} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
            <OperatorBadge provider={p.provider} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {p.tierName ?? "Don"} · <span className="tabular">{formatCfa(p.declaredAmount)}</span>
              </p>
              <p className="text-xs text-ink-muted">
                {p.reference} · {PROVIDER_LABELS[p.provider as Provider] ?? p.provider} · réf. {p.transactionRef} · {date(p.createdAt)}
              </p>
              {p.status === "REJECTED" && (
                <p className="mt-0.5 text-xs text-danger">
                  {p.rejectLabel}
                  {p.rejectNote ? ` : ${p.rejectNote}` : ""}. Vous pouvez envoyer une nouvelle déclaration.
                </p>
              )}
              {p.status === "VALIDATED" && p.premiumExpiresAt && <p className="mt-0.5 text-xs text-accent">Premium actif jusqu’au {date(p.premiumExpiresAt)}</p>}
            </div>
            <PaymentStatusChip status={p.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}
