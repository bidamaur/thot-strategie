/**
 * Test d'intégration des formats de tournoi sur la base locale (données
 * créées puis supprimées). Lancement : npm run test:tournaments
 */
import { MatchStatus, TournamentType } from "@/generated/prisma-client";
import {
  closeExpiredSurvivals,
  voteSurvivalStop,
  createTournament,
  getTournamentStandings,
  recordValidatedTournamentResult,
  registerTournamentPlayer,
  reportTournamentGame,
  startTournamentGame,
} from "@/lib/economy/tournaments";
import { prisma } from "@/lib/prisma";
import { abortMatch, settleMatch } from "@/lib/scoring/settle-match";

const tag = `tf${Date.now().toString(36)}`;
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

async function players(n: number, prefix: string) {
  const list = [];
  for (let i = 0; i < n; i += 1) {
    const u = await prisma.user.create({
      data: { username: `${tag}${prefix}${i}`.slice(0, 24), pointsFree: 100, elo: 1500 - i * 50 },
    });
    userIds.push(u.id);
    list.push(u);
  }
  return list;
}

async function makeTournament(
  type: TournamentType,
  size: number,
  prefix: string,
  extra: Partial<Parameters<typeof createTournament>[0]> = {},
) {
  const people = await players(size, prefix);
  if (extra.isPaid) {
    await prisma.user.updateMany({ where: { id: { in: people.map((x) => x.id) } }, data: { walletReal: 1000 } });
  }
  const tournament = await createTournament({
    creatorId: people[0]!.id,
    name: `${tag} ${type}`,
    type,
    scope: "CITY",
    gameType: "CHECKERS",
    draughtsVariant: "INTERNATIONAL",
    isPaid: false,
    entryFeeCfa: 0,
    entryPoints: 10,
    maxPlayers: size,
    betMode: "FIXED",
    rebuyEnabled: false,
    ...extra,
  });
  tournamentIds.push(tournament.id);
  for (const p of people.slice(1)) await registerTournamentPlayer(tournament.id, p.id);
  return { tournament, people };
}

/** Joue toutes les parties en attente : le mieux classé (seed) gagne, sauf une nulle. */
async function playOutRound(tournamentId: string, allowDraw: boolean) {
  const pending = await prisma.tournamentMatch.findMany({
    where: { tournamentId, status: { not: "FINISHED" } },
    orderBy: [{ round: "asc" }, { matchNumber: "asc" }],
    include: { playerWhite: { select: { elo: true } }, playerBlack: { select: { elo: true } } },
  });
  const minRound = Math.min(...pending.map((m) => m.round));
  let drew = false;
  for (const m of pending.filter((x) => x.round === minRound)) {
    if (allowDraw && !drew) {
      drew = true;
      await recordValidatedTournamentResult(m.id, null);
      continue;
    }
    const whiteStronger = (m.playerWhite?.elo ?? 0) >= (m.playerBlack?.elo ?? 0);
    await recordValidatedTournamentResult(m.id, whiteStronger ? m.playerWhiteId! : m.playerBlackId!);
  }
}

