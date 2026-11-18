/**
 * Test d'intégration : « un des deux joueurs a déjà une partie en cours ».
 * Qui est occupé, demande de sortie, acceptation (abandon des parties), refus,
 * expiration, annulation, limites anti-abus, blocages.
 * Le serveur de jeu est simulé (crochet globalThis) : seul le chemin métier est testé ici.
 * Données créées puis supprimées. Lancement : npm run test:game-exit
 */
import { MatchStatus } from "@/generated/prisma-client";
import { assertPlayersFree, findBusyPlayers, PlayerBusyError } from "@/lib/game-exit/busy";
import {
  cancelExitRequest,
  createExitRequest,
  forfeitActiveGames,
  GameExitError,
  getSentRequest,
  listActiveGames,
  listReceivedRequests,
  respondExitRequest,
  safeReturnPath,
} from "@/lib/game-exit/service";
import { prisma } from "@/lib/prisma";

const tag = `gx${Date.now().toString(36)}`;
const userIds: string[] = [];
let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail ?? "");
  }
}

async function rejects(label: string, run: () => Promise<unknown>, status: number) {
  try {
    await run();
    check(label, false, "aucune erreur");
  } catch (error) {
    check(label, error instanceof GameExitError && error.status === status, error);
  }
}

async function user(name: string) {
  const u = await prisma.user.create({ data: { username: `${tag}${name}`.slice(0, 24), pointsFree: 100 } });
  userIds.push(u.id);
  return u;
}

async function game(white: string, black: string, moves = 0) {
  return prisma.match.create({
    data: {
      playerWhiteId: white,
      playerBlackId: black,
      gameType: "CHECKERS",
      mode: "CASUAL",
      status: MatchStatus.IN_PROGRESS,
      movesHistory: Array.from({ length: moves }, (_, i) => ({ ply: i })),
    },
  });
}

// Serveur de jeu simulé : abandonne en base les parties du joueur.
const forfeited: string[] = [];
(globalThis as { __thotForfeitPlayerGames?: unknown }).__thotForfeitPlayerGames = async (userId: string) => {
  forfeited.push(userId);
  const where = { status: MatchStatus.IN_PROGRESS, OR: [{ playerWhiteId: userId }, { playerBlackId: userId }] };
  const { count } = await prisma.match.updateMany({ where, data: { status: MatchStatus.ABANDONED } });
  return { ended: count, remaining: await prisma.match.count({ where }) };
};

