import type { GameMode, MatchmakingCriteria, MatchmakingStrategy } from "../types";

export interface PlayerProfile {
  username: string;
  pointsFree: number;
  country: string | null;
  city: string | null;
  neighborhood: string | null;
  draughtsVariant: "ENGLISH" | "INTERNATIONAL";
}

export interface QueueEntry {
  playerId: string;
  gameType: "CHESS" | "CHECKERS";
  /** Variante de dames demandée (null pour les échecs). */
  draughtsVariant: "ENGLISH" | "INTERNATIONAL" | null;
  /** Mode choisi explicitement par le joueur : jamais déduit de son solde. */
  mode: GameMode;
  /** Mise en points argent (mode MONEY uniquement). */
  stake: number | null;
  /** Classement du joueur dans le pool (jeu × variante × cadence). */
  rating: number;
  strategy: MatchmakingStrategy;
  criteria: MatchmakingCriteria;
  timeControlMinutes: number | null;
  profile: PlayerProfile;
  enqueuedAt: number;
  matching?: boolean;
}

export interface MatchmakingRules {
  eloToleranceBase: number;
  eloToleranceGrowthPerSec: number;
  eloToleranceMax: number;
  casualUsesElo: boolean;
  avoidRepeatSeconds: number;
}

export const DEFAULT_MATCHMAKING_RULES: MatchmakingRules = {
  eloToleranceBase: 150,
  eloToleranceGrowthPerSec: 10,
  eloToleranceMax: 800,
  casualUsesElo: false,
  avoidRepeatSeconds: 45,
};

interface Bucket {
  order: string[];
  entries: Map<string, QueueEntry>;
  tail: Promise<void>;
}

/**
 * Deux joueurs ne peuvent se rencontrer que s'ils partagent exactement :
 * jeu, variante, cadence, mode et montant de mise. Un joueur en mode amical
 * ne sera donc jamais apparié dans une partie classée ou rémunérée.
 */
export function bucketKey(entry: Pick<QueueEntry, "gameType" | "draughtsVariant" | "timeControlMinutes" | "mode" | "stake">): string {
  return [
    entry.gameType,
    entry.gameType === "CHECKERS" ? entry.draughtsVariant ?? "INTERNATIONAL" : "-",
    entry.timeControlMinutes ?? "ANY",
    entry.mode,
    entry.mode === "MONEY" ? entry.stake ?? 0 : "-",
  ].join(":");
}

function normalizeLocation(value: string | null): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

export function meetsCriteria(
  profile: PlayerProfile,
  criteria: MatchmakingCriteria,
): boolean {
  if (criteria.minPoints !== undefined && profile.pointsFree < criteria.minPoints) {
    return false;
  }
  if (criteria.maxPoints !== undefined && profile.pointsFree > criteria.maxPoints) {
    return false;
  }
  for (const key of ["country", "city", "neighborhood"] as const) {
    const wanted = criteria[key];
    if (
      wanted &&
      normalizeLocation(profile[key]) !== wanted.trim().toLocaleLowerCase()
    ) {
      return false;
    }
  }
  return true;
}

/** Écart ELO toléré pour un joueur ayant attendu `waitedMs`. */
export function eloTolerance(waitedMs: number, rules: MatchmakingRules): number {
  return Math.min(
    rules.eloToleranceMax,
    rules.eloToleranceBase + (Math.max(0, waitedMs) / 1000) * rules.eloToleranceGrowthPerSec,
  );
}