async function main() {
  console.log("1. Système suisse à 5 joueurs (nombre impair → exempts)");
  {
    const { tournament, people } = await makeTournament(TournamentType.SWISS, 5, "s");
    let started = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
    check("le tournoi démarre au 5e inscrit", started.status === "IN_PROGRESS");
    const round1 = await prisma.tournamentMatch.findMany({ where: { tournamentId: tournament.id, round: 1 } });
    check("ronde 1 : 2 parties + 1 exempt", round1.length === 3 && round1.filter((m) => !m.playerBlackId).length === 1);

    for (let guard = 0; guard < 10; guard += 1) {
      started = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
      if (started.status === "COMPLETED") break;
      await playOutRound(tournament.id, guard === 0);
    }
    const finished = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
    check("le tournoi se termine automatiquement", finished.status === "COMPLETED");
    const rounds = await prisma.tournamentMatch.groupBy({ by: ["round"], where: { tournamentId: tournament.id } });
    check("3 rondes jouées (automatique)", rounds.length === 3, rounds.length);

    const all = await prisma.tournamentMatch.findMany({ where: { tournamentId: tournament.id, playerBlackId: { not: null } } });
    const keys = all.map((m) => [m.playerWhiteId, m.playerBlackId].sort().join("-"));
    check("aucun rematch", new Set(keys).size === keys.length);
    const byes = await prisma.tournamentMatch.findMany({ where: { tournamentId: tournament.id, playerBlackId: null } });
    check("exempts distincts", new Set(byes.map((b) => b.playerWhiteId)).size === byes.length);

    const standings = await getTournamentStandings(prisma, tournament.id);
    const participants = await prisma.tournamentParticipant.findMany({ where: { tournamentId: tournament.id } });
    check("places attribuées à tous", participants.every((p) => p.placement !== null));
    check("le vainqueur est 1er du classement", finished.winnerId === standings[0]!.userId);
    const totalScore = standings.reduce((sum, r) => sum + r.score, 0);
    check("somme des points = parties + exempts (6 + 3)", totalScore === 9, totalScore);
    const winnerPoints = await prisma.user.findUniqueOrThrow({ where: { id: standings[0]!.userId } });
    check("prix en points versé au 1er (50 % de 50)", winnerPoints.pointsFree === 100 - 10 + 25, winnerPoints.pointsFree);
    void people;
  }

  console.log("2. Toutes rondes à 4 joueurs");
  {
    const { tournament } = await makeTournament(TournamentType.ROUND_ROBIN, 4, "r");
    const all = await prisma.tournamentMatch.findMany({ where: { tournamentId: tournament.id } });
    check("calendrier complet : 6 parties sur 3 rondes", all.length === 6 && new Set(all.map((m) => m.round)).size === 3);
    for (let guard = 0; guard < 5; guard += 1) await playOutRound(tournament.id, false).catch(() => undefined);
    const done = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
    check("clôturé après la dernière partie", done.status === "COMPLETED");
  }

  console.log("3. Partie de tournoi jouée en ligne, résultat reporté par le serveur");
  {
    const { tournament } = await makeTournament(TournamentType.SWISS, 4, "o");
    const tm = await prisma.tournamentMatch.findFirstOrThrow({ where: { tournamentId: tournament.id, round: 1 } });
    const outsider = await players(1, "x");
    let refused = false;
    try {
      await startTournamentGame(tm.id, outsider[0]!.id);
    } catch {
      refused = true;
    }
    check("un non-joueur ne peut pas lancer la partie", refused);

    const [a, b] = await Promise.all([startTournamentGame(tm.id, tm.playerWhiteId!), startTournamentGame(tm.id, tm.playerBlackId!)]);
    check("les deux joueurs rejoignent la même partie", a.matchId === b.matchId);

    // Annulation avant le début : le match redevient jouable.
    await abortMatch(a.matchId);
    const afterAbort = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: tm.id } });
    check("annulation : match de tournoi de nouveau en attente", afterAbort.status === "WAITING");

    const game = await startTournamentGame(tm.id, tm.playerWhiteId!);
    check("une nouvelle partie peut être lancée", game.matchId !== a.matchId);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: tm.playerWhiteId! } });
    await settleMatch({ matchId: game.matchId, winnerId: tm.playerBlackId!, whiteRemainingPieces: 2, blackRemainingPieces: 9 });
    await reportTournamentGame(game.matchId);
    await reportTournamentGame(game.matchId); // idempotent
    const reported = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: tm.id } });
    check("résultat reporté dans le tournoi", reported.status === "FINISHED" && reported.winnerId === tm.playerBlackId);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: tm.playerWhiteId! } });
    check("aucun point classique perdu (économie du tournoi)", after.pointsFree === before.pointsFree);
    const pool = await prisma.playerRating.count({ where: { userId: tm.playerBlackId! } });
    check("la partie compte pour l'ELO", pool === 1);
    const storedGame = await prisma.match.findUniqueOrThrow({ where: { id: game.matchId } });
    check("partie terminée", storedGame.status === MatchStatus.FINISHED);
  }
}

