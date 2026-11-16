/**
 * Test d'intégration sur la base PostgreSQL locale (données créées puis supprimées).
 * Lancement : npm run test:integration
 *
 * Vérifie : séparation des trois systèmes de points, ELO par pool, plancher
 * des points classiques, verrouillage concurrent des mises, idempotence du
 * règlement, conservation des fonds et annulation avec remboursement.
 */
import { MatchMode, MatchStatus, Prisma } from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import { lockMoneyMatchStakes } from "@/lib/economy/money-matches";
import { abortMatch, settleMatch } from "@/lib/scoring/settle-match";
import { invalidateSettingsCache } from "@/lib/settings/service";

const tag = `it${Date.now().toString(36)}`;
const userIds: string[] = [];
const matchIds: string[] = [];
let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail ?? "");
  }
}

async function user(name: string, data: Partial<Prisma.UserCreateInput> = {}) {
  const created = await prisma.user.create({ data: { username: `${tag}_${name}`.slice(0, 24), ...data } });
  userIds.push(created.id);
  return created;
}

async function match(white: string, black: string, data: Partial<Prisma.MatchUncheckedCreateInput> = {}) {
  const created = await prisma.match.create({
    data: {
      playerWhiteId: white,
      playerBlackId: black,
      gameType: "CHECKERS",
      draughtsVariant: "INTERNATIONAL",
      status: MatchStatus.IN_PROGRESS,
      ...data,
    },
  });
  matchIds.push(created.id);
  return created;
}

const touchedSettings = ["money.enabled", "money.requireVerification", "money.commissionPercent", "money.maxGamesVsSameOpponentPerDay"];
const savedSettings = new Map<string, Prisma.JsonValue | undefined>();

async function setSetting(key: string, value: Prisma.InputJsonValue) {
  if (!savedSettings.has(key)) {
    const row = await prisma.tournamentConfig.findUnique({ where: { key } });
    savedSettings.set(key, row?.value);
  }
  await prisma.tournamentConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
  invalidateSettingsCache();
}

async function restoreSettings() {
  for (const key of touchedSettings) {
    if (!savedSettings.has(key)) continue;
    const previous = savedSettings.get(key);
    if (previous === undefined) await prisma.tournamentConfig.deleteMany({ where: { key } });
    else await prisma.tournamentConfig.update({ where: { key }, data: { value: previous as Prisma.InputJsonValue } });
  }
  invalidateSettingsCache();
}

