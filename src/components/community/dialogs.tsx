"use client";

import { Check, Coins, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, Avatar, Modal, Notice, Spinner } from "./shared";

// ── Défier un ami ─────────────────────────────────────────────────────

interface PlayOptions {
  modes: { CASUAL: boolean; RATED: boolean; MONEY: boolean };
  timeControl?: { min: number; max: number };
  money?: { presets: number[]; minStake: number; maxStake: number; commissionPercent: number; eligible: boolean; reason: string | null };
}

export function ChallengeDialog({
  opponent,
  defaultGame,
  onClose,
}: {
  opponent: { id: string; username: string };
  defaultGame?: "CHESS" | "CHECKERS";
  onClose: () => void;
}) {
  const [options, setOptions] = useState<PlayOptions | null>(null);
  const [gameType, setGameType] = useState<"CHESS" | "CHECKERS">(defaultGame ?? "CHECKERS");
  const [variant, setVariant] = useState<"INTERNATIONAL" | "ENGLISH">("INTERNATIONAL");
  const [minutes, setMinutes] = useState<string>("10");
  const [mode, setMode] = useState<"CASUAL" | "RATED" | "MONEY">("CASUAL");
  const [stake, setStake] = useState<number>(0);
  const [consent, setConsent] = useState(false);
  const [color, setColor] = useState<"random" | "white" | "black">("random");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api<PlayOptions & Record<string, unknown>>("/api/play/options")
      .then((data) => {
        setOptions(data);
        const presets = data.money?.presets ?? [];
        if (presets[0]) setStake(presets[0]);
      })
      .catch(() => setOptions({ modes: { CASUAL: true, RATED: true, MONEY: false } }));
  }, []);

  const moneyOpen = !!options?.modes.MONEY && !!options.money?.eligible;
  const cadences = [1, 3, 5, 10, 15, 30, 60].filter(
    (m) => !options?.timeControl || (m >= options.timeControl.min && m <= options.timeControl.max),
  );
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api("/api/community/challenges", {
        method: "POST",
        json: {
          to: opponent.id,
          gameType,
          draughtsVariant: gameType === "CHECKERS" ? variant : undefined,
          timeControlMinutes: minutes === "none" ? null : Number(minutes),
          mode,
          stake: mode === "MONEY" ? stake : undefined,
          moneyConsent: mode === "MONEY" ? consent : undefined,
          color,
          message,
        },
      });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Modal title="Défi envoyé" onClose={onClose}>
        <p className="text-sm text-ink-soft">
          {opponent.username} a reçu votre défi. Vous serez dirigé vers la partie dès qu’il l’accepte (onglet « Défis » de la Communauté).
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <a href="/communaute?tab=defis" className="btn btn-primary">Suivre mes défis</a>
          <button type="button" onClick={onClose} className="btn btn-ghost">Fermer</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Défier ${opponent.username}`} onClose={onClose}>
      {!options ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <fieldset>
            <legend className="eyebrow mb-1.5">Jeu</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["CHECKERS", "CHESS"] as const).map((g) => (
                <button key={g} type="button" onClick={() => setGameType(g)} aria-pressed={gameType === g} className={`btn ${gameType === g ? "btn-primary" : "btn-ghost"}`}>
                  {g === "CHESS" ? "♞ Échecs" : "⛀ Dames"}
                </button>
              ))}
            </div>
          </fieldset>
          {gameType === "CHECKERS" && (
            <label className="block text-sm">
              <span className="eyebrow">Variante</span>
              <select value={variant} onChange={(e) => setVariant(e.target.value as typeof variant)} className="field mt-1.5">
                <option value="INTERNATIONAL">Internationales 10×10</option>
                <option value="ENGLISH">Anglaises 8×8</option>
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="eyebrow">Cadence</span>
              <select value={minutes} onChange={(e) => setMinutes(e.target.value)} className="field mt-1.5">
                {cadences.map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
                <option value="none">Sans pendule</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="eyebrow">Votre couleur</span>
              <select value={color} onChange={(e) => setColor(e.target.value as typeof color)} className="field mt-1.5">
                <option value="random">Au hasard</option>
                <option value="white">Blancs</option>
                <option value="black">Noirs</option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend className="eyebrow mb-1.5">Type de partie</legend>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" disabled={!options.modes.CASUAL} onClick={() => setMode("CASUAL")} aria-pressed={mode === "CASUAL"} className={`btn px-2 ${mode === "CASUAL" ? "btn-primary" : "btn-ghost"}`}>Amicale</button>
              <button type="button" disabled={!options.modes.RATED} onClick={() => setMode("RATED")} aria-pressed={mode === "RATED"} className={`btn px-2 ${mode === "RATED" ? "btn-primary" : "btn-ghost"}`}>Classée</button>
              <button type="button" disabled={!moneyOpen} onClick={() => setMode("MONEY")} aria-pressed={mode === "MONEY"} className={`btn px-2 ${mode === "MONEY" ? "btn-primary" : "btn-ghost"}`} title={moneyOpen ? "" : options.money?.reason ?? "Mode rémunéré fermé"}>
                <Coins className="size-4" /> Argent
              </button>
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">
              {mode === "CASUAL"
                ? "Points classiques uniquement, n’affecte pas votre ELO."
                : mode === "RATED"
                  ? "Compte pour votre classement ELO de cette cadence."
                  : "Points argent : chaque joueur engage la mise, bloquée seulement si votre ami accepte."}
            </p>
          </fieldset>
          {mode === "MONEY" && options.money && (
            <div className="card-muted space-y-3 p-3">
              <label className="block text-sm">
                <span className="eyebrow">Mise par joueur (FCFA)</span>
                <select value={stake} onChange={(e) => setStake(Number(e.target.value))} className="field mt-1.5">
                  {options.money.presets.map((v) => (
                    <option key={v} value={v}>{v} FCFA</option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-ink-muted">Commission de {options.money.commissionPercent} % prélevée sur le gain.</p>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
                <span>J’accepte d’engager <strong>{stake} FCFA de points argent</strong> si ce défi est accepté.</span>
              </label>
            </div>
          )}
          <label className="block text-sm">
            <span className="eyebrow">Message (facultatif)</span>
            <input value={message} maxLength={200} onChange={(e) => setMessage(e.target.value)} className="field mt-1.5" placeholder="Revanche ?" />
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost">Annuler</button>
            <button type="button" onClick={submit} disabled={busy || (mode === "MONEY" && !consent)} className="btn btn-primary">
              Envoyer le défi
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Inviter des amis (tournoi, club, salon privé) ─────────────────────

interface FriendLite {
  id: string;
  username: string;
  avatar: string | null;
  online: boolean;
}

export function InviteFriendsDialog({
  kind,
  target,
  title,
  onClose,
}: {
  kind: "tournament" | "club" | "room";
  target: string;
  title: string;
  onClose: () => void;
}) {
  const [friends, setFriends] = useState<FriendLite[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string>("");

  useEffect(() => {
    api<{ friends: FriendLite[] }>("/api/community/friends")
      .then((d) => setFriends(d.friends))
      .catch((e: Error) => {
        setError(e.message);
        setFriends([]);
      });
  }, []);

  const visible = useMemo(
    () => (friends ?? []).filter((f) => f.username.toLowerCase().includes(filter.trim().toLowerCase())),
    [friends, filter],
  );

  async function send() {
    setBusy(true);
    setError("");
    try {
      const userIds = [...selected];
      const result =
        kind === "room"
          ? await api<{ invited: number }>(`/api/community/rooms/${encodeURIComponent(target)}`, { method: "POST", json: { action: "invite", userIds } })
          : await api<{ invited: number }>("/api/community/invitations", { method: "POST", json: { action: "send", kind, target, userIds } });
      setDone(result.invited > 0 ? `${result.invited} invitation(s) envoyée(s).` : "Ces amis étaient déjà invités ou inscrits.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {friends === null ? (
        <Spinner />
      ) : done ? (
        <>
          <Notice tone="success">{done}</Notice>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={onClose} className="btn btn-primary">Fermer</button>
          </div>
        </>
      ) : friends.length === 0 ? (
        <p className="text-sm text-ink-muted">Ajoutez des amis depuis la Communauté pour pouvoir les inviter.</p>
      ) : (
        <div className="space-y-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} className="field pl-9" placeholder="Filtrer mes amis" />
          </label>
          <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {visible.map((f) => {
              const on = selected.has(f.id);
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = new Set(selected);
                      if (on) next.delete(f.id);
                      else next.add(f.id);
                      setSelected(next);
                    }}
                    aria-pressed={on}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${on ? "bg-accent/10" : "hover:bg-surface-2"}`}
                  >
                    <Avatar user={f} size={30} online={f.online} />
                    <span className="flex-1 truncate font-medium">{f.username}</span>
                    <span className={`flex size-5 items-center justify-center rounded-md border ${on ? "border-accent bg-accent text-accent-ink" : "border-line-strong"}`}>
                      {on && <Check className="size-3.5" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-ink-muted">
            Les invités doivent toujours remplir les conditions d’inscription (places, niveau, droits d’entrée).
          </p>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost">Annuler</button>
            <button type="button" onClick={send} disabled={busy || selected.size === 0} className="btn btn-primary">
              Inviter {selected.size > 0 ? `(${selected.size})` : ""}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Signaler ──────────────────────────────────────────────────────────

const REASONS: [string, string][] = [
  ["SPAM", "Spam ou publicité"],
  ["HARASSMENT", "Harcèlement ou insultes"],
  ["HATE", "Propos haineux"],
  ["CHEATING", "Triche ou arrangement de parties"],
  ["INAPPROPRIATE", "Contenu inapproprié"],
  ["SCAM", "Arnaque ou fraude"],
  ["OTHER", "Autre"],
];

export function ReportDialog({ targetType, targetId, onClose }: { targetType: "POST" | "COMMENT" | "USER"; targetId: string; onClose: () => void }) {
  const [reason, setReason] = useState("SPAM");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  async function submit() {
    setState("busy");
    setError("");
    try {
      await api("/api/community/reports", { method: "POST", json: { targetType, targetId, reason, details } });
      setState("done");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  }
  return (
    <Modal title="Signaler" onClose={onClose}>
      {state === "done" ? (
        <>
          <Notice tone="success">Merci : la modération va examiner ce signalement.</Notice>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={onClose} className="btn btn-primary">Fermer</button>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            {REASONS.map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="reason" checked={reason === value} onChange={() => setReason(value)} />
                {label}
              </label>
            ))}
          </div>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={500} rows={3} className="field" placeholder="Précisions (facultatif)" />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost">Annuler</button>
            <button type="button" onClick={submit} disabled={state === "busy"} className="btn btn-danger">Envoyer le signalement</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Raccourci : redirige vers une partie dès qu'un défi envoyé est accepté. */
export function useChallengeRedirect(enabled: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const startedAt = Date.now();
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const data = await api<{ challenges: { direction: string; matchId: string | null; matchLive: boolean; status: string; createdAt: string }[] }>("/api/community/challenges");
        const live = data.challenges.find((c) => c.direction === "SENT" && c.status === "ACCEPTED" && c.matchLive && c.matchId && new Date(c.createdAt).getTime() > startedAt - 30 * 60_000);
        if (live?.matchId) router.push(`/match/${live.matchId}`);
      } catch {
        // réseau momentanément indisponible : on réessaie au prochain tour
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [enabled, router]);
}
