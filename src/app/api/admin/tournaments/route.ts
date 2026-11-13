import { Prisma } from "@/generated/prisma-client";
import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const currentUser = await getRequestUser(request);
  if (!currentUser || !currentUser.isAdmin) {
    return NextResponse.json(
      { error: "Accès administrateur requis." },
      { status: 403 },
    );
  }

  try {
    let tournaments;
    try {
      tournaments = await prisma.tournament.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          creator: { select: { id: true, username: true } },
          _count: { select: { participants: true } },
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2022"
      ) {
        throw error;
      }

      console.warn(
        "Schéma des tournois en retard : affichage des champs disponibles avant la migration des détails.",
      );
      tournaments = await prisma.tournament.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          creatorId: true,
          scope: true,
          isPaid: true,
          entryFee: true,
          entryPoints: true,
          totalPrizePool: true,
          maxPlayers: true,
          status: true,
          createdAt: true,
          platformFee: true,
          creator: { select: { id: true, username: true } },
          _count: { select: { participants: true } },
        },
      });
    }

    return NextResponse.json({
      tournaments: tournaments.map((tournament) => ({
        ...tournament,
        name:
          "name" in tournament
            ? tournament.name
            : `Tournoi de ${tournament.creator.username}`,
        creatorUsername: tournament.creator.username,
        participants: tournament._count.participants,
        type: "type" in tournament ? tournament.type : "ELIMINATION",
        initialCapital:
          "initialCapital" in tournament ? tournament.initialCapital : null,
        minBet: "minBet" in tournament ? tournament.minBet : null,
        maxBet: "maxBet" in tournament ? tournament.maxBet : null,
        survivalBankEnabled:
          "survivalBankEnabled" in tournament
            ? tournament.survivalBankEnabled
            : false,
        entryFee: tournament.entryFee.toString(),
        totalPrizePool: tournament.totalPrizePool.toString(),
        platformFee: tournament.platformFee.toString(),
      })),
    });
  } catch (error) {
    console.error("Erreur lors de la lecture des tournois administrateur :", error);
    return NextResponse.json(
      { error: "Impossible de charger les tournois." },
      { status: 500 },
    );
  }
}