export function areCompatible(
  a: QueueEntry,
  b: QueueEntry,
  now: number,
  rules: MatchmakingRules,
  recentOpponents: Map<string, { opponentId: string; at: number }>,
): boolean {
  if (a.playerId === b.playerId) return false;
  if (bucketKey(a) !== bucketKey(b)) return false;

  // Critères explicites (ciblé : points, localisation).
  const aOk = a.strategy === "RANDOM" || meetsCriteria(b.profile, a.criteria);
  const bOk = b.strategy === "RANDOM" || meetsCriteria(a.profile, b.criteria);
  if (!aOk || !bOk) return false;

  // Équilibre des niveaux : la tolérance s'élargit avec l'attente du plus patient.
  const useElo = a.mode !== "CASUAL" || rules.casualUsesElo;
  if (useElo) {
    const tolerance = Math.max(
      eloTolerance(now - a.enqueuedAt, rules),
      eloTolerance(now - b.enqueuedAt, rules),
    );
    if (Math.abs(a.rating - b.rating) > tolerance) return false;
  }

  // Éviter de réaffronter immédiatement le même adversaire.
  if (rules.avoidRepeatSeconds > 0) {
    const windowMs = rules.avoidRepeatSeconds * 1000;
    const lastA = recentOpponents.get(a.playerId);
    const lastB = recentOpponents.get(b.playerId);
    if (lastA && lastA.opponentId === b.playerId && now - lastA.at < windowMs) return false;
    if (lastB && lastB.opponentId === a.playerId && now - lastB.at < windowMs) return false;
  }
  return true;
}

export class MatchmakingQueue {
  private buckets = new Map<string, Bucket>();
  private byPlayer = new Map<string, { key: string; matching: boolean }>();
  private recentOpponents = new Map<string, { opponentId: string; at: number }>();
  private rules: MatchmakingRules = DEFAULT_MATCHMAKING_RULES;

  setRules(rules: MatchmakingRules): void {
    this.rules = rules;
  }

  recordPairing(a: string, b: string, at = Date.now()): void {
    this.recentOpponents.set(a, { opponentId: b, at });
    this.recentOpponents.set(b, { opponentId: a, at });
  }

  /** Nombre de joueurs en attente par mode (affichage). */
  stats(): Record<string, number> {
    const out: Record<string, number> = { CASUAL: 0, RATED: 0, MONEY: 0 };
    for (const bucket of this.buckets.values()) {
      for (const entry of bucket.entries.values()) out[entry.mode] = (out[entry.mode] ?? 0) + 1;
    }
    return out;
  }

  isQueued(playerId: string): boolean {
    return this.byPlayer.has(playerId);
  }

