/**
 * Test de bout en bout avec le VRAI serveur de jeu (Socket.IO attaché à un
 * serveur HTTP non exposé) : une demande de sortie acceptée abandonne les parties
 * par le même chemin que le bouton « Abandonner » (annulation sans conséquence
 * avant le seuil de coups, sinon défaite réglée par settleMatch).
 * Données créées puis supprimées. Lancement : npm run test:game-exit (après le test métier)
 */
import { createServer } from "node:http";
import { MatchStatus } from "@/generated/prisma-client";
import { createExitRequest, respondExitRequest } from "@/lib/game-exit/service";
import { prisma } from "@/lib/prisma";
import { attachSocketServer } from "@/server/socket-server";

const tag = `gs${Date.now().toString(36)}`;
const userIds: string[] = [];
let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail ?? "");
  }
}

async function user(name: string) {
  const u = await prisma.user.create({ data: { username: `${tag}${name}`.slice(0, 24), pointsFree: 100 } });
  userIds.push(u.id);
  return u;
}

const CHESS_OPENING = [
  { kind: "CHESS", from: "e2", to: "e4" },
  { kind: "CHESS", from: "e7", to: "e5" },
  { kind: "CHESS", from: "g1", to: "f3" },
];

async function main() {
  const io = attachSocketServer(createServer());
  const [alice, bob, carol, dave] = await Promise.all(["alice", "bob", "carol", "dave"].map(user));

  // Bob a deux parties en cours : l'une jouée (défaite), l'autre à peine commencée (annulée).
  const played = await prisma.match.create({
    data: { playerWhiteId: bob.id, playerBlackId: carol.id, gameType: "CHESS", mode: "CASUAL", status: MatchStatus.IN_PROGRESS, movesHistory: CHESS_OPENING },
  });
  const fresh = await prisma.match.create({
    data: { playerWhiteId: dave.id, playerBlackId: bob.id, gameType: "CHESS", mode: "CASUAL", status: MatchStatus.IN_PROGRESS, movesHistory: [] },
  });

  const request = await createExitRequest(alice.id, bob.id, "/communaute");
  const result = await respondExitRequest(bob.id, request.id, true);
  check("acceptée : deux parties arrêtées", result.status === "ACCEPTED" && result.ended === 2, result);

  const [p, f] = await Promise.all([
    prisma.match.findUnique({ where: { id: played.id }, select: { status: true, winnerId: true } }),
    prisma.match.findUnique({ where: { id: fresh.id }, select: { status: true, winnerId: true } }),
  ]);
  check("partie jouée : abandon, victoire de l'adversaire", p?.status === MatchStatus.ABANDONED && p.winnerId === carol.id, p);
  check("partie à peine commencée : annulée sans vainqueur", f?.status === MatchStatus.ABORTED && f.winnerId === null, f);
  const stillBusy = await prisma.match.count({
    where: { status: MatchStatus.IN_PROGRESS, OR: [{ playerWhiteId: bob.id }, { playerBlackId: bob.id }] },
  });
  check("Bob n'a plus aucune partie en cours", stillBusy === 0);

  io.close();
}

main()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(async () => {
    try {
      const matchIds = (
        await prisma.match.findMany({
          where: { OR: [{ playerWhiteId: { in: userIds } }, { playerBlackId: { in: userIds } }] },
          select: { id: true },
        })
      ).map((m) => m.id);
      await prisma.balanceTransaction.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } catch (error) {
      console.error("Nettoyage incomplet :", error);
    }
    console.log(failures === 0 ? "\nTous les contrôles passent." : `\n${failures} contrôle(s) en échec.`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
