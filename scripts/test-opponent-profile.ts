/**
 * Test d'intégration : profil de l'adversaire en salle de jeu.
 * Accès réservé aux joueurs de la partie, Premium vs non-Premium, confidentialité
 * appliquée côté serveur, exactitude des points, tournois à points vs rémunérés,
 * aucun montant financier exposé. Données créées puis supprimées.
 * Lancement : npm run test:opponent-profile
 */
import { MatchStatus, type Prisma } from "@/generated/prisma-client";
import { getOpponentProfile, OpponentProfileError } from "@/lib/opponent-profile/service";
import { getPrivileges } from "@/lib/premium/privileges";
import { prisma } from "@/lib/prisma";

const tag = `op${Date.now().toString(36)}`;
const userIds: string[] = [];
const tournamentIds: string[] = [];
let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail ?? "");
  }
}

async function user(name: string, data: Partial<Prisma.UserCreateInput> = {}) {
  const u = await prisma.user.create({ data: { username: `${tag}${name}`.slice(0, 24), ...data } });
  userIds.push(u.id);
  return u;
}

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));

async function main() {
  const opp = await user("opp", {
    country: "Cameroun", city: "Douala", pointsFree: 347.6, avatar: "/media/avatars/opp.webp",
    privacySettings: {},
  });
  const free = await user("free");
  const premium = await user("prem", { isPremium: true, premiumLevel: 5 });
  const stranger = await user("strg", { isPremium: true, premiumLevel: 5 });
  const others = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => user(`o${i}`, { avatar: i === 1 ? "/media/avatars/o1.webp" : null })));

  // Parties en cours : la consultation se fait depuis ces salles.
  const live = (viewerId: string) =>
    prisma.match.create({
      data: {
        playerWhiteId: opp.id, playerBlackId: viewerId, gameType: "CHECKERS", draughtsVariant: "INTERNATIONAL",
        timeControlMinutes: 5, mode: "RATED", status: MatchStatus.IN_PROGRESS,
      },
    });
  const liveFree = await live(free.id);
  const livePremium = await live(premium.id);

  // Historique (ancien → récent) : V V V D N V V (+ une partie annulée, ignorée).
  const history: { other: number; result: "W" | "L" | "D"; points: number; type?: "CHESS"; status?: MatchStatus }[] = [
    { other: 5, result: "W", points: 10 },
    { other: 5, result: "W", points: 10 },
    { other: 4, result: "W", points: 12 },
    { other: 3, result: "L", points: -8 },
    { other: 2, result: "D", points: 0 },
    { other: 1, result: "W", points: 15, type: "CHESS" },
    { other: 0, result: "W", points: 9, status: MatchStatus.ABANDONED },
  ];
  for (const [i, h] of history.entries()) {
    const other = others[h.other]!;
    const oppWhite = i % 2 === 0;
    const winnerId = h.result === "D" ? null : h.result === "W" ? opp.id : other.id;
    await prisma.match.create({
      data: {
        playerWhiteId: oppWhite ? opp.id : other.id,
        playerBlackId: oppWhite ? other.id : opp.id,
        gameType: h.type ?? "CHECKERS",
        draughtsVariant: h.type ? null : "INTERNATIONAL",
        mode: "RATED",
        status: h.status ?? MatchStatus.FINISHED,
        winnerId,
        createdAt: day(i + 1),
        updatedAt: day(i + 1),
        resultRecord: {
          create: {
            whiteResult: "WIN", blackResult: "LOSS", // non lus par le profil
            whitePointsChange: oppWhite ? h.points : -h.points,
            blackPointsChange: oppWhite ? -h.points : h.points,
            whiteEloChange: 0, blackEloChange: 0, settledAt: day(i + 1),
          },
        },
      },
    });
  }
  await prisma.match.create({
    data: { playerWhiteId: opp.id, playerBlackId: others[5]!.id, gameType: "CHECKERS", status: MatchStatus.ABORTED, updatedAt: day(20) },
  });

  await prisma.playerRating.createMany({
    data: [
      { userId: opp.id, variant: "INTERNATIONAL", timeControl: "BLITZ", eloRating: 1290, gamesPlayed: 5 },
      { userId: opp.id, variant: "CHESS", timeControl: "RAPID", eloRating: 1150, gamesPlayed: 1 },
    ],
  });
  await prisma.ratingHistory.createMany({
    data: [
      { userId: opp.id, variant: "INTERNATIONAL", timeControl: "BLITZ", oldRating: 1200, newRating: 1320, change: 120, reason: "GAME_WIN" },
      { userId: opp.id, variant: "INTERNATIONAL", timeControl: "BLITZ", oldRating: 1320, newRating: 1290, change: -30, reason: "GAME_LOSS" },
    ],
  });

  // Tournois : un à points (finaliste), un rémunéré (vainqueur, prix 4321).
  const tournament = async (name: string, isPaid: boolean, placement: number) => {
    const t = await prisma.tournament.create({
      data: {
        name: `${tag} ${name}`, creatorId: opp.id, scope: "CITY", maxPlayers: 8, type: "ELIMINATION", isPaid,
        status: "COMPLETED", finishedAt: day(15), entryFee: isPaid ? 1000 : 0,
      },
    });
    tournamentIds.push(t.id);
    await prisma.tournamentParticipant.createMany({
      data: [opp, others[0]!, others[1]!].map((u, i) => ({
        tournamentId: t.id, userId: u.id, seed: i + 1, placement: u.id === opp.id ? placement : i + 2,
      })),
    });
    return t;
  };
  await tournament("Coupe points", false, 2);
  const paid = await tournament("Open rémunéré", true, 1);
  await prisma.balanceTransaction.create({
    data: {
      userId: opp.id, balanceType: "REAL_WALLET", transactionType: "TOURNAMENT_PRIZE", amount: 4321,
      referenceId: `${paid.id}:1`, description: "Prix test",
    },
  });

  const viewer = (u: typeof free) => ({ id: u.id, isAdmin: false, isPremium: u.isPremium, premiumLevel: u.premiumLevel, premiumExpiresAt: null });

  console.log("Accès");
  try {
    await getOpponentProfile(liveFree.id, viewer(stranger));
    check("un joueur extérieur à la partie est refusé", false);
  } catch (error) {
    check("un joueur extérieur à la partie est refusé (404)", error instanceof OpponentProfileError && error.status === 404);
  }

  console.log("Non-Premium");
  check("le lecteur non-Premium n'a pas le privilège", !(await getPrivileges(viewer(free))).privileges.advancedStats);
  const a = await getOpponentProfile(liveFree.id, viewer(free));
  const rawA = JSON.stringify(a);
  check("informations obligatoires : pseudo, avatar", a.username === opp.username && a.avatar === "/media/avatars/opp.webp");
  check("pays et ville", !("hidden" in a.location) && a.location.country === "Cameroun" && a.location.city === "Douala");
  check("points (classiques)", !("hidden" in a.level) && a.level.points === 348, a.level);
  check("ELO de la catégorie de la partie (dames internationales blitz)",
    !("hidden" in a.level) && a.level.context.rating === 1290 && a.level.context.label.includes("Blitz"), a.level);
  check("ELO échecs distinct", !("hidden" in a.level) && a.level.chess?.rating === 1150);
  check("section avancée verrouillée", a.advanced.locked === "PREMIUM");
  check("aucune donnée avancée envoyée au non-Premium", !rawA.includes(others[0]!.username) && !rawA.includes("Coupe points"));

  console.log("Premium");
  check("le lecteur Premium a le privilège", (await getPrivileges(viewer(premium))).privileges.advancedStats);
  const b = await getOpponentProfile(livePremium.id, viewer(premium));
  const adv = b.advanced;
  if (adv.locked !== null) throw new Error("section avancée inattendue");
  const g = "hidden" in adv.general ? null : adv.general;
  check("bilan global : 7 parties (annulée exclue), 5 V / 1 D / 1 N", g?.overall.played === 7 && g.overall.wins === 5 && g.overall.losses === 1 && g.overall.draws === 1, g?.overall);
  check("pourcentage de victoires", g?.overall.winRate === 71.4, g?.overall.winRate);
  check("série en cours : 2 victoires", g?.overall.current?.kind === "WIN" && g.overall.current.length === 2, g?.overall.current);
  check("plus longue série de victoires : 3", g?.overall.longestWin === 3);
  check("dames et échecs distingués", g?.CHECKERS.played === 6 && g.CHESS.played === 1);
  const pool = g?.pools.find((p) => p.label.includes("Blitz"));
  check("ELO actuel 1290 et meilleur atteint 1320", pool?.current === 1290 && pool.best === 1320, pool);

  const recent = "hidden" in adv.recentOpponents ? [] : adv.recentOpponents;
  check("5 derniers adversaires, du plus récent au plus ancien",
    recent.length === 5 && recent.map((r) => r.opponent?.username).join() === [0, 1, 2, 3, 4].map((i) => others[i]!.username).join(),
    recent.map((r) => r.opponent?.username));
  check("points exacts (règlements enregistrés) : +9, +15, 0, -8, +12",
    recent.map((r) => r.pointsChange).join() === "9,15,0,-8,12", recent.map((r) => r.pointsChange));
  check("résultats : V, V, N, D, V", recent.map((r) => r.result).join() === "WIN,WIN,DRAW,LOSS,WIN");
  check("discipline indiquée", recent[1]?.gameType === "CHESS" && recent[0]?.gameType === "CHECKERS");

  const pts = "hidden" in adv.tournaments ? null : adv.tournaments;
  const money = "hidden" in adv.paidCompetitions ? null : adv.paidCompetitions;
  check("tournoi à points : 1 participation, finaliste", pts?.participated === 1 && pts.second === 1 && pts.recent[0]?.result === "Finaliste", pts);
  check("compétition rémunérée : 1 participation, remportée, récompensée, 1 finale",
    money?.participated === 1 && money.wins === 1 && money.rewarded === 1 && money.finals === 1, money);
  check("pas de mélange tournoi à points / compétition rémunérée",
    !pts?.recent.some((r) => r.name.includes("rémunéré")) && !money?.recent.some((r) => r.name.includes("Coupe points")));
  check("aucun montant de prix exposé", !JSON.stringify(b).includes("4321"));
  check("aucun solde financier exposé", !/wallet|walletReal|walletLocked/i.test(JSON.stringify(b)));

  console.log("Confidentialité (le Premium ne la contourne pas)");
  await prisma.user.update({
    where: { id: opp.id },
    data: { privacySettings: { showAdvancedStats: false, showRecentOpponents: false, showTournaments: false, showLocation: false, showRatings: false } },
  });
  const c = await getOpponentProfile(livePremium.id, viewer(premium));
  const rawC = JSON.stringify(c);
  if (c.advanced.locked !== null) throw new Error("section avancée inattendue");
  check("statistiques avancées masquées", "hidden" in c.advanced.general);
  check("derniers adversaires masqués", "hidden" in c.advanced.recentOpponents);
  check("tournois et compétitions masqués", "hidden" in c.advanced.tournaments && "hidden" in c.advanced.paidCompetitions);
  check("localisation, points et ELO masqués", "hidden" in c.location && "hidden" in c.level);
  check("les données refusées ne sont pas envoyées", !rawC.includes("Douala") && !rawC.includes(others[0]!.username) && !rawC.includes("1290") && !rawC.includes("Coupe"));

  await prisma.user.update({ where: { id: opp.id }, data: { privacySettings: { showStats: false } } });
  const d = await getOpponentProfile(livePremium.id, viewer(premium));
  if (d.advanced.locked !== null) throw new Error("section avancée inattendue");
  check("« statistiques » masquées sur le profil public ⇒ aussi masquées ici",
    "hidden" in d.advanced.general && "hidden" in d.advanced.recentOpponents && !("hidden" in d.advanced.tournaments));

  await prisma.userBlock.create({ data: { blockerId: opp.id, blockedId: premium.id } });
  await prisma.user.update({ where: { id: opp.id }, data: { privacySettings: {} } });
  const e = await getOpponentProfile(livePremium.id, viewer(premium));
  if (e.advanced.locked !== null) throw new Error("section avancée inattendue");
  check("joueur bloqué par l'adversaire : rien au-delà du pseudo",
    "hidden" in e.level && "hidden" in e.location && "hidden" in e.advanced.general && "hidden" in e.advanced.tournaments);

  console.log("La partie n'est pas modifiée");
  const after = await prisma.match.findUniqueOrThrow({ where: { id: livePremium.id }, select: { status: true, movesHistory: true } });
  check("partie toujours en cours, aucun coup ajouté", after.status === "IN_PROGRESS" && Array.isArray(after.movesHistory) && after.movesHistory.length === 0);
}

main()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(async () => {
    await prisma.userBlock.deleteMany({ where: { OR: [{ blockerId: { in: userIds } }, { blockedId: { in: userIds } }] } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
    await prisma.match.deleteMany({ where: { OR: [{ playerWhiteId: { in: userIds } }, { playerBlackId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    console.log(failures === 0 ? "\nTous les contrôles passent." : `\n${failures} contrôle(s) en échec.`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
