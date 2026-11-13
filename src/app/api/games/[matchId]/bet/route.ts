import { BetStatus, Prisma } from "@/generated/prisma-client";
import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const MAX_BET_AMOUNT = 1000;
const MIN_BET_AMOUNT = 1;

export async function POST(
  request: Request,
  { params }: { params: { matchId: string } },
): Promise<NextResponse> {
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Le corps de la requête doit être un JSON valide." },
      { status: 400 },
    );
  }

  const { action, amount } = body as {
    action?: string;
    amount?: unknown;
  };

  if (!action || typeof action !== "string") {
    return NextResponse.json(
      { error: "L'action est requise (propose, accept, reject, counter)." },
      { status: 400 },
    );
  }

  try {
    const match = await prisma.match.findUnique({
      where: { id: params.matchId },
      include: {
        playerWhite: { select: { id: true, pointsFree: true } },
        playerBlack: { select: { id: true, pointsFree: true } },
        gameBet: true,
      },
    });

    if (!match) {
      return NextResponse.json(
        { error: "Partie introuvable." },
        { status: 404 },
      );
    }

    if (!match.playerWhite || !match.playerBlack) {
      return NextResponse.json(
        { error: "La partie n'a pas deux joueurs." },
        { status: 400 },
      );
    }

    const isPlayerWhite = currentUser.id === match.playerWhiteId;
    const isPlayerBlack = currentUser.id === match.playerBlackId;
    if (!isPlayerWhite && !isPlayerBlack) {
      return NextResponse.json(
        { error: "Vous ne participez pas à cette partie." },
        { status: 403 },
      );
    }

    if (match.status !== "WAITING" && match.status !== "IN_PROGRESS") {
      return NextResponse.json(
        { error: "La partie ne peut plus recevoir de mise." },
        { status: 400 },
      );
    }

      const opponentId = isPlayerWhite ? match.playerBlackId! : match.playerWhiteId;
    const opponent = isPlayerWhite ? match.playerBlack : match.playerWhite;

    // --- PROPOSE ---
    if (action === "propose") {
      if (
        typeof amount !== "number" ||
        !Number.isInteger(amount) ||
        amount < MIN_BET_AMOUNT ||
        amount > MAX_BET_AMOUNT
      ) {
        return NextResponse.json(
          { error: `Le montant de la mise doit être entre ${MIN_BET_AMOUNT} et ${MAX_BET_AMOUNT} points.` },
          { status: 400 },
        );
      }

      const proposerBalance = isPlayerWhite ? match.playerWhite.pointsFree : match.playerBlack.pointsFree;
      if (proposerBalance < amount) {
        return NextResponse.json(
          { error: "Solde insuffisant pour proposer cette mise." },
          { status: 400 },
        );
      }

      // Annuler toute mise précédente sur cette partie
      if (match.gameBet) {
        await prisma.gameBet.update({
          where: { id: match.gameBet.id },
          data: { status: "EXPIRED" },
        });
      }

      const bet = await prisma.gameBet.create({
        data: {
          matchId: params.matchId,
          proposerId: currentUser.id,
          opponentId,
          amount,
          status: "PROPOSED",
        },
        include: {
          proposer: { select: { id: true, username: true } },
          opponent: { select: { id: true, username: true } },
        },
      });

      return NextResponse.json({ bet });
    }

    // --- ACCEPT / REJECT / COUNTER ---
    const bet = match.gameBet;
    if (!bet) {
      return NextResponse.json(
        { error: "Aucune mise en attente sur cette partie." },
        { status: 404 },
      );
    }

    if (bet.status !== "PROPOSED") {
      return NextResponse.json(
        { error: "Cette mise n'est plus en attente." },
        { status: 400 },
      );
    }

    if (currentUser.id !== bet.opponentId && action !== "counter") {
      return NextResponse.json(
        { error: "Seul l'adversaire peut accepter ou refuser cette mise." },
        { status: 403 },
      );
    }

    if (action === "accept") {
      const opponentBalance = isPlayerWhite ? match.playerBlack.pointsFree : match.playerWhite.pointsFree;
      if (opponentBalance < bet.amount) {
        return NextResponse.json(
          { error: "Solde insuffisant de l'adversaire pour accepter la mise." },
          { status: 400 },
        );
      }

      const updatedBet = await prisma.gameBet.update({
        where: { id: bet.id },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
        },
      });

      // Bloquer les points (escrow) - débit temporaire des deux joueurs
      await prisma.user.update({
        where: { id: bet.proposerId },
        data: { pointsFree: { decrement: bet.amount } },
      });
      await prisma.user.update({
        where: { id: bet.opponentId },
        data: { pointsFree: { decrement: bet.amount } },
      });

      await prisma.balanceTransaction.create({
        data: {
          userId: bet.proposerId,
          balanceType: "FREE_POINTS",
          transactionType: "BET_PLACED",
          amount: new Prisma.Decimal(bet.amount),
          referenceId: bet.id,
          description: `Mise placée sur la partie ${params.matchId}`,
        },
      });
      await prisma.balanceTransaction.create({
        data: {
          userId: bet.opponentId,
          balanceType: "FREE_POINTS",
          transactionType: "BET_PLACED",
          amount: new Prisma.Decimal(bet.amount),
          referenceId: bet.id,
          description: `Mise acceptée sur la partie ${params.matchId}`,
        },
      });

      await prisma.match.update({
        where: { id: params.matchId },
        data: {
          betEnabled: true,
          betAmount: bet.amount,
          betStatus: "ACCEPTED",
          betAcceptedAt: new Date(),
        },
      });

      return NextResponse.json({ bet: updatedBet });
    }

    if (action === "reject") {
      const updatedBet = await prisma.gameBet.update({
        where: { id: bet.id },
        data: { status: "REJECTED" },
      });

      await prisma.match.update({
        where: { id: params.matchId },
        data: { betStatus: "REJECTED" },
      });

      return NextResponse.json({ bet: updatedBet });
    }

    if (action === "counter") {
      if (
        typeof amount !== "number" ||
        !Number.isInteger(amount) ||
        amount < MIN_BET_AMOUNT ||
        amount > MAX_BET_AMOUNT
      ) {
        return NextResponse.json(
          { error: `Le montant de la contre-proposition doit être entre ${MIN_BET_AMOUNT} et ${MAX_BET_AMOUNT} points.` },
          { status: 400 },
        );
      }

      const counterProposerBalance = isPlayerWhite ? match.playerWhite.pointsFree : match.playerBlack.pointsFree;
      if (counterProposerBalance < amount) {
        return NextResponse.json(
          { error: "Solde insuffisant pour cette contre-proposition." },
          { status: 400 },
        );
      }

      const updatedBet = await prisma.gameBet.update({
        where: { id: bet.id },
        data: {
          status: "COUNTERED",
          counterProposal: amount,
          counterProposedBy: currentUser.id,
        },
      });

      return NextResponse.json({ bet: updatedBet });
    }

    return NextResponse.json(
      { error: "Action inconnue." },
      { status: 400 },
    );
  } catch (error) {
    console.error("Erreur lors de la gestion de la mise :", error);
    return NextResponse.json(
      { error: "Impossible de traiter la mise." },
      { status: 500 },
    );
  }
}
