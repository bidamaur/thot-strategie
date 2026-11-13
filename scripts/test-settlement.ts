import { settleMatch, MatchSettlementError } from "@/lib/scoring/settle-match";
import { prisma } from "@/lib/prisma";

const settledIds: string[] = [];
const userIds: string[] = [];

async function createUser(username: string, pointsFree = 1000, elo = 1200) {
  const u = await prisma.user.create({
    data: { username, pointsFree, elo },
  });
  userIds.push(u.id);
  return u;
}

async function createMatch(opts: any = {}) {
  const m = await prisma.match.create({
    data: {
      playerWhiteId: opts.playerWhiteId,
      playerBlackId: opts.playerBlackId,
      gameType: opts.gameType ?? "CHECKERS",
      rated: opts.rated ?? false,
      betEnabled: opts.betEnabled ?? false,
      betAmount: opts.betAmount ?? 0,
      betStatus: opts.betStatus ?? null,
      betProposedById: opts.betProposedById ?? null,
      status: opts.status ?? "IN_PROGRESS",
      timeControlMinutes: opts.timeControlMinutes ?? null,
      draughtsVariant: opts.draughtsVariant ?? "INTERNATIONAL",
    },
  });
  settledIds.push(m.id);
  return m;
}

async function createBet(opts: any = {}) {
  return prisma.gameBet.create({
    data: {
      matchId: opts.matchId,
      proposerId: opts.proposerId,
      opponentId: opts.opponentId,
      amount: opts.amount,
      status: opts.status ?? "PROPOSED",
    },
  });
}

async function getBalance(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  return u!.pointsFree;
}

async function getElo(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  return u!.elo;
}

async function cleanup() {
  for (const id of settledIds) {
    await prisma.matchResult.deleteMany({ where: { matchId: id } }).catch(() => {});
    await prisma.gameBetTransaction.deleteMany({ where: { betId: id } }).catch(() => {});
    await prisma.gameBet.deleteMany({ where: { matchId: id } }).catch(() => {});
    await prisma.ratingHistory.deleteMany({ where: { matchId: id } }).catch(() => {});
    await prisma.match.delete({ where: { id } }).catch(() => {});
  }
  for (const id of userIds) {
    await prisma.userSession.deleteMany({ where: { userId: id } }).catch(() => {});
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
}

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e: any) {
    failed++;
    console.log(`  FAIL: ${name} — ${e.message}`);
  }
}