  private getBucket(key: string): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { order: [], entries: new Map(), tail: Promise.resolve() };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private async runExclusive<T>(key: string, fn: (bucket: Bucket) => T | Promise<T>): Promise<T> {
    const bucket = this.getBucket(key);
    const run = bucket.tail.then(() => fn(bucket), () => fn(bucket));
    bucket.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private removeFromBucket(bucket: Bucket, playerId: string): QueueEntry | undefined {
    const entry = bucket.entries.get(playerId);
    if (!entry) return undefined;
    bucket.entries.delete(playerId);
    const idx = bucket.order.indexOf(playerId);
    if (idx !== -1) bucket.order.splice(idx, 1);
    return entry;
  }

  private findOpponent(bucket: Bucket, entry: QueueEntry, now: number): QueueEntry | undefined {
    // FIFO : un joueur qui attend depuis plus de 5 s est servi en priorité ;
    // sinon on choisit l'adversaire compatible au niveau le plus proche.
    let closest: QueueEntry | undefined;
    for (const opponentId of bucket.order) {
      const opponent = bucket.entries.get(opponentId);
      if (!opponent || opponent.matching || opponent.playerId === entry.playerId) continue;
      if (!areCompatible(entry, opponent, now, this.rules, this.recentOpponents)) continue;
      if (now - opponent.enqueuedAt >= 5_000) return opponent;
      if (!closest || Math.abs(opponent.rating - entry.rating) < Math.abs(closest.rating - entry.rating)) {
        closest = opponent;
      }
    }
    return closest;
  }

  async enqueue(entry: QueueEntry): Promise<
    | { status: "queued" }
    | { status: "matched"; opponent: QueueEntry; self: QueueEntry }
  > {
    const key = bucketKey(entry);
    // Changement de paramètres : retirer l'ancienne inscription.
    const prev = this.byPlayer.get(entry.playerId);
    if (prev && prev.key !== key && !prev.matching) {
      await this.remove(entry.playerId);
    }
    return this.runExclusive(key, async (bucket) => {
      const existing = bucket.entries.get(entry.playerId);
      if (existing) {
        if (existing.matching) return { status: "queued" as const };
        existing.strategy = entry.strategy;
        existing.criteria = entry.criteria;
        existing.profile = entry.profile;
        existing.rating = entry.rating;
        this.byPlayer.set(entry.playerId, { key, matching: false });
        return { status: "queued" as const };
      }

      const opponent = this.findOpponent(bucket, entry, Date.now());
      if (opponent) {
        opponent.matching = true;
        entry.matching = true;
        this.removeFromBucket(bucket, opponent.playerId);
        this.byPlayer.set(opponent.playerId, { key, matching: true });
        this.byPlayer.set(entry.playerId, { key, matching: true });
        return { status: "matched" as const, opponent, self: entry };
      }

      entry.matching = false;
      bucket.entries.set(entry.playerId, entry);
      bucket.order.push(entry.playerId);
      this.byPlayer.set(entry.playerId, { key, matching: false });
      return { status: "queued" as const };
    });
  }

  /**
   * Repasse sur chaque file pour apparier les joueurs dont la tolérance ELO
   * s'est élargie depuis leur arrivée. Retourne les paires réservées.
   */
  async sweep(now = Date.now()): Promise<Array<{ self: QueueEntry; opponent: QueueEntry }>> {
    const pairs: Array<{ self: QueueEntry; opponent: QueueEntry }> = [];
    for (const key of [...this.buckets.keys()]) {
      await this.runExclusive(key, (bucket) => {
        for (const playerId of [...bucket.order]) {
          const entry = bucket.entries.get(playerId);
          if (!entry || entry.matching) continue;
          const opponent = this.findOpponent(bucket, entry, now);
          if (!opponent) continue;
          entry.matching = true;
          opponent.matching = true;
          this.removeFromBucket(bucket, entry.playerId);
          this.removeFromBucket(bucket, opponent.playerId);
          this.byPlayer.set(entry.playerId, { key, matching: true });
          this.byPlayer.set(opponent.playerId, { key, matching: true });
          // Le joueur arrivé en dernier joue « self » (noirs), comme dans enqueue.
          const [first, second] =
            entry.enqueuedAt <= opponent.enqueuedAt ? [entry, opponent] : [opponent, entry];
          pairs.push({ opponent: first, self: second });
        }
        if (bucket.entries.size === 0) this.buckets.delete(key);
      });
    }
    // Purge des souvenirs d'adversaires périmés.
    const windowMs = this.rules.avoidRepeatSeconds * 1000;
    for (const [playerId, info] of this.recentOpponents) {
      if (now - info.at > windowMs) this.recentOpponents.delete(playerId);
    }
    return pairs;
  }

  async remove(playerId: string): Promise<boolean> {
    const loc = this.byPlayer.get(playerId);
    if (!loc) return false;
    if (loc.matching) return false;
    return this.runExclusive(loc.key, (bucket) => {
      const current = this.byPlayer.get(playerId);
      if (!current || current.matching) return false;
      const removed = this.removeFromBucket(bucket, playerId);
      this.byPlayer.delete(playerId);
      return Boolean(removed);
    });
  }

  async finalizeMatch(playerId: string): Promise<void> {
    const loc = this.byPlayer.get(playerId);
    if (!loc) return;
    await this.runExclusive(loc.key, () => {
      this.byPlayer.delete(playerId);
    });
  }

  async releaseReservation(playerId: string, entry: QueueEntry, front = true): Promise<void> {
    const key = bucketKey(entry);
    await this.runExclusive(key, (bucket) => {
      this.removeFromBucket(bucket, playerId);
      entry.matching = false;
      bucket.entries.set(playerId, entry);
      if (front) bucket.order.unshift(playerId);
      else bucket.order.push(playerId);
      this.byPlayer.set(playerId, { key, matching: false });
    });
  }

  async requeueFrontIfConnected(playerId: string, entry: QueueEntry, isConnected: () => boolean): Promise<boolean> {
    const key = bucketKey(entry);
    return this.runExclusive(key, (bucket) => {
      this.byPlayer.delete(playerId);
      if (!isConnected()) return false;
      this.removeFromBucket(bucket, playerId);
      entry.matching = false;
      bucket.entries.set(playerId, entry);
      bucket.order.unshift(playerId);
      this.byPlayer.set(playerId, { key, matching: false });
      return true;
    });
  }
}
