"use client";

import {
  Coins,
  Crown,
  Flame,
  Lock,
  MapPin,
  Medal,
  RefreshCw,
  ShieldOff,
  Swords,
  TrendingUp,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpponentProfile } from "@/lib/opponent-profile/service";

type Advanced = OpponentProfile["advanced"];
type Unlocked = Extract<Advanced, { locked: null }>;
type General = Exclude<Unlocked["general"], { hidden: true }>;
type Opponents = Exclude<Unlocked["recentOpponents"], { hidden: true }>;
type Tournaments = Exclude<Unlocked["tournaments"], { hidden: true }>;

const isHidden = (value: unknown): value is { hidden: true } =>
  typeof value === "object" && value !== null && "hidden" in value;

function Avatar({ src, size = "size-10" }: { src: string | null; size?: string }) {
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2`}>
      {src ? (
        src.startsWith("http") || src.startsWith("/") ? (
          <img src={src} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-lg">{src}</span>
        )
      ) : (
        <UserRound className="size-1/2 text-ink-muted" />
      )}
    </span>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Trophy; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        <Icon className="size-3.5" /> {title}
      </h3>
      {children}
    </section>
  );
}

function Private({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2.5 text-xs text-ink-muted">
      <ShieldOff className="size-4 shrink-0" /> Ce joueur ne partage pas {what}.
    </p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-3 py-2.5 text-xs text-ink-muted">{children}</p>;
}

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-2/60 px-3 py-2">
      <p className="truncate text-[11px] text-ink-muted">{label}</p>
      <p className="tabular truncate text-base font-semibold">{value}</p>
      {hint && <p className="truncate text-[11px] text-ink-muted">{hint}</p>}
    </div>
  );
}

const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
const discipline = (gameType: "CHESS" | "CHECKERS", variant?: string | null) =>
  gameType === "CHESS" ? "Échecs" : variant === "ENGLISH" ? "Dames anglaises" : "Dames";
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const RESULT = {
  WIN: { label: "Victoire", className: "text-accent" },
  LOSS: { label: "Défaite", className: "text-danger" },
  DRAW: { label: "Nulle", className: "text-ink-muted" },
} as const;

/** Barre victoires / nulles / défaites proportionnelle. */
function ResultBar({ wins, draws, losses }: { wins: number; draws: number; losses: number }) {
  const total = wins + draws + losses;
  if (!total) return null;
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
      <span className="bg-accent" style={{ width: `${(wins / total) * 100}%` }} />
      <span className="bg-ink-muted/50" style={{ width: `${(draws / total) * 100}%` }} />
      <span className="bg-danger/80" style={{ width: `${(losses / total) * 100}%` }} />
    </div>
  );
}

function GeneralStats({ data }: { data: General }) {
  const [tab, setTab] = useState<"overall" | "CHECKERS" | "CHESS">("overall");
  const t = data[tab];
  const pools = data.pools.filter((p) => tab === "overall" || p.discipline === tab);
  return (
    <div className="space-y-3">
      <div role="tablist" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1 text-xs">
        {([["overall", "Global"], ["CHECKERS", "Dames"], ["CHESS", "Échecs"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-lg py-1.5 font-medium transition ${tab === key ? "bg-surface-3 text-ink" : "text-ink-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {t.played === 0 ? (
        <Empty>Aucune partie terminée dans cette discipline.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            <Tile label="Parties" value={t.played} />
            <Tile label="Victoires" value={t.wins} hint={`${t.winRate ?? 0} %`} />
            <Tile label="Défaites" value={t.losses} hint={`${t.lossRate ?? 0} %`} />
            <Tile label="Nulles" value={t.draws} hint={`${t.drawRate ?? 0} %`} />
          </div>
          <ResultBar wins={t.wins} draws={t.draws} losses={t.losses} />
          <div className="grid grid-cols-2 gap-2">
            <Tile
              label="Série en cours"
              value={
                t.current ? (
                  <span className={t.current.kind === "WIN" ? "text-accent" : "text-danger"}>
                    {t.current.length} {t.current.kind === "WIN" ? "victoire" : "défaite"}{t.current.length > 1 ? "s" : ""}
                  </span>
                ) : (
                  "Aucune"
                )
              }
            />
            <Tile label="Plus longue série de victoires" value={t.longestWin} />
          </div>
        </>
      )}
      {pools.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line text-sm">
          {pools.map((p) => (
            <li key={p.label} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate text-ink-soft">{p.label}</span>
              <span className="tabular shrink-0 text-xs text-ink-muted">
                <span className="text-sm font-semibold text-ink">{p.current}</span> actuel · meilleur{" "}
                <span className="font-semibold text-gold">{p.best}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LastOpponents({ list }: { list: Opponents }) {
  if (list.length === 0) return <Empty>Aucune partie terminée pour l’instant.</Empty>;
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {list.map((g, i) => (
        <li key={i} className="flex items-center gap-3 px-3 py-2">
          <Avatar src={g.opponent?.avatar ?? null} size="size-8" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{g.opponent?.username ?? "Joueur supprimé"}</p>
            <p className="truncate text-[11px] text-ink-muted">
              {dateFr(g.date)} · {discipline(g.gameType, g.draughtsVariant)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className={`text-xs font-semibold ${RESULT[g.result].className}`}>{RESULT[g.result].label}</p>
            <p className="tabular text-[11px] text-ink-muted">
              {g.pointsChange === null ? "— pts" : `${signed(g.pointsChange)} pts`}
              {typeof g.eloChange === "number" && g.eloChange !== 0 ? ` · ${signed(g.eloChange)} ELO` : ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TournamentBlock({ data, paid }: { data: Tournaments; paid: boolean }) {
  if (data.participated === 0) {
    return <Empty>{paid ? "Aucune participation à une compétition rémunérée." : "Aucune participation à un tournoi à points."}</Empty>;
  }
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        <Tile label="Participations" value={data.participated} hint={`${data.completed} terminé${data.completed > 1 ? "s" : ""}`} />
        <Tile label={paid ? "Remportées" : "1res places"} value={data.wins} />
        <Tile label="Podiums" value={data.podiums} hint={`1re ×${data.wins} · 2e ×${data.second} · 3e ×${data.third}`} />
        {paid ? (
          <Tile label="Récompensé" value={data.rewarded} hint={`${data.finals} finale${data.finals > 1 ? "s" : ""}`} />
        ) : (
          <Tile label="2e / 3e places" value={`${data.second} / ${data.third}`} />
        )}
      </div>
      {data.best && (
        <p className="flex items-center gap-2 text-xs text-ink-soft">
          <Medal className="size-4 text-gold" /> Meilleure performance : {data.best.placement === 1 ? "1re" : `${data.best.placement}e`} place
          sur {data.best.participants} — {data.best.name}
        </p>
      )}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {data.recent.map((t, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{t.name}</p>
              <p className="truncate text-[11px] text-ink-muted">
                {dateFr(t.date)} · {t.type} · {discipline(t.gameType, t.draughtsVariant)} · {t.participants} joueurs
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-xs font-semibold ${t.placement === 1 ? "text-gold" : ""}`}>{t.result}</p>
              {paid && t.rewarded && <p className="text-[11px] text-accent">Récompensé</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PremiumTeaser() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gold/30">
      {/* Aperçu purement décoratif : aucune donnée de l'adversaire n'est envoyée aux non-Premium. */}
      <div aria-hidden="true" className="pointer-events-none grid grid-cols-3 gap-2 p-3 opacity-40 blur-[3px]">
        {["Parties", "Victoires", "Séries", "Adversaires", "Tournois", "Compétitions"].map((label) => (
          <div key={label} className="rounded-xl border border-line bg-surface-2 px-3 py-2">
            <p className="text-[11px] text-ink-muted">{label}</p>
            <p className="text-base font-semibold">••</p>
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas/60 p-4 text-center">
        <span className="chip border-gold/40 text-gold">
          <Lock className="size-3.5" /> Fonctionnalité Premium
        </span>
        <p className="max-w-xs text-xs text-ink-soft">
          Bilan détaillé, séries, 5 derniers adversaires, tournois et compétitions rémunérées de vos adversaires.
        </p>
        <Link href="/premium" className="btn btn-primary min-h-0 px-3 py-1.5 text-sm">
          <Crown className="size-4" /> Découvrir Premium
        </Link>
      </div>
    </div>
  );
}

/**
 * Profil de l'adversaire, ouvert depuis la salle de jeu. Purement consultatif :
 * aucune interaction avec la partie (socket, pendule, plateau).
 */
export function OpponentProfileModal({ matchId, onClose }: { matchId: string; onClose: () => void }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; profile: OpponentProfile }>({
    status: "loading",
  });
  const closeRef = useRef<HTMLButtonElement>(null);
  // Incrémenté par « Réessayer » pour relancer le chargement.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/match/${encodeURIComponent(matchId)}/opponent-profile`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { profile?: OpponentProfile; error?: string };
        if (!response.ok || !data.profile) throw new Error(data.error ?? "Profil indisponible.");
        setState({ status: "ready", profile: data.profile });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Profil indisponible." });
      });
    return () => controller.abort();
  }, [matchId, attempt]);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const profile = state.status === "ready" ? state.profile : null;
  const level = profile && !isHidden(profile.level) ? profile.level : null;
  const location = profile && !isHidden(profile.location) ? profile.location : null;
  const advanced = profile?.advanced;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={profile ? `Profil de ${profile.username}` : "Profil de l’adversaire"}
        onClick={(event) => event.stopPropagation()}
        className="card flex max-h-[90dvh] w-full max-w-xl flex-col rounded-b-none animate-rise sm:rounded-b-[var(--radius-card)]"
      >
        <header className="flex items-start gap-3 border-b border-line p-4">
          <Avatar src={profile?.avatar ?? null} size="size-14" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{profile?.username ?? "Adversaire"}</h2>
            {profile && (
              <p className="flex items-center gap-1.5 truncate text-xs text-ink-muted">
                <MapPin className="size-3.5 shrink-0" />
                {location
                  ? [location.city, location.country].filter(Boolean).join(", ") || "Localisation non renseignée"
                  : "Localisation non partagée"}
              </p>
            )}
            {profile && <p className="text-[11px] text-ink-muted">Membre depuis {dateFr(profile.memberSince)}</p>}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="btn btn-ghost min-h-0 p-2" aria-label="Fermer">
            <X className="size-5" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
          {state.status === "loading" && (
            <div className="space-y-3" aria-busy="true" aria-live="polite">
              <span className="sr-only">Chargement du profil…</span>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-2" />
              ))}
            </div>
          )}

          {state.status === "error" && (
            <div className="space-y-3 text-center">
              <p className="text-sm text-danger">{state.message}</p>
              <button
                type="button"
                onClick={retry}
                className="btn btn-ghost min-h-0 px-3 py-1.5 text-sm"
              >
                <RefreshCw className="size-4" /> Réessayer
              </button>
            </div>
          )}

          {profile && (
            <>
              <Section icon={TrendingUp} title="Niveau">
                {level ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Tile label="Points" value={level.points.toLocaleString("fr-FR")} hint="Points classiques" />
                      <Tile
                        label={`ELO · ${level.context.label}`}
                        value={level.context.rating ?? "Non classé"}
                        hint={level.context.games ? `${level.context.games} partie${level.context.games > 1 ? "s" : ""} classée${level.context.games > 1 ? "s" : ""}` : "Aucune partie classée"}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Tile label="ELO dames" value={level.draughts?.rating ?? "—"} hint={level.draughts?.label ?? "Non classé"} />
                      <Tile label="ELO échecs" value={level.chess?.rating ?? "—"} hint={level.chess?.label ?? "Non classé"} />
                    </div>
                  </div>
                ) : (
                  <Private what="ses points ni ses classements" />
                )}
              </Section>

              {advanced?.locked === "PREMIUM" ? (
                <Section icon={Crown} title="Statistiques avancées">
                  <PremiumTeaser />
                </Section>
              ) : advanced ? (
                <>
                  <Section icon={Swords} title="Statistiques générales">
                    {isHidden(advanced.general) ? <Private what="ses statistiques avancées" /> : <GeneralStats data={advanced.general} />}
                  </Section>
                  <Section icon={Flame} title="5 derniers adversaires">
                    {isHidden(advanced.recentOpponents) ? (
                      <Private what="ses derniers adversaires" />
                    ) : (
                      <LastOpponents list={advanced.recentOpponents} />
                    )}
                  </Section>
                  <Section icon={Trophy} title="Tournois à points">
                    {isHidden(advanced.tournaments) ? (
                      <Private what="ses performances en tournois" />
                    ) : (
                      <TournamentBlock data={advanced.tournaments} paid={false} />
                    )}
                  </Section>
                  <Section icon={Coins} title="Compétitions rémunérées">
                    {isHidden(advanced.paidCompetitions) ? (
                      <Private what="ses performances en compétitions" />
                    ) : (
                      <TournamentBlock data={advanced.paidCompetitions} paid />
                    )}
                  </Section>
                </>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
