import {
  BetStatus,
  Prisma,
  TournamentBet,
  TournamentParticipantStatus,
  TournamentWalletTransactionType,
} from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import { TournamentConfigService } from "@/lib/tournament/config";

export class SurvivalBankError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "INSUFFICIENT_CAPITAL"
      | "ALREADY_ELIMINATED"
      | "INVALID_BET"
      | "ALREADY_SETTLED"
      | "TOURNAMENT_NOT_ACTIVE"
      | "REBUY_NOT_ALLOWED"
      | "INVALID_INPUT",
  ) {
    super(message);
    this.name = "SurvivalBankError";
  }
}

interface WalletContext {
  walletId: string;
  tournamentId: string;
  userId: string;
}

export class SurvivalBankEngine {
  /**
   * Crée un portefeuille de tournoi pour un participant
   * (dépôt du capital initial)
   */
  static async createWallet(
    tournamentId: string,
    userId: string,
    initialCapital: number,
  ) {
    const existing = await prisma.tournamentWallet.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    });
    if (existing) {
      throw new SurvivalBankError(
        "Un portefeuille existe déjà pour ce joueur dans ce tournoi.",
        "NOT_FOUND",
      );
    }

    return prisma.$transaction(async (tx) => {
      const wallet = await tx.tournamentWallet.create({
        data: {
          tournamentId,
          userId,
          capital: initialCapital,
          initialCapital,
          status: TournamentParticipantStatus.ACTIVE,
        },
      });

      await tx.tournamentWalletTransaction.create({
        data: {
          walletId: wallet.id,
          tournamentId,
          userId,
          type: TournamentWalletTransactionType.DEPOSIT,
          amount: initialCapital,
          balanceAfter: initialCapital,
          referenceId: tournamentId,
          description: `Capital initial du tournoi ${tournamentId}`,
        },
      });

      // Mettre à jour le participant avec le statut ACTIVE
      await tx.tournamentParticipant.updateMany({
        where: { tournamentId, userId },
        data: { status: TournamentParticipantStatus.ACTIVE },
      });

      return wallet;
    });
  }

  /**
   * Dépose des points dans le portefeuille de tournoi
   */
  static async deposit(
    walletId: string,
    amount: number,
    referenceId: string | null,
    description: string,
  ) {
    if (amount <= 0) {
      throw new SurvivalBankError("Le montant du dépôt doit être positif.", "INVALID_INPUT");
    }

    return prisma.$transaction(async (tx) => {
      const wallet = await tx.tournamentWallet.findUnique({
        where: { id: walletId },
      });
      if (!wallet) {
        throw new SurvivalBankError("Portefeuille introuvable.", "NOT_FOUND");
      }
      if (wallet.status === TournamentParticipantStatus.ELIMINATED) {
        throw new SurvivalBankError(
          "Le joueur est éliminé, impossible de déposer.",
          "ALREADY_ELIMINATED",
        );
      }

      const newCapital = wallet.capital + amount;
      const updated = await tx.tournamentWallet.update({
        where: { id: walletId },
        data: { capital: newCapital },
      });

      await tx.tournamentWalletTransaction.create({
        data: {
          walletId,
          tournamentId: wallet.tournamentId,
          userId: wallet.userId,
          type: TournamentWalletTransactionType.DEPOSIT,
          amount,
          balanceAfter: newCapital,
          referenceId,
          description,
        },
      });

      return updated;
    });
  }

  /**
   * Place une mise pour un match
   * Réserve le montant dans le portefeuille
   */
  static async placeBet(
    tournamentId: string,
    matchId: string,
    walletId: string,
    userId: string,
    amount: number,
  ): Promise<TournamentBet> {
    if (amount <= 0) {
      throw new SurvivalBankError("La mise doit être positive.", "INVALID_INPUT");
    }

    return prisma.$transaction(async (tx) => {
      const wallet = await tx.tournamentWallet.findUnique({
        where: { id: walletId },
      });
      if (!wallet) {
        throw new SurvivalBankError("Portefeuille introuvable.", "NOT_FOUND");
      }
      if (wallet.tournamentId !== tournamentId) {
        throw new SurvivalBankError(
          "Le portefeuille n'appartient pas à ce tournoi.",
          "NOT_FOUND",
        );
      }
      if (wallet.status === TournamentParticipantStatus.ELIMINATED) {
        throw new SurvivalBankError(
          "Le joueur est éliminé, impossible de miser.",
          "ALREADY_ELIMINATED",
        );
      }
      if (wallet.capital < amount) {
        throw new SurvivalBankError(
          "Capital insuffisant pour cette mise.",
          "INSUFFICIENT_CAPITAL",
        );
      }

      // Vérifier qu'il n'y a pas déjà une mise pour ce match et ce joueur
      const existingBet = await tx.tournamentBet.findFirst({
        where: { matchId, userId, status: { not: "REFUNDED" } },
      });
      if (existingBet) {
        throw new SurvivalBankError(
          "Une mise existe déjà pour ce match.",
          "INVALID_BET",
        );
      }

      const newCapital = wallet.capital - amount;
      const updatedWallet = await tx.tournamentWallet.update({
        where: { id: walletId },
        data: { capital: newCapital, totalBets: { increment: 1 } },
      });

      const bet = await tx.tournamentBet.create({
        data: {
          tournamentId,
          matchId,
          walletId,
          userId,
          amount,
          status: BetStatus.PROPOSED,
        },
      });

      await tx.tournamentWalletTransaction.create({
        data: {
          walletId,
          tournamentId,
          userId,
          type: TournamentWalletTransactionType.BET_PLACED,
          amount: -amount,
          balanceAfter: newCapital,
          referenceId: bet.id,
          description: `Mise proposée pour le match ${matchId}`,
        },
      });

      return bet;
    });
  }

  /**
   * Accepte une mise (l'adversaire accepte)
   * Le montant est déjà réservé par le proposeur
   */
  static async acceptBet(betId: string, acceptorWalletId: string): Promise<TournamentBet> {
    return prisma.$transaction(async (tx) => {
      const bet = await tx.tournamentBet.findUnique({
        where: { id: betId },
      });
      if (!bet) {
        throw new SurvivalBankError("Mise introuvable.", "NOT_FOUND");
      }
      if (bet.status !== BetStatus.PROPOSED) {
        throw new SurvivalBankError("Cette mise ne peut pas être acceptée.", "INVALID_BET");
      }

      const acceptorWallet = await tx.tournamentWallet.findUnique({
        where: { id: acceptorWalletId },
      });
      if (!acceptorWallet) {
        throw new SurvivalBankError("Portefeuille introuvable.", "NOT_FOUND");
      }
      if (acceptorWallet.tournamentId !== bet.tournamentId) {
        throw new SurvivalBankError("Portefeuille dans un autre tournoi.", "NOT_FOUND");
      }
      if (acceptorWallet.status === TournamentParticipantStatus.ELIMINATED) {
        throw new SurvivalBankError(
          "Le joueur est éliminé, impossible d'accepter la mise.",
          "ALREADY_ELIMINATED",
        );
      }
      if (acceptorWallet.capital < bet.amount) {
        throw new SurvivalBankError(
          "Capital insuffisant pour accepter cette mise.",
          "INSUFFICIENT_CAPITAL",
        );
      }

      // Déduire la mise de l'accepteur
      const newAcceptorCapital = acceptorWallet.capital - bet.amount;
      await tx.tournamentWallet.update({
        where: { id: acceptorWalletId },
        data: { capital: newAcceptorCapital, totalBets: { increment: 1 } },
      });

      await tx.tournamentWalletTransaction.create({
        data: {
          walletId: acceptorWalletId,
          tournamentId: bet.tournamentId,
          userId: acceptorWallet.userId,
          type: TournamentWalletTransactionType.BET_PLACED,
          amount: -bet.amount,
          balanceAfter: newAcceptorCapital,
          referenceId: bet.id,
          description: `Mise acceptée pour le match ${bet.matchId}`,
        },
      });

      return tx.tournamentBet.update({
        where: { id: betId },
        data: { status: BetStatus.ACCEPTED, acceptedAt: new Date() },
      });
    });
  }

  /**
   * Refuse une mise - rembourse le proposeur
   */
  static async rejectBet(betId: string): Promise<TournamentBet> {
    return prisma.$transaction(async (tx) => {
      const bet = await tx.tournamentBet.findUnique({
        where: { id: betId },
      });
      if (!bet) {
        throw new SurvivalBankError("Mise introuvable.", "NOT_FOUND");
      }
      if (bet.status !== BetStatus.PROPOSED) {
        throw new SurvivalBankError("Cette mise ne peut pas être refusée.", "INVALID_BET");
      }

      // Rembourser le proposeur
      const wallet = await tx.tournamentWallet.findUnique({
        where: { id: bet.walletId },
      });
      if (!wallet) {
        throw new SurvivalBankError("Portefeuille introuvable.", "NOT_FOUND");
      }

      const newCapital = wallet.capital + bet.amount;
      await tx.tournamentWallet.update({
        where: { id: bet.walletId },
        data: { capital: newCapital },
      });

      await tx.tournamentWalletTransaction.create({
        data: {
          walletId: bet.walletId,
          tournamentId: bet.tournamentId,
          userId: bet.userId,
          type: TournamentWalletTransactionType.BET_REFUNDED,
          amount: bet.amount,
          balanceAfter: newCapital,
          referenceId: bet.id,
          description: `Mise refusée pour le match ${bet.matchId}`,
        },
      });

      return tx.tournamentBet.update({
        where: { id: betId },
        data: { status: BetStatus.REFUNDED, settledAt: new Date() },
      });
    });
  }

  /**
   * Réglement d'une mise après le match
   * Idempotent : ne peut être appelé qu'une fois par mise
   */
  static async settleBet(
    betId: string,
    winnerUserId: string | null, // null = match nul, remboursement
  ): Promise<{ winnerWalletId: string | null; amountTransferred: number }> {
    return prisma.$transaction(async (tx) => {
      const bet = await tx.tournamentBet.findUnique({
        where: { id: betId },
        include: { wallet: true },
      });
      if (!bet) {
        throw new SurvivalBankError("Mise introuvable.", "NOT_FOUND");
      }
      if (bet.status === BetStatus.SETTLED) {
        throw new SurvivalBankError("Cette mise a déjà été réglée.", "ALREADY_SETTLED");
      }
      if (bet.status !== BetStatus.ACCEPTED && bet.status !== BetStatus.COUNTERED) {
        throw new SurvivalBankError("Cette mise n'est pas acceptée.", "INVALID_BET");
      }

      const proposerWallet = bet.wallet;
      // Trouver le portefeuille de l'adversaire (celui qui a accepté)
      const opponentBet = await tx.tournamentBet.findFirst({
        where: { matchId: bet.matchId, userId: { not: bet.userId }, status: BetStatus.ACCEPTED },
      });
      if (!opponentBet) {
        throw new SurvivalBankError("Mise de l'adversaire introuvable.", "NOT_FOUND");
      }

      const opponentWallet = await tx.tournamentWallet.findUnique({
        where: { id: opponentBet.walletId },
      });
      if (!opponentWallet) {
        throw new SurvivalBankError("Portefeuille adversaire introuvable.", "NOT_FOUND");
      }

      let winnerWalletId: string | null = null;
      let amountTransferred = 0;

      if (winnerUserId === null) {
        // Match nul - rembourser les deux mises
        // Rembourser le proposeur
        const proposerNewCapital = proposerWallet.capital + bet.amount;
        await tx.tournamentWallet.update({
          where: { id: proposerWallet.id },
          data: { capital: proposerNewCapital },
        });
        await tx.tournamentWalletTransaction.create({
          data: {
            walletId: proposerWallet.id,
            tournamentId: bet.tournamentId,
            userId: bet.userId,
            type: TournamentWalletTransactionType.BET_REFUNDED,
            amount: bet.amount,
            balanceAfter: proposerNewCapital,
            referenceId: bet.id,
            description: `Remboursement mise nulle - match ${bet.matchId}`,
          },
        });

        // Rembourser l'adversaire
        const opponentNewCapital = opponentWallet.capital + opponentBet.amount;
        await tx.tournamentWallet.update({
          where: { id: opponentWallet.id },
          data: { capital: opponentNewCapital },
        });
        await tx.tournamentWalletTransaction.create({
          data: {
            walletId: opponentWallet.id,
            tournamentId: bet.tournamentId,
            userId: opponentBet.userId,
            type: TournamentWalletTransactionType.BET_REFUNDED,
            amount: opponentBet.amount,
            balanceAfter: opponentNewCapital,
            referenceId: opponentBet.id,
            description: `Remboursement mise nulle - match ${bet.matchId}`,
          },
        });

        amountTransferred = 0;
      } else if (winnerUserId === bet.userId) {
        // Le proposeur gagne
        // Le proposeur récupère sa mise + la mise de l'adversaire
        const winnerNewCapital = proposerWallet.capital + bet.amount + opponentBet.amount;
        await tx.tournamentWallet.update({
          where: { id: proposerWallet.id },
          data: {
            capital: winnerNewCapital,
            totalWon: { increment: 1 },
            matchesWon: { increment: 1 },
            winStreak: { increment: 1 },
          },
        });
        await tx.tournamentWalletTransaction.create({
          data: {
            walletId: proposerWallet.id,
            tournamentId: bet.tournamentId,
            userId: bet.userId,
            type: TournamentWalletTransactionType.BET_WON,
            amount: opponentBet.amount,
            balanceAfter: winnerNewCapital,
            referenceId: bet.id,
            description: `Gain de mise - match ${bet.matchId}`,
          },
        });

        // L'adversaire perd sa mise (déjà déduite lors de l'acceptation)
        await tx.tournamentWallet.update({
          where: { id: opponentWallet.id },
          data: {
            totalLost: { increment: 1 },
            matchesLost: { increment: 1 },
            winStreak: 0,
          },
        });
        await tx.tournamentWalletTransaction.create({
          data: {
            walletId: opponentWallet.id,
            tournamentId: bet.tournamentId,
            userId: opponentBet.userId,
            type: TournamentWalletTransactionType.BET_LOST,
            amount: -opponentBet.amount,
            balanceAfter: opponentWallet.capital,
            referenceId: bet.id,
            description: `Perte de mise - match ${bet.matchId}`,
          },
        });

        winnerWalletId = proposerWallet.id;
        amountTransferred = opponentBet.amount;
      } else {
        // L'adversaire gagne
        const winnerNewCapital = opponentWallet.capital + bet.amount + opponentBet.amount;
        await tx.tournamentWallet.update({
          where: { id: opponentWallet.id },
          data: {
            capital: winnerNewCapital,
            totalWon: { increment: 1 },
            matchesWon: { increment: 1 },
            winStreak: { increment: 1 },
          },
        });
        await tx.tournamentWalletTransaction.create({
          data: {
            walletId: opponentWallet.id,
            tournamentId: bet.tournamentId,
            userId: opponentBet.userId,
            type: TournamentWalletTransactionType.BET_WON,
            amount: bet.amount,
            balanceAfter: winnerNewCapital,
            referenceId: bet.id,
            description: `Gain de mise - match ${bet.matchId}`,
          },
        });

        // Le proposeur perd sa mise (déjà déduite lors du placement)
        await tx.tournamentWallet.update({
          where: { id: proposerWallet.id },
          data: {
            totalLost: { increment: 1 },
            matchesLost: { increment: 1 },
            winStreak: 0,
          },
        });
        await tx.tournamentWalletTransaction.create({
          data: {
            walletId: proposerWallet.id,
            tournamentId: bet.tournamentId,
            userId: bet.userId,
            type: TournamentWalletTransactionType.BET_LOST,
            amount: -bet.amount,
            balanceAfter: proposerWallet.capital,
            referenceId: bet.id,
            description: `Perte de mise - match ${bet.matchId}`,
          },
        });

        winnerWalletId = opponentWallet.id;
        amountTransferred = bet.amount;
      }

      // Mettre à jour le statut des mises
      await tx.tournamentBet.update({
        where: { id: betId },
        data: { status: BetStatus.SETTLED, settledAt: new Date() },
      });
      await tx.tournamentBet.update({
        where: { id: opponentBet.id },
        data: { status: BetStatus.SETTLED, settledAt: new Date() },
      });

      return { winnerWalletId, amountTransferred };
    });
  }

  /**
   * Vérifie si un joueur doit être éliminé (capital à zéro)
   * et met à jour son statut
   */
  static async checkElimination(
    tournamentId: string,
    userId: string,
    minBet: number,
  ): Promise<{ eliminated: boolean; walletId: string | null }> {
    const wallet = await prisma.tournamentWallet.findFirst({
      where: { tournamentId, userId },
    });
    if (!wallet) {
      return { eliminated: false, walletId: null };
    }

    if (wallet.status === TournamentParticipantStatus.ELIMINATED) {
      return { eliminated: true, walletId: wallet.id };
    }

    if (wallet.capital <= 0) {
      // Éliminer le joueur
      await prisma.tournamentWallet.update({
        where: { id: wallet.id },
        data: {
          status: TournamentParticipantStatus.ELIMINATED,
          eliminatedAt: new Date(),
        },
      });
      await prisma.tournamentParticipant.updateMany({
        where: { tournamentId, userId },
        data: {
          status: TournamentParticipantStatus.ELIMINATED,
          eliminatedAt: new Date(),
        },
      });

      return { eliminated: true, walletId: wallet.id };
    }

    // Vérifier si le capital est inférieur à la mise minimale
    // (sauf si rebuy activé)
    if (wallet.capital < minBet) {
      const rebuyEnabled = await this.isRebuyEnabled(tournamentId);
      if (!rebuyEnabled) {
        await prisma.tournamentWallet.update({
          where: { id: wallet.id },
          data: {
            status: TournamentParticipantStatus.ELIMINATED,
            eliminatedAt: new Date(),
            eliminationReason: "CAPITAL_INSUFFICIENT",
          },
        });
        await prisma.tournamentParticipant.updateMany({
          where: { tournamentId, userId },
          data: {
            status: TournamentParticipantStatus.ELIMINATED,
            eliminatedAt: new Date(),
          },
        });
        return { eliminated: true, walletId: wallet.id };
      }
    }

    return { eliminated: false, walletId: wallet.id };
  }

  /**
   * Rebuy - recharger le capital après élimination
   * Seulement si activé dans la configuration du tournoi
   */
  static async rebuy(
    tournamentId: string,
    userId: string,
    pointsSource: "NORMAL_POINTS" | "ADMIN_GRANT",
    amount: number,
  ) {
    const wallet = await prisma.tournamentWallet.findFirst({
      where: { tournamentId, userId },
    });
    if (!wallet) {
      throw new SurvivalBankError("Portefeuille introuvable.", "NOT_FOUND");
    }
    if (wallet.status !== TournamentParticipantStatus.ELIMINATED) {
      throw new SurvivalBankError(
        "Le joueur n'est pas éliminé, rebuy non nécessaire.",
        "INVALID_INPUT",
      );
    }

    const rebuyEnabled = await this.isRebuyEnabled(tournamentId);
    if (!rebuyEnabled) {
      throw new SurvivalBankError("Le rebuy n'est pas autorisé dans ce tournoi.", "REBUY_NOT_ALLOWED");
    }

    const rebuyCost = await TournamentConfigService.getRebuyCostDefault();
    if (pointsSource === "NORMAL_POINTS") {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { pointsFree: true },
      });
      if (!user || user.pointsFree < rebuyCost) {
        throw new SurvivalBankError(
          "Points normaux insuffisants pour le rebuy.",
          "INSUFFICIENT_CAPITAL",
        );
      }
      await prisma.user.update({
        where: { id: userId },
        data: { pointsFree: { decrement: rebuyCost } },
      });
    }

    const newCapital = wallet.initialCapital; // Rebuy remet le capital initial
    const updatedWallet = await prisma.tournamentWallet.update({
      where: { id: wallet.id },
      data: {
        capital: newCapital,
        status: TournamentParticipantStatus.ACTIVE,
        eliminatedAt: null,
        eliminationReason: null,
      },
    });

    await prisma.tournamentParticipant.updateMany({
      where: { tournamentId, userId },
      data: {
        status: TournamentParticipantStatus.ACTIVE,
        eliminatedAt: null,
      },
    });

    await prisma.tournamentWalletTransaction.create({
      data: {
        walletId: wallet.id,
        tournamentId,
        userId,
        type: TournamentWalletTransactionType.DEPOSIT,
        amount: newCapital,
        balanceAfter: newCapital,
        referenceId: `rebuy:${tournamentId}`,
        description: `Rebuy après élimination - tournoi ${tournamentId}`,
      },
    });

    return updatedWallet;
  }

  /**
   * Vérifier si le rebuy est activé pour un tournoi
   */
  static async isRebuyEnabled(tournamentId: string): Promise<boolean> {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { rebuyEnabled: true },
    });
    return tournament?.rebuyEnabled ?? false;
  }

  /**
   * Récupérer le portefeuille d'un joueur dans un tournoi
   */
  static async getWallet(tournamentId: string, userId: string) {
    return prisma.tournamentWallet.findFirst({
      where: { tournamentId, userId },
      include: {
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    });
  }

  /**
   * Attribuer une récompense en points à un joueur
   */
  static async awardPrize(
    tournamentId: string,
    userId: string,
    amount: number,
    place: number,
  ) {
    const wallet = await prisma.tournamentWallet.findFirst({
      where: { tournamentId, userId },
    });
    if (!wallet) {
      throw new SurvivalBankError("Portefeuille introuvable.", "NOT_FOUND");
    }

    const newCapital = wallet.capital + amount;
    const updated = await prisma.tournamentWallet.update({
      where: { id: wallet.id },
      data: { capital: newCapital },
    });

    await prisma.tournamentWalletTransaction.create({
      data: {
        walletId: wallet.id,
        tournamentId,
        userId,
        type: TournamentWalletTransactionType.PRIZE_AWARDED,
        amount,
        balanceAfter: newCapital,
        referenceId: `prize:${place}`,
        description: `Récompense ${place}ᵉ place - tournoi ${tournamentId}`,
      },
    });

    return updated;
  }
}