async function main() {
  console.log("=== Phase 5: ELO/Bet Settlement Tests (21 cases) ===\n");

  // ── Mode A: no bet ──
  await test("T1: Win without bet — winner gains points, loser loses none", async () => {
    const white = await createUser("t1_white", 500, 1200);
    const black = await createUser("t1_black", 500, 1200);
    const match = await createMatch({ playerWhiteId: white.id, playerBlackId: black.id, rated: true, betEnabled: false });

    const result = await settleMatch({
      matchId: match.id, winnerId: white.id, whiteRemainingPieces: 12, blackRemainingPieces: 4,
      finalStatus: "FINISHED", result: "WIN",
    });

    assert(result.whiteResult === "WIN", "whiteResult is WIN");
    assert(result.blackResult === "LOSS", "blackResult is LOSS");
    assert(result.scoreDelta! > 0, "scoreDelta > 0");
    assert(result.betSettled === false, "betSettled is false");
    assert(result.betAmount === null, "betAmount is null");

    const wb = await getBalance(white.id);
    const bb = await getBalance(black.id);
    assert(wb === 500 + result.scoreDelta!, `white balance = ${500 + result.scoreDelta!}, got ${wb}`);
    assert(bb === 500, `black balance stays 500, got ${bb}`);
  });

  await test("T2: Loss without bet — winner gains points, loser loses none", async () => {
    const white = await createUser("t2_white", 500, 1200);
    const black = await createUser("t2_black", 500, 1200);
    const match = await createMatch({ playerWhiteId: white.id, playerBlackId: black.id, rated: true, betEnabled: false });

    const result = await settleMatch({
      matchId: match.id, winnerId: black.id, whiteRemainingPieces: 4, blackRemainingPieces: 12,
      finalStatus: "FINISHED", result: "LOSS",
    });

    assert(result.whiteResult === "LOSS", "whiteResult is LOSS");
    assert(result.blackResult === "WIN", "blackResult is WIN");
    assert(result.scoreDelta! > 0, "scoreDelta > 0");

    const wb = await getBalance(white.id);
    const bb = await getBalance(black.id);
    assert(wb === 500, `white balance stays 500, got ${wb}`);
    assert(bb === 500 + result.scoreDelta!, `black balance = ${500 + result.scoreDelta!}, got ${bb}`);
  });

  await test("T3: Draw without bet — no scoreDelta, both keep points", async () => {
    const white = await createUser("t3_white", 500, 1200);
    const black = await createUser("t3_black", 500, 1200);
    const match = await createMatch({ playerWhiteId: white.id, playerBlackId: black.id, rated: true, betEnabled: false });

    const result = await settleMatch({
      matchId: match.id, winnerId: null, whiteRemainingPieces: 8, blackRemainingPieces: 8,
      finalStatus: "FINISHED", result: "DRAW",
    });

    assert(result.scoreDelta === 0, "scoreDelta is 0");
    assert(result.whiteResult === "DRAW", "whiteResult is DRAW");
    assert(result.blackResult === "DRAW", "blackResult is DRAW");
    assert(result.betSettled === false, "betSettled is false");

    const wb = await getBalance(white.id);
    const bb = await getBalance(black.id);
    assert(wb === 500, `white balance stays 500, got ${wb}`);
    assert(bb === 500, `black balance stays 500, got ${bb}`);
  });

  await test("T4: Win without bet, not rated — points awarded, no Elo change", async () => {
    const white = await createUser("t4_white", 500, 1200);
    const black = await createUser("t4_black", 500, 1200);
    const match = await createMatch({ playerWhiteId: white.id, playerBlackId: black.id, rated: false, betEnabled: false });

    const result = await settleMatch({
      matchId: match.id, winnerId: white.id, whiteRemainingPieces: 12, blackRemainingPieces: 4,
      finalStatus: "FINISHED", result: "WIN",
    });

    assert(result.scoreDelta! > 0, "scoreDelta > 0");
    assert(result.whiteEloChange === 0, "whiteEloChange is 0");
    assert(result.blackEloChange === 0, "blackEloChange is 0");

    const we = await getElo(white.id);
    const be = await getElo(black.id);
    assert(we === 1200, `white Elo stays 1200, got ${we}`);
    assert(be === 1200, `black Elo stays 1200, got ${be}`);
  });

  await test("T5: Win without bet, rated — points and Elo change", async () => {
    const white = await createUser("t5_white", 500, 1200);
    const black = await createUser("t5_black", 500, 1200);
    const match = await createMatch({ playerWhiteId: white.id, playerBlackId: black.id, rated: true, betEnabled: false });

    const result = await settleMatch({
      matchId: match.id, winnerId: white.id, whiteRemainingPieces: 12, blackRemainingPieces: 4,
      finalStatus: "FINISHED", result: "WIN",
    });

    assert(result.scoreDelta! > 0, "scoreDelta > 0");
    assert(result.whiteEloChange !== 0, "whiteEloChange !== 0");
    assert(result.blackEloChange !== 0, "blackEloChange !== 0");
    assert(result.whiteEloChange === -result.blackEloChange, "Elo changes are symmetric");
  });

  // ── Mode B: with bet ──
  await test("T6: Win with bet — winner gets own bet back + opponent's bet", async () => {
    const white = await createUser("t6_white", 1000, 1200);
    const black = await createUser("t6_black", 1000, 1200);
    const match = await createMatch({
      playerWhiteId: white.id, playerBlackId: black.id, rated: false,
      betEnabled: true, betAmount: 100, betStatus: "ACCEPTED", betProposedById: white.id,
    });
    await createBet({ matchId: match.id, proposerId: white.id, opponentId: black.id, amount: 100, status: "ACCEPTED" });

    const result = await settleMatch({
      matchId: match.id, winnerId: white.id, whiteRemainingPieces: 12, blackRemainingPieces: 4,
      finalStatus: "FINISHED", result: "WIN",
    });

    assert(result.betSettled === true, "betSettled is true");
    assert(result.betAmount === 100, "betAmount is 100");
    assert(result.whiteResult === "WIN", "whiteResult is WIN");
    assert(result.blackResult === "LOSS", "blackResult is LOSS");

    const wb = await getBalance(white.id);
    const bb = await getBalance(black.id);
    assert(wb > 1000, `white balance > 1000, got ${wb}`);
    assert(bb < 1000, `black balance < 1000, got ${bb}`);
  });

  await test("T7: Loss with bet — black wins, gets own bet back + white's bet", async () => {
    const white = await createUser("t7_white", 1000, 1200);
    const black = await createUser("t7_black", 1000, 1200);
    const match = await createMatch({
      playerWhiteId: white.id, playerBlackId: black.id, rated: false,
      betEnabled: true, betAmount: 100, betStatus: "ACCEPTED", betProposedById: white.id,
    });
    await createBet({ matchId: match.id, proposerId: white.id, opponentId: black.id, amount: 100, status: "ACCEPTED" });

    const result = await settleMatch({
      matchId: match.id, winnerId: black.id, whiteRemainingPieces: 4, blackRemainingPieces: 12,
      finalStatus: "FINISHED", result: "LOSS",
    });

    assert(result.betSettled === true, "betSettled is true");
    assert(result.betAmount === 100, "betAmount is 100");
    assert(result.whiteResult === "LOSS", "whiteResult is LOSS");
    assert(result.blackResult === "WIN", "blackResult is WIN");

    const wb = await getBalance(white.id);
    const bb = await getBalance(black.id);
    assert(wb < 1000, `white balance < 1000, got ${wb}`);
    assert(bb > 1000, `black balance > 1000, got ${bb}`);
  });

  await test("T8: Draw with bet — both bets refunded", async () => {
    const white = await createUser("t8_white", 1000, 1200);
    const black = await createUser("t8_black", 1000, 1200);
    const match = await createMatch({
      playerWhiteId: white.id, playerBlackId: black.id, rated: false,
      betEnabled: true, betAmount: 100, betStatus: "ACCEPTED", betProposedById: white.id,
    });
    await createBet({ matchId: match.id, proposerId: white.id, opponentId: black.id, amount: 100, status: "ACCEPTED" });
    // Simulate escrow deduction at bet acceptance (done by socket server)
    await prisma.user.update({ where: { id: white.id }, data: { pointsFree: { decrement: 100 } } });
    await prisma.user.update({ where: { id: black.id }, data: { pointsFree: { decrement: 100 } } });

    const result = await settleMatch({
      matchId: match.id, winnerId: null, whiteRemainingPieces: 8, blackRemainingPieces: 8,
      finalStatus: "FINISHED", result: "DRAW",
    });

    assert(result.betSettled === true, "betSettled is true");
    assert(result.betAmount === 100, "betAmount is 100");
    assert(result.whiteResult === "DRAW", "whiteResult is DRAW");
    assert(result.blackResult === "DRAW", "blackResult is DRAW");

    const wb = await getBalance(white.id);
    const bb = await getBalance(black.id);
    assert(wb === 1000, `white balance = 1000, got ${wb}`);
    assert(bb === 1000, `black balance = 1000, got ${bb}`);
  });

  // ── Bet lifecycle ──
  await test("T9: Bet accepted then white wins — full settlement", async () => {
    const white = await createUser("t9_white", 1000, 1200);
    const black = await createUser("t9_black", 1000, 1200);
    const match = await createMatch({
      playerWhiteId: white.id, playerBlackId: black.id, rated: false,
      betEnabled: true, betAmount: 200, betStatus: "ACCEPTED", betProposedById: black.id,
    });
    await createBet({ matchId: match.id, proposerId: black.id, opponentId: white.id, amount: 200, status: "ACCEPTED" });

    const result = await settleMatch({
      matchId: match.id, winnerId: white.id, whiteRemainingPieces: 14, blackRemainingPieces: 2,
      finalStatus: "FINISHED", result: "WIN",
    });

    assert(result.betSettled === true, "betSettled is true");
    assert(result.betAmount === 200, "betAmount is 200");
    assert(result.whiteResult === "WIN", "whiteResult is WIN");
  });

  await test("T10: Bet proposed then rejected — no bet settlement", async () => {
    const white = await createUser("t10_white", 1000, 1200);
    const black = await createUser("t10_black", 1000, 1200);
    const match = await createMatch({
      playerWhiteId: white.id, playerBlackId: black.id, rated: false,
      betEnabled: false, betAmount: 0, betStatus: "REJECTED", betProposedById: null,
    });

    const result = await settleMatch({
      matchId: match.id, winnerId: white.id, whiteRemainingPieces: 12, blackRemainingPieces: 4,
      finalStatus: "FINISHED", result: "WIN",
    });

    assert(result.betSettled === false, "betSettled is false");
    assert(result.betAmount === null, "betAmount is null");
    assert(result.scoreDelta! > 0, "scoreDelta > 0");
  });

  await test("T11: Bet proposed then countered then accepted", async () => {
    const white = await createUser("t11_white", 1000, 1200);
    const black = await createUser("t11_black", 1000, 1200);
    const match = await createMatch({
      playerWhiteId: white.id, playerBlackId: black.id, rated: false,
      betEnabled: true, betAmount: 150, betStatus: "ACCEPTED", betProposedById: black.id,
    });
    await createBet({ matchId: match.id, proposerId: black.id, opponentId: white.id, amount: 150, status: "ACCEPTED" });

    const result = await settleMatch({
      matchId: match.id, winnerId: white.id, whiteRemainingPieces: 12, blackRemainingPieces: 6,
      finalStatus: "FINISHED", result: "WIN",
    });

    assert(result.betSettled === true, "betSettled is true");
    assert(result.betAmount === 150, "betAmount is 150");
    assert(result.whiteResult === "WIN", "whiteResult is WIN");
  });

  await test("T12: Bet proposed then countered then rejected — falls back to no bet", async () => {
    const white = await createUser("t12_white", 1000, 1200);
    const black = await createUser("t12_black", 1000, 1200);
    const match = await createMatch({
      playerWhiteId: white.id, playerBlackId: black.id, rated: false,
      betEnabled: false, betAmount: 0, betStatus: "REJECTED", betProposedById: null,
    });

    const result = await settleMatch({
      matchId: match.id, winnerId: white.id, whiteRemainingPieces: 10, blackRemainingPieces: 5,
      finalStatus: "FINISHED", result: "WIN",
    });

    assert(result.betSettled === false, "betSettled is false");
    assert(result.betAmount === null, "betAmount is null");
  });

  await test("T13: Bet with insufficient balance — settles anyway (validated before accept)", async () => {
    const white = await createUser("t13_white", 10, 1200);
    const black = await createUser("t13_black", 1000, 1200);
    const match = await createMatch({
      playerWhiteId: white.id, playerBlackId: black.id, rated: false,
      betEnabled: true, betAmount: 500, betStatus: "ACCEPTED", betProposedById: white.id,
    });
    await createBet({ matchId: match.id, proposerId: white.id, opponentId: black.id, amount: 500, status: "ACCEPTED" });

    const result = await settleMatch({
      matchId: match.id, winnerId: white.id, whiteRemainingPieces: 12, blackRemainingPieces: 4,
      finalStatus: "FINISHED", result: "WIN",
    });

    assert(result.betSettled === true, "betSettled is true");
    assert(result.betAmount === 500, "betAmount is 500");
  });

  await test("T14: Bet expires — no settlement, treated as no bet", async () => {
    const white = await createUser("t14_white", 1000, 1200);
    const black = await createUser("t14_black", 1000, 1200);
    const match = await createMatch({
      playerWhiteId: white.id, playerBlackId: black.id, rated: false,
      betEnabled: false, betAmount: 0, betStatus: "EXPIRED", betProposedById: null,
    });

    const result = await settleMatch({
      matchId: match.id, winnerId: white.id, whiteRemainingPieces: 12, blackRemainingPieces: 4,
      finalStatus: "FINISHED", result: "WIN",
    });

    assert(result.betSettled === false, "betSettled is false");
    assert(result.betAmount === null, "betAmount is null");
    assert(result.scoreDelta! > 0, "scoreDelta > 0");
  });

  // ── Settlement edge cases ──
  await test("T15: Double settlement — ALREADY_SETTLED error", async () => {
    const white = await createUser("t15_white", 500, 1200);
    const black = await createUser("t15_black", 500, 1200);
    const match = await createMatch({ playerWhiteId: white.id, playerBlackId: black.id, rated: false, betEnabled: false });

    await settleMatch({
      matchId: match.id, winnerId: white.id, whiteRemainingPieces: 12, blackRemainingPieces: 4,
      finalStatus: "FINISHED", result: "WIN",
    });

    try {
      await settleMatch({
        matchId: match.id, winnerId: black.id, whiteRemainingPieces: 4, blackRemainingPieces: 12,
        finalStatus: "FINISHED", result: "LOSS",
      });
      assert(false, "should have thrown ALREADY_SETTLED");
    } catch (e: any) {
      assert(e.code === "ALREADY_SETTLED", `got code ${e.code}`);
    }
  });

  await test("T16: Match not found — MATCH_NOT_FOUND error", async () => {
    try {
      await settleMatch({
        matchId: "nonexistent_match_id", winnerId: "some_user",
        whiteRemainingPieces: 12, blackRemainingPieces: 4,
        finalStatus: "FINISHED", result: "WIN",
      });
      assert(false, "should have thrown MATCH_NOT_FOUND");
    } catch (e: any) {
      assert(e.code === "MATCH_NOT_FOUND", `got code ${e.code}`);
    }
  });

  await test("T17: Match not in progress — MATCH_NOT_SETTLEABLE error", async () => {
    const white = await createUser("t17_white", 500, 1200);
    const black = await createUser("t17_black", 500, 1200);
    const match = await createMatch({
      playerWhiteId: white.id, playerBlackId: black.id, rated: false, betEnabled: false, status: "FINISHED",
    });

    try {
      await settleMatch({
        matchId: match.id, winnerId: white.id, whiteRemainingPieces: 12, blackRemainingPieces: 4,
        finalStatus: "FINISHED", result: "WIN",
      });
      assert(false, "should have thrown MATCH_NOT_SETTLEABLE");
    } catch (e: any) {
      assert(e.code === "MATCH_NOT_SETTLEABLE", `got code ${e.code}`);
    }
  });

  await test("T18: Simultaneous settlement — second gets ALREADY_SETTLED or MATCH_NOT_SETTLEABLE", async () => {
    const white = await createUser("t18_white", 500, 1200);
    const black = await createUser("t18_black", 500, 1200);
    const match = await createMatch({ playerWhiteId: white.id, playerBlackId: black.id, rated: false, betEnabled: false });

    const [first, second] = await Promise.allSettled([
      settleMatch({ matchId: match.id, winnerId: white.id, whiteRemainingPieces: 12, blackRemainingPieces: 4, finalStatus: "FINISHED", result: "WIN" }),
      settleMatch({ matchId: match.id, winnerId: black.id, whiteRemainingPieces: 4, blackRemainingPieces: 12, finalStatus: "FINISHED", result: "LOSS" }),
    ]);

    const statuses = [first.status, second.status].sort();
    assert(statuses[0] === "fulfilled", "one settlement fulfilled");
    assert(statuses[1] === "rejected", "one settlement rejected");
    if (first.status === "rejected") {
      assert(first.status === "rejected", "first rejected");
      assert((first as any).reason.code === "ALREADY_SETTLED" || (first as any).reason.code === "MATCH_NOT_SETTLEABLE", `got code ${(first as any).reason.code}`);
    }
    if (second.status === "rejected") {
      assert((second as any).reason.code === "ALREADY_SETTLED" || (second as any).reason.code === "MATCH_NOT_SETTLEABLE", `got code ${(second as any).reason.code}`);
    }
  });

  await test("T19: Frontend tampering — wrong winnerId results in draw", async () => {
    const white = await createUser("t19_white", 500, 1200);
    const black = await createUser("t19_black", 500, 1200);
    const tamperer = await createUser("t19_tamperer", 500, 1200);
    const match = await createMatch({ playerWhiteId: white.id, playerBlackId: black.id, rated: false, betEnabled: false });

    const result = await settleMatch({
      matchId: match.id, winnerId: tamperer.id, whiteRemainingPieces: 12, blackRemainingPieces: 4,
      finalStatus: "FINISHED", result: "DRAW",
    });

    assert(result.whiteResult === "DRAW", "whiteResult is DRAW");
    assert(result.blackResult === "DRAW", "blackResult is DRAW");
    assert(result.scoreDelta === 0, "scoreDelta is 0");
  });

  await test("T20: Not rated match — no Elo changes but points still awarded", async () => {
    const white = await createUser("t20_white", 500, 1500);
    const black = await createUser("t20_black", 500, 1000);
    const match = await createMatch({ playerWhiteId: white.id, playerBlackId: black.id, rated: false, betEnabled: false });

    const result = await settleMatch({
      matchId: match.id, winnerId: white.id, whiteRemainingPieces: 12, blackRemainingPieces: 4,
      finalStatus: "FINISHED", result: "WIN",
    });

    assert(result.scoreDelta! > 0, "scoreDelta > 0");
    assert(result.whiteEloChange === 0, "whiteEloChange is 0");
    assert(result.blackEloChange === 0, "blackEloChange is 0");

    const we = await getElo(white.id);
    const be = await getElo(black.id);
    assert(we === 1500, `white Elo stays 1500, got ${we}`);
    assert(be === 1000, `black Elo stays 1000, got ${be}`);
  });

  await test("T21: Time-out finish — same settlement as normal win", async () => {
    const white = await createUser("t21_white", 500, 1200);
    const black = await createUser("t21_black", 500, 1200);
    const match = await createMatch({ playerWhiteId: white.id, playerBlackId: black.id, rated: true, betEnabled: false });

    const result = await settleMatch({
      matchId: match.id, winnerId: white.id, whiteRemainingPieces: 8, blackRemainingPieces: 0,
      finalStatus: "FINISHED", result: "WIN",
    });

    assert(result.whiteResult === "WIN", "whiteResult is WIN");
    assert(result.blackResult === "LOSS", "blackResult is LOSS");
    assert(result.scoreDelta! > 0, "scoreDelta > 0");
    assert(result.betSettled === false, "betSettled is false");
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  await cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
