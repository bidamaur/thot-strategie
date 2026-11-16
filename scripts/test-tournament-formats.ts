/**
 * Test d'intégration des formats de tournoi sur la base locale (données
 * créées puis supprimées). Lancement : npm run test:tournaments
 */
import { MatchStatus, TournamentType } from "@/generated/prisma-client";
import {
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

async function makeTournament(type: TournamentType, size: number, prefix: string) {
  const people = await players(size, prefix);
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

main()
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
