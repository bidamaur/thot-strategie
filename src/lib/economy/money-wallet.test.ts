import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma-client";
import { computePayout } from "./money-wallet";

describe("computePayout", () => {
  it("verse le pot moins la commission", () => {
    const { pot, commission, payout } = computePayout(new Prisma.Decimal(1000), 10);
    expect(pot.toNumber()).toBe(2000);
    expect(commission.toNumber()).toBe(200);
    expect(payout.toNumber()).toBe(1800);
  });

  it("arrondit la commission au centime", () => {
    const { commission, payout } = computePayout(new Prisma.Decimal(333), 7.5);
    expect(commission.toFixed(2)).toBe("49.95");
    expect(payout.plus(commission).toNumber()).toBe(666);
  });

  it("sans commission, le gagnant récupère tout", () => {
    expect(computePayout(new Prisma.Decimal(500), 0).payout.toNumber()).toBe(1000);
  });
});
