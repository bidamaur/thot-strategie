"use client";

import { Heart, Server, ShieldCheck, Trophy } from "lucide-react";
import { PageShell } from "@/components/ui/page-header";
import { openDonation } from "@/lib/client/premium-gate";
import { MyPayments } from "./my-payments";

const POINTS = [
  { icon: Server, title: "Serveurs et hébergement", text: "Garder la plateforme rapide et disponible, de jour comme de nuit." },
  { icon: Trophy, title: "Tournois et communauté", text: "Organiser plus de compétitions et animer la communauté." },
  { icon: ShieldCheck, title: "Jeu équitable", text: "Un don ne donne aucun avantage de jeu et n’active pas le Premium." },
];

export function SupportClient() {
  return (
    <PageShell>
      <section className="rounded-3xl border border-danger/15 bg-gradient-to-br from-danger/[0.07] via-surface to-surface p-6 sm:p-10">
        <p className="eyebrow flex items-center gap-2 text-danger"><Heart size={14} /> Soutenir</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Soutenir la plateforme ❤️</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-soft sm:text-base">
          Thot Stratégie est gratuit pour jouer, progresser et participer aux compétitions. Si vous le souhaitez, un don par Orange Money ou MTN Mobile Money nous aide à continuer.
        </p>
        <button type="button" onClick={openDonation} className="btn btn-primary mt-6">
          <Heart className="size-4" /> Faire un don
        </button>
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        {POINTS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card-muted flex gap-3 p-4">
            <Icon size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />
            <div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-0.5 text-xs leading-5 text-ink-muted">{text}</p>
            </div>
          </div>
        ))}
      </section>
      <MyPayments purpose="DONATION" title="Mes dons" />
    </PageShell>
  );
}