async function survivalScenarios() {
  console.log("4. Survival en points : mise d’inscription 50, on joue jusqu’à épuisement du capital");
  {
    const { tournament, people } = await makeTournament(TournamentType.SURVIVAL_BANK, 4, "v", {
      entryPoints: 50,
      minBet: 25,
      maxBet: 25,
      durationDays: 3,
    });
    const afterEntry = await prisma.user.findMany({ where: { id: { in: people.map((x) => x.id) } } });
    check("chaque inscrit est débité de 50 points", afterEntry.every((u) => u.pointsFree === 50));
    const started = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
    check("démarrage quand les 4 places sont prises", started.status === "IN_PROGRESS");
    check("date de fin = démarrage + 3 jours", Math.round((started.endsAt!.getTime() - started.startedAt!.getTime()) / 86_400_000) === 3);

    await playOutRound(tournament.id, false);
    const wallets1 = await prisma.tournamentWallet.findMany({ where: { tournamentId: tournament.id } });
    check("après la ronde 1 : deux joueurs à 75, deux à 25, tous encore en jeu",
      wallets1.filter((w) => w.capital === 75).length === 2 && wallets1.filter((w) => w.capital === 25).length === 2 &&
      wallets1.every((w) => w.status === "ACTIVE"));
    const round2 = await prisma.tournamentMatch.count({ where: { tournamentId: tournament.id, round: 2 } });
    check("une 2e ronde est créée (pas d’élimination sur une simple défaite)", round2 === 2);

    for (let guard = 0; guard < 20; guard += 1) {
      const t = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
      if (t.status === "COMPLETED") break;
      await playOutRound(tournament.id, false);
    }
    const done = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
    check("le tournoi s’arrête quand il reste un seul joueur", done.status === "COMPLETED");
    const final = await prisma.user.findMany({ where: { id: { in: people.map((x) => x.id) } } });
    const total = final.reduce((sum, u) => sum + u.pointsFree, 0);
    check("aucun point créé ni perdu (4 × 100 au total)", total === 400, total);
    const winner = final.find((u) => u.id === done.winnerId)!;
    check("le survivant récupère tout le capital (100 + 150)", winner.pointsFree === 250, winner.pointsFree);
    const ledger = await prisma.balanceTransaction.count({ where: { referenceId: `survival:${tournament.id}` } });
    check("restitution inscrite dans l’historique des soldes", ledger >= 1);
  }

  console.log("5. Survival : arrêt anticipé seulement avec l’accord de tous");
  {
    const { tournament, people } = await makeTournament(TournamentType.SURVIVAL_BANK, 4, "w", {
      entryPoints: 50,
      minBet: 10,
      maxBet: 10,
    });
    await playOutRound(tournament.id, false);
    let result = { stopped: false, votes: 0, required: 0 };
    for (const p of people.slice(0, 3)) result = await voteSurvivalStop(tournament.id, p.id, true);
    check("3 accords sur 4 : le tournoi continue", !result.stopped && result.votes === 3 && result.required === 4);
    await voteSurvivalStop(tournament.id, people[1]!.id, false);
    await voteSurvivalStop(tournament.id, people[1]!.id, true);
    result = await voteSurvivalStop(tournament.id, people[3]!.id, true);
    check("unanimité : arrêt immédiat", result.stopped);
    const final = await prisma.user.findMany({ where: { id: { in: people.map((x) => x.id) } } });
    check("chacun garde ce qu’il a gagné (60 ou 40 rendus)",
      final.filter((u) => u.pointsFree === 110).length === 2 && final.filter((u) => u.pointsFree === 90).length === 2,
      final.map((u) => u.pointsFree));
  }

  console.log("6. Survival : arrêt automatique à la fin de la durée");
  {
    const { tournament } = await makeTournament(TournamentType.SURVIVAL_BANK, 4, "e", { entryPoints: 20, minBet: 5, maxBet: 5, durationDays: 1 });
    await prisma.tournament.update({ where: { id: tournament.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    await closeExpiredSurvivals();
    const t = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
    check("tournoi clôturé à échéance", t.status === "COMPLETED");
  }

  console.log("7. Survival en points argent : inscription 500 FCFA, commission sur le gain net uniquement");
  {
    const { tournament, people } = await makeTournament(TournamentType.SURVIVAL_BANK, 4, "m", {
      isPaid: true,
      entryFeeCfa: 500,
      entryPoints: 0,
      minBet: 100,
      maxBet: 100,
    });
    const debited = await prisma.user.findMany({ where: { id: { in: people.map((x) => x.id) } } });
    check("500 FCFA débités, points classiques intacts", debited.every((u) => u.walletReal.toNumber() === 500 && u.pointsFree === 100));
    await playOutRound(tournament.id, false);
    for (const p of people) await voteSurvivalStop(tournament.id, p.id, true);
    const final = await prisma.user.findMany({ where: { id: { in: people.map((x) => x.id) } } });
    const winners = final.filter((u) => u.walletReal.toNumber() === 1090);
    const losers = final.filter((u) => u.walletReal.toNumber() === 900);
    check("gagnants : 500 + 600 − 10 % de 100 = 1090 ; perdants : 900", winners.length === 2 && losers.length === 2,
      final.map((u) => u.walletReal.toString()));
  }
}

main()
  .then(() => survivalScenarios())
  .catch((error) => {
    failures += 1;
    console.error("Erreur inattendue :", error);
  })
  .finally(async () => {
    const matchIds = (
      await prisma.match.findMany({
        where: { OR: [{ playerWhiteId: { in: userIds } }, { playerBlackId: { in: userIds } }] },
        select: { id: true },
      })
    ).map((m) => m.id);
    await prisma.ratingHistory.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.matchResult.deleteMany({ where: { matchId: { in: matchIds } } });
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    await prisma.playerRating.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nTous les contrôles des formats sont passés." : `\n${failures} contrôle(s) en échec.`);
    process.exit(failures === 0 ? 0 : 1);
  });