async function main() {
  console.log("1. Partie amicale : points classiques, plancher à zéro, aucun ELO");
  {
    const a = await user("casA", { pointsFree: 100, elo: 1300 });
    const b = await user("casB", { pointsFree: 2, elo: 1300 });
    const m = await match(a.id, b.id, { mode: MatchMode.CASUAL, timeControlMinutes: 5 });
    const r = await settleMatch({ matchId: m.id, winnerId: a.id, whiteRemainingPieces: 12, blackRemainingPieces: 2 });
    const [ua, ub] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: a.id } }), prisma.user.findUniqueOrThrow({ where: { id: b.id } })]);
    check("le vainqueur gagne des points", r.whitePointsChange > 0 && ua.pointsFree === 100 + r.whitePointsChange);
    check("le perdant ne descend pas sous zéro", ub.pointsFree === 0, ub.pointsFree);
    check("aucun ELO modifié en amical", ua.elo === 1300 && ub.elo === 1300 && r.whiteEloChange === 0);
    check("aucun classement de pool créé", (await prisma.playerRating.count({ where: { userId: { in: [a.id, b.id] } } })) === 0);
  }

  console.log("2. Partie classée : ELO du pool Dames 10×10 / Blitz");
  {
    const a = await user("ratA", { pointsFree: 50, elo: 1400 });
    const b = await user("ratB", { pointsFree: 50, elo: 1400 });
    const m = await match(a.id, b.id, { mode: MatchMode.RATED, rated: true, timeControlMinutes: 5 });
    const r = await settleMatch({ matchId: m.id, winnerId: b.id, whiteRemainingPieces: 3, blackRemainingPieces: 6 });
    const pools = await prisma.playerRating.findMany({ where: { userId: { in: [a.id, b.id] } } });
    check("deux classements de pool créés", pools.length === 2);
    check("pool INTERNATIONAL / BLITZ", pools.every((p) => p.variant === "INTERNATIONAL" && p.timeControl === "BLITZ"));
    check("le vainqueur gagne de l'ELO", r.blackEloChange > 0 && r.whiteEloChange < 0);
    const updated = await prisma.match.findUniqueOrThrow({ where: { id: m.id } });
    check("pool enregistré sur la partie", updated.ratingPool === "INTERNATIONAL:BLITZ");
    let doubleBlocked = false;
    try {
      await settleMatch({ matchId: m.id, winnerId: a.id, whiteRemainingPieces: 1, blackRemainingPieces: 1 });
    } catch {
      doubleBlocked = true;
    }
    check("un second règlement est refusé (idempotence)", doubleBlocked);
  }

  console.log("3. Partie rémunérée : verrouillage concurrent, règlement unique, conservation des fonds");
  await setSetting("money.enabled", true);
  await setSetting("money.requireVerification", true);
  await setSetting("money.commissionPercent", 10);
  await setSetting("money.maxGamesVsSameOpponentPerDay", 0);
  {
    const a = await user("monA", { pointsFree: 40, walletReal: new Prisma.Decimal(5000), moneyVerified: true });
    const b = await user("monB", { pointsFree: 40, walletReal: new Prisma.Decimal(5000), moneyVerified: true });
    const m = await match(a.id, b.id, { mode: MatchMode.MONEY, stakeAmount: new Prisma.Decimal(1000) });

    const locks = await Promise.allSettled(
      [0, 1].map(() =>
        prisma.$transaction((tx) => lockMoneyMatchStakes(tx, { matchId: m.id, playerIds: [a.id, b.id], stake: 1000 })),
      ),
    );
    check("un seul verrouillage réussit sur deux concurrents", locks.filter((l) => l.status === "fulfilled").length === 1, locks.map((l) => l.status));
    const afterLock = await prisma.user.findMany({ where: { id: { in: [a.id, b.id] } } });
    check("1000 FCFA bloqués chez chaque joueur", afterLock.every((u) => u.walletReal.toNumber() === 4000 && u.walletLocked.toNumber() === 1000));

    const settles = await Promise.allSettled(
      [0, 1, 2].map(() => settleMatch({ matchId: m.id, winnerId: a.id, whiteRemainingPieces: 8, blackRemainingPieces: 1 })),
    );
    check("un seul règlement réussit sur trois concurrents", settles.filter((s) => s.status === "fulfilled").length === 1, settles.map((s) => s.status));
    const [ua, ub] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: a.id } }), prisma.user.findUniqueOrThrow({ where: { id: b.id } })]);
    check("le vainqueur reçoit le pot moins 10 % (5800)", ua.walletReal.toNumber() === 5800, ua.walletReal.toString());
    check("le perdant perd sa mise (4000)", ub.walletReal.toNumber() === 4000, ub.walletReal.toString());
    check("plus aucun fonds bloqué", ua.walletLocked.toNumber() === 0 && ub.walletLocked.toNumber() === 0);
    check("total conservé hors commission (9800 = 10000 - 200)", ua.walletReal.plus(ub.walletReal).toNumber() === 9800);
    check("les points classiques ne bougent pas en mode rémunéré", ua.pointsFree === 40 && ub.pointsFree === 40);
    check("l'ELO ne bouge pas (money.affectsRating = faux)", ua.elo === 1200 && ub.elo === 1200);
  }

  console.log("4. Annulation d'une partie rémunérée : mises intégralement rendues");
  {
    const a = await user("abA", { walletReal: new Prisma.Decimal(3000), moneyVerified: true });
    const b = await user("abB", { walletReal: new Prisma.Decimal(3000), moneyVerified: true });
    const m = await match(a.id, b.id, { mode: MatchMode.MONEY, stakeAmount: new Prisma.Decimal(500) });
    await prisma.$transaction((tx) => lockMoneyMatchStakes(tx, { matchId: m.id, playerIds: [a.id, b.id], stake: 500 }));
    const results = await Promise.all([abortMatch(m.id), abortMatch(m.id)]);
    check("une seule annulation effective", results.filter((r) => r.aborted).length === 1);
    const users = await prisma.user.findMany({ where: { id: { in: [a.id, b.id] } } });
    check("soldes restaurés à 3000 et rien de bloqué", users.every((u) => u.walletReal.toNumber() === 3000 && u.walletLocked.toNumber() === 0));
    const stored = await prisma.match.findUniqueOrThrow({ where: { id: m.id } });
    check("statut ABORTED", stored.status === MatchStatus.ABORTED);
  }

  console.log("5. Solde insuffisant : rien n'est débité");
  {
    const a = await user("poorA", { walletReal: new Prisma.Decimal(5000), moneyVerified: true });
    const b = await user("poorB", { walletReal: new Prisma.Decimal(100), moneyVerified: true });
    const m = await match(a.id, b.id, { mode: MatchMode.MONEY, stakeAmount: new Prisma.Decimal(1000) });
    let refused = false;
    try {
      await prisma.$transaction((tx) => lockMoneyMatchStakes(tx, { matchId: m.id, playerIds: [a.id, b.id], stake: 1000 }));
    } catch {
      refused = true;
    }
    const ua = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    check("verrouillage refusé", refused);
    check("aucun débit partiel chez l'autre joueur (transaction annulée)", ua.walletReal.toNumber() === 5000 && ua.walletLocked.toNumber() === 0);
  }
}

main()
  .catch((error) => {
    failures += 1;
    console.error("Erreur inattendue :", error);
  })
  .finally(async () => {
    await restoreSettings().catch((e) => console.error("Restauration des paramètres impossible :", e));
    await prisma.balanceTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.ratingHistory.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.matchResult.deleteMany({ where: { matchId: { in: matchIds } } });
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    await prisma.playerRating.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nTous les contrôles d'intégration sont passés." : `\n${failures} contrôle(s) en échec.`);
    process.exit(failures === 0 ? 0 : 1);
  });
