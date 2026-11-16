import { Prisma } from "@/generated/prisma-client";
import { getRequestUser } from "@/lib/auth/session";
import { escrowGameBet, InsufficientBetBalanceError } from "@/lib/economy/game-bets";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const MAX_BET_AMOUNT = 1000;
const MIN_BET_AMOUNT = 1;

async function assertBettingOpen(
  transaction: Prisma.TransactionClient,
  matchId: string,
): Promise<void> {
  const match = await transaction.match.findUnique({
    where: { id: matchId },
    select: { status: true, movesHistory: true },
  });
  if (
    match?.status !== "IN_PROGRESS" ||
    !Array.isArray(match.movesHistory) ||
    match.movesHistory.length > 0
  ) {
    throw new Error("BET_NOT_OPEN");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> },
): Promise<NextResponse> {
  const { matchId } = await params;
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
      where: { id: matchId },
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

    // Séparation des portefeuilles : une partie rémunérée a déjà sa mise en
    // points argent ; aucun défi en points classiques ne peut s'y ajouter.
    if (match.mode === "MONEY") {
      return NextResponse.json(
        { error: "Les défis en points classiques sont indisponibles en partie rémunérée." },
        { status: 409 },
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

    if (match.status !== "IN_PROGRESS") {
      return NextResponse.json(
        { error: "La partie ne peut plus recevoir d'action de mise." },
        { status: 400 },
      );
    }

    const opponentId = isPlayerWhite ? match.playerBlackId! : match.playerWhiteId;

    // --- PROPOSE ---
    if (action === "propose") {
      if (
        !Array.isArray(match.movesHistory) ||
        match.movesHistory.length > 0
      ) {
        return NextResponse.json(
          { error: "La mise ne peut être proposée qu'avant le premier coup." },
          { status: 400 },
        );
      }

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

      if (
        match.gameBet &&
        match.gameBet.status !== "REJECTED" &&
        match.gameBet.status !== "EXPIRED"
      ) {
        return NextResponse.json(
          { error: "Une mise est déjà en cours ou réglée sur cette partie." },
          { status: 409 },
        );
      }

      const bet = await prisma.$transaction(async (transaction) => {
        await assertBettingOpen(transaction, matchId);
        const updatedBet = await transaction.gameBet.upsert({
          where: { matchId },
          create: {
            matchId,
            proposerId: currentUser.id,
            opponentId,
            amount,
            status: "PROPOSED",
          },
          update: {
            proposerId: currentUser.id,
            opponentId,
            amount,
            status: "PROPOSED",
            acceptedAt: null,
            settledAt: null,
            counterProposal: null,
            counterProposedBy: null,
          },
          include: {
            proposer: { select: { id: true, username: true } },
            opponent: { select: { id: true, username: true } },
          },
        });
        await transaction.match.update({
          where: { id: matchId },
          data: {
            betEnabled: true,
            betAmount: amount,
            betStatus: "PROPOSED",
            betProposedById: currentUser.id,
            betAcceptedAt: null,
            betSettledAt: null,
          },
        });
        return updatedBet;
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

    if (bet.status !== "PROPOSED" && bet.status !== "COUNTERED") {
      return NextResponse.json(
        { error: "Cette mise n'est plus en attente." },
        { status: 400 },
      );
    }

    const pendingProposerId =
      bet.status === "COUNTERED"
        ? bet.counterProposedBy ?? bet.proposerId
        : bet.proposerId;
    if (
      currentUser.id === pendingProposerId ||
      (action !== "counter" &&
        currentUser.id !== (pendingProposerId === bet.proposerId
          ? bet.opponentId
          : bet.proposerId))
    ) {
      return NextResponse.json(
        { error: "Seul l'adversaire peut accepter ou refuser cette mise." },
        { status: 403 },
      );
    }

    if (action === "accept") {
      const acceptedAmount =
        bet.status === "COUNTERED"
          ? bet.counterProposal ?? bet.amount
          : bet.amount;
      const updatedBet = await prisma.$transaction(async (transaction) => {
        await assertBettingOpen(transaction, matchId);
        const claimed = await transaction.gameBet.updateMany({
          where: { id: bet.id, status: bet.status },
          data: {
            amount: acceptedAmount,
            status: "ACCEPTED",
            acceptedAt: new Date(),
          },
        });
        if (claimed.count !== 1) {
          throw new Error("BET_NOT_PENDING");
        }
        await escrowGameBet(transaction, {
          betId: bet.id,
          matchId,
          playerIds: [match.playerWhiteId, match.playerBlackId!],
          amount: acceptedAmount,
        });
        await transaction.match.update({
          where: { id: matchId },
          data: {
            betEnabled: true,
            betAmount: acceptedAmount,
            betStatus: "ACCEPTED",
            betProposedById: pendingProposerId,
            betAcceptedAt: new Date(),
          },
        });
        return transaction.gameBet.findUniqueOrThrow({
          where: { id: bet.id },
          include: {
            proposer: { select: { id: true, username: true } },
            opponent: { select: { id: true, username: true } },
          },
        });
      });
      return NextResponse.json({ bet: updatedBet });
    }

    if (action === "reject") {
      const updatedBet = await prisma.$transaction(async (transaction) => {
        const rejected = await transaction.gameBet.updateMany({
          where: { id: bet.id, status: bet.status },
          data: { status: "REJECTED" },
        });
        if (rejected.count !== 1) {
          throw new Error("BET_NOT_PENDING");
        }
        await transaction.match.update({
          where: { id: matchId },
          data: {
            betEnabled: false,
            betAmount: 0,
            betStatus: "REJECTED",
            betProposedById: null,
          },
        });
        return transaction.gameBet.findUniqueOrThrow({
          where: { id: bet.id },
        });
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

      const updatedBet = await prisma.$transaction(async (transaction) => {
        await assertBettingOpen(transaction, matchId);
        const countered = await transaction.gameBet.updateMany({
          where: { id: bet.id, status: bet.status },
          data: {
            status: "COUNTERED",
            counterProposal: amount,
            counterProposedBy: currentUser.id,
          },
        });
        if (countered.count !== 1) {
          throw new Error("BET_NOT_PENDING");
        }
        await transaction.match.update({
          where: { id: matchId },
          data: {
            betEnabled: true,
            betAmount: amount,
            betStatus: "COUNTERED",
            betProposedById: currentUser.id,
          },
        });
        return transaction.gameBet.findUniqueOrThrow({
          where: { id: bet.id },
        });
      });

      return NextResponse.json({ bet: updatedBet });
    }

    return NextResponse.json(
      { error: "Action inconnue." },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof InsufficientBetBalanceError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "BET_NOT_PENDING") {
      return NextResponse.json(
        { error: "Cette mise n'est plus en attente." },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "BET_NOT_OPEN") {
      return NextResponse.json(
        { error: "La mise ne peut être modifiée qu'avant le premier coup." },
        { status: 409 },
      );
    }
    console.error("Erreur lors de la gestion de la mise :", error);
    return NextResponse.json(
      { error: "Impossible de traiter la mise." },
      { status: 500 },
    );
  }
}