async function main() {
  const [alice, bob, carol, dave, eve] = await Promise.all(["alice", "bob", "carol", "dave", "eve"].map(user));

  console.log("Qui est occupé ?");
  check("personne d'occupé : aucune erreur", await assertPlayersFree(prisma, [alice.id, bob.id], alice.id).then(() => true));
  const bobGame = await game(bob.id, carol.id, 6);
  const busy = await findBusyPlayers(prisma, [alice.id, bob.id], alice.id);
  check("seul l'adversaire est désigné", busy.length === 1 && busy[0]!.id === bob.id && !busy[0]!.self, busy);
  try {
    await assertPlayersFree(prisma, [alice.id, bob.id], alice.id);
    check("PlayerBusyError levée", false);
  } catch (error) {
    const ok = error instanceof PlayerBusyError && error.status === 409 && error.toJSON().code === "PLAYER_BUSY";
    check("PlayerBusyError 409 / PLAYER_BUSY avec le nom de l'adversaire", ok && /bob/.test((error as Error).message), error);
  }
  const busySelf = await findBusyPlayers(prisma, [bob.id, alice.id], bob.id);
  check("le demandeur occupé est marqué « self » et listé en premier", busySelf[0]?.self === true, busySelf);

  console.log("Liens de retour");
  check("lien interne accepté", safeReturnPath("/tournois/abc?x=1") === "/tournois/abc?x=1");
  check("lien externe refusé", safeReturnPath("https://evil.example") === null && safeReturnPath("//evil.example") === null);
  check("salle de jeu refusée comme retour", safeReturnPath("/match/xyz") === null);

  console.log("Demande de sortie");
  await rejects("se demander à soi-même : refusé", () => createExitRequest(alice.id, alice.id, "/"), 400);
  await rejects("joueur sans partie : 409", () => createExitRequest(alice.id, dave.id, "/"), 409);
  const req = await createExitRequest(alice.id, bob.id, "/communaute");
  check("demande créée", req.status === "PENDING" && !req.alreadySent);
  const again = await createExitRequest(alice.id, bob.id, "/communaute");
  check("demande en double : la même est renvoyée, sans nouvelle notification", again.id === req.id && again.alreadySent);
  const notes = await prisma.notification.count({ where: { userId: bob.id, type: "GAME_EXIT_REQUEST" } });
  check("une seule notification pour Bob", notes === 1, notes);
  const received = await listReceivedRequests(bob.id);
  check("Bob voit la demande d'Alice", received.length === 1 && received[0]!.requester === alice.username);
  const games = await listActiveGames(bob.id);
  check("Bob voit sa partie et la conséquence (défaite après 6 coups)", games.length === 1 && games[0]!.consequence === "loss" && games[0]!.opponent === carol.username, games);
  await rejects("Alice ne peut pas répondre à sa propre demande", () => respondExitRequest(alice.id, req.id, true), 404);

  console.log("Refus");
  const declined = await respondExitRequest(bob.id, req.id, false);
  check("refus enregistré, aucune partie arrêtée", declined.status === "DECLINED" && forfeited.length === 0);
  check("la partie de Bob continue", (await prisma.match.findUnique({ where: { id: bobGame.id } }))?.status === MatchStatus.IN_PROGRESS);
  check("Alice voit le refus", (await getSentRequest(alice.id, req.id)).status === "DECLINED");
  await rejects("réponse en double refusée", () => respondExitRequest(bob.id, req.id, true), 409);

  console.log("Acceptation");
  const req2 = await createExitRequest(alice.id, bob.id, "/tournois/t1");
  const accepted = await respondExitRequest(bob.id, req2.id, true);
  check("acceptation : toutes les parties de Bob arrêtées", accepted.status === "ACCEPTED" && accepted.ended === 1 && forfeited.includes(bob.id));
  check("Bob est libre", (await findBusyPlayers(prisma, [bob.id], alice.id)).length === 0);
  const answer = await prisma.notification.findFirst({ where: { userId: alice.id, type: "GAME_EXIT_ANSWER" }, orderBy: { createdAt: "desc" } });
  check("Alice est prévenue avec le lien pour relancer", answer?.link === "/tournois/t1", answer);
  const sent = await getSentRequest(alice.id, req2.id);
  check("suivi côté Alice : acceptée", sent.status === "ACCEPTED");
  await rejects("un tiers ne peut pas suivre la demande", () => getSentRequest(carol.id, req2.id), 404);

  console.log("Sortie à son initiative");
  await game(dave.id, eve.id, 0);
  const daveGames = await listActiveGames(dave.id);
  check("partie à peine commencée : sans conséquence", daveGames[0]?.consequence === "none", daveGames);
  check("quitter sa partie", (await forfeitActiveGames(dave.id)).ended === 1);

  console.log("Annulation, expiration, blocage, limite");
  await game(carol.id, eve.id, 4);
  const req3 = await createExitRequest(dave.id, carol.id, "/");
  await cancelExitRequest(dave.id, req3.id);
  await rejects("demande annulée : plus de réponse possible", () => respondExitRequest(carol.id, req3.id, true), 409);
  const req4 = await createExitRequest(dave.id, carol.id, "/");
  await prisma.gameExitRequest.update({ where: { id: req4.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  check("demande expirée vue comme telle", (await getSentRequest(dave.id, req4.id)).status === "EXPIRED");
  await rejects("demande expirée : acceptation refusée", () => respondExitRequest(carol.id, req4.id, true), 409);
  check("la partie de Carol n'a pas été touchée", !forfeited.includes(carol.id));
  await prisma.userBlock.create({ data: { blockerId: carol.id, blockedId: alice.id } });
  await rejects("joueur bloqué : refusé", () => createExitRequest(alice.id, carol.id, "/"), 403);
  // Limite horaire (5 par défaut) : Dave en a déjà envoyé 2.
  for (let i = 0; i < 3; i += 1) {
    const r = await createExitRequest(dave.id, carol.id, "/");
    await cancelExitRequest(dave.id, r.id);
  }
  await rejects("limite horaire atteinte : 429", () => createExitRequest(dave.id, carol.id, "/"), 429);

  console.log("Serveur de jeu absent");
  delete (globalThis as { __thotForfeitPlayerGames?: unknown }).__thotForfeitPlayerGames;
  await rejects("sans serveur de jeu : 503, rien n'est modifié", () => forfeitActiveGames(carol.id), 503);
}

main()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(async () => {
    await prisma.match.deleteMany({ where: { OR: [{ playerWhiteId: { in: userIds } }, { playerBlackId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    console.log(failures === 0 ? "\nTous les contrôles passent." : `\n${failures} contrôle(s) en échec.`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
