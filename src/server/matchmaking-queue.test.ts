import { describe, expect, it } from "vitest";
import {
  areCompatible,
  bucketKey,
  eloTolerance,
  MatchmakingQueue,
  DEFAULT_MATCHMAKING_RULES,
  type QueueEntry,
} from "./matchmaking-queue";

let counter = 0;
function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  counter += 1;
  return {
    playerId: `p${counter}`,
    gameType: "CHECKERS",
    draughtsVariant: "INTERNATIONAL",
    mode: "CASUAL",
    stake: null,
    rating: 1200,
    strategy: "RANDOM",
    criteria: {},
    timeControlMinutes: 5,
    profile: {
      username: `p${counter}`,
      pointsFree: 100,
      country: null,
      city: null,
      neighborhood: null,
      draughtsVariant: "INTERNATIONAL",
    },
    enqueuedAt: Date.now(),
    ...overrides,
  };
}

const rules = DEFAULT_MATCHMAKING_RULES;

describe("séparation des modes", () => {
  it("n'apparie jamais une partie amicale avec une partie classée ou rémunérée", () => {
    expect(areCompatible(entry({ mode: "CASUAL" }), entry({ mode: "RATED" }), Date.now(), rules, new Map())).toBe(false);
    expect(areCompatible(entry({ mode: "CASUAL" }), entry({ mode: "MONEY", stake: 500 }), Date.now(), rules, new Map())).toBe(false);
  });

  it("exige la même mise en mode rémunéré", () => {
    expect(bucketKey(entry({ mode: "MONEY", stake: 500 }))).not.toBe(bucketKey(entry({ mode: "MONEY", stake: 1000 })));
    expect(
      areCompatible(entry({ mode: "MONEY", stake: 500 }), entry({ mode: "MONEY", stake: 500 }), Date.now(), rules, new Map()),
    ).toBe(true);
  });

  it("sépare les variantes de dames et les cadences", () => {
    expect(areCompatible(entry({ draughtsVariant: "ENGLISH" }), entry(), Date.now(), rules, new Map())).toBe(false);
    expect(areCompatible(entry({ timeControlMinutes: 3 }), entry({ timeControlMinutes: 10 }), Date.now(), rules, new Map())).toBe(false);
  });
});

describe("tolérance ELO", () => {
  it("s'élargit avec l'attente puis plafonne", () => {
    expect(eloTolerance(0, rules)).toBe(rules.eloToleranceBase);
    expect(eloTolerance(10_000, rules)).toBe(rules.eloToleranceBase + 10 * rules.eloToleranceGrowthPerSec);
    expect(eloTolerance(10_000_000, rules)).toBe(rules.eloToleranceMax);
  });

  it("refuse un écart trop grand en classé, l'accepte après attente", () => {
    const now = Date.now();
    const a = entry({ mode: "RATED", rating: 1200, enqueuedAt: now });
    const b = entry({ mode: "RATED", rating: 1600, enqueuedAt: now });
    expect(areCompatible(a, b, now, rules, new Map())).toBe(false);
    const later = now + 30_000;
    expect(areCompatible(a, b, later, rules, new Map())).toBe(true);
  });

  it("ignore l'ELO en amical par défaut", () => {
    const now = Date.now();
    expect(areCompatible(entry({ rating: 800 }), entry({ rating: 2200 }), now, rules, new Map())).toBe(true);
  });
});

describe("anti-répétition", () => {
  it("évite le dernier adversaire pendant la fenêtre configurée", () => {
    const now = Date.now();
    const a = entry();
    const b = entry();
    const recent = new Map([
      [a.playerId, { opponentId: b.playerId, at: now - 1_000 }],
      [b.playerId, { opponentId: a.playerId, at: now - 1_000 }],
    ]);
    expect(areCompatible(a, b, now, rules, recent)).toBe(false);
    expect(areCompatible(a, b, now + rules.avoidRepeatSeconds * 1000, rules, recent)).toBe(true);
  });
});

describe("MatchmakingQueue", () => {
  it("apparie deux joueurs compatibles et en laisse un incompatible en attente", async () => {
    const queue = new MatchmakingQueue();
    const a = entry({ mode: "RATED" });
    expect((await queue.enqueue(a)).status).toBe("queued");
    expect((await queue.enqueue(entry({ mode: "CASUAL" }))).status).toBe("queued");
    const result = await queue.enqueue(entry({ mode: "RATED" }));
    expect(result.status).toBe("matched");
    if (result.status === "matched") expect(result.opponent.playerId).toBe(a.playerId);
  });

  it("le balayage apparie les joueurs dont la tolérance s'est élargie", async () => {
    const queue = new MatchmakingQueue();
    const t0 = Date.now();
    await queue.enqueue(entry({ mode: "RATED", rating: 1200, enqueuedAt: t0 }));
    await queue.enqueue(entry({ mode: "RATED", rating: 1600, enqueuedAt: t0 }));
    expect(await queue.sweep(t0)).toHaveLength(0);
    const pairs = await queue.sweep(t0 + 60_000);
    expect(pairs).toHaveLength(1);
    expect(queue.stats().RATED).toBe(0);
  });

  it("ne fait jamais affronter un joueur à lui-même", async () => {
    const queue = new MatchmakingQueue();
    const a = entry();
    await queue.enqueue(a);
    const again = await queue.enqueue({ ...a, enqueuedAt: Date.now() });
    expect(again.status).toBe("queued");
  });
});
