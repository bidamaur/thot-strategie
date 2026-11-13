import {
  Prisma,
  TournamentScope,
  TournamentStatus,
  TournamentType,
  TournamentParticipantStatus,
  User,
} from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import { TournamentConfigService } from "@/lib/tournament/config";

export class TournamentEligibilityError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_AUTHENTICATED" | "INSUFFICIENT_POINTS" | "PREMIUM_REQUIRED" | "INVALID_SCOPE" | "INVALID_INPUT" | "NOT_FOUND" | "TOURNAMENT_NOT_OPEN" | "ALREADY_REGISTERED" | "FULL" | "NOT_ELIGIBLE",
  ) {
    super(message);
    this.name = "TournamentEligibilityError";
  }
}

export interface CreateTournamentRequest {
  userId: string;
  type: TournamentType;
  scope: TournamentScope;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  continent?: string | null;
  isPaid: boolean;
  entryFeeCfa?: number;
  entryPoints?: number;
  maxPlayers: number;
  gameType: "CHESS" | "CHECKERS";
  draughtsVariant?: "ENGLISH" | "INTERNATIONAL";
  timeControlMinutes?: number;
  minElo?: number;
  maxElo?: number;
  minPoints?: number;
  maxPoints?: number;
  initialCapital?: number;
  minBet?: number;
  maxBet?: number;
  betMode?: "FIXED" | "VARIABLE";
  survivalBankEnabled?: boolean;
  rebuyEnabled?: boolean;
  invitedUserIds?: string[];
}

export interface JoinTournamentRequest {
  userId: string;
  tournamentId: string;
}

export class TournamentEligibilityEngine {
  /**
   * VÃ©rifie si un utilisateur peut crÃ©er un tournoi
   * et retourne les contraintes appliquÃ©es
   */
  static async validateCreateTournament(
    request: CreateTournamentRequest,
  ): Promise<{
    allowed: boolean;
    constraints: {
      maxScope: string;
      minPoints: number;
      maxPlayers: { min: number; max: number };
      canBePaid: boolean;
    };
  }> {
    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      select: {
        id: true,
        isPremium: true,
        isAdmin: true,
        premiumLevel: true,
        pointsFree: true,
        country: true,
        city: true,
        neighborhood: true,
      },
    });

    if (!user) {
      throw new TournamentEligibilityError("Utilisateur introuvable.", "NOT_FOUND");
    }

    const isAdmin = user.isAdmin === true;
    const premiumLevel = isAdmin ? 5 : (user.premiumLevel ?? 0);
    const isPremium = user.isPremium === true || isAdmin;

    const [maxScope, minPoints, maxPlayers, allowedTypes] = await Promise.all([
      TournamentConfigService.getPremiumScopeMax(premiumLevel),
      TournamentConfigService.getMinPointsForCommunityTournament(),
      TournamentConfigService.getMaxPlayersPerTournament(),
      TournamentConfigService.getAllowedTournamentTypes(),
    ]);
    const scopeHierarchy: Record<string, number> = {
      NEIGHBORHOOD: 1,
      CITY: 2,
      REGION: 3,
      COUNTRY: 4,
      CONTINENT: 5,
      INTERNATIONAL: 6,
    };

    if (
      scopeHierarchy[request.scope] === undefined ||
      scopeHierarchy[request.scope] > (scopeHierarchy[maxScope] ?? 0)
    ) {
      throw new TournamentEligibilityError(
        `Votre niveau Premium ne permet pas une portÃ©e ${request.scope}. Maximum autorisÃ©: ${maxScope}.`,
        "INVALID_SCOPE",
      );
    }

    if (!allowedTypes.includes(request.type)) {
      throw new TournamentEligibilityError(
        "Ce type de tournoi n’est pas autorisé par la configuration.",
        "INVALID_INPUT",
      );
    }

    // Contraintes pour les tournois communautaires (non-Premium)
    if (!isPremium && !isAdmin) {
      if (request.type !== TournamentType.SURVIVAL_BANK) {
        throw new TournamentEligibilityError(
          "Seuls les tournois Survival Bank sont autorisÃ©s pour les utilisateurs non Premium.",
          "PREMIUM_REQUIRED",
        );
      }
      if (request.scope !== "NEIGHBORHOOD" && request.scope !== "CITY") {
        throw new TournamentEligibilityError(
          "Les tournois communautaires sont limitÃ©s Ã  une portÃ©e ville ou quartier.",
          "INVALID_SCOPE",
        );
      }
      if (user.pointsFree < minPoints) {
        throw new TournamentEligibilityError(
          `Vous devez avoir au moins ${minPoints} points pour crÃ©er un tournoi communautaire.`,
          "INSUFFICIENT_POINTS",
        );
      }
      if (request.isPaid) {
        throw new TournamentEligibilityError(
          "Les utilisateurs non Premium ne peuvent pas crÃ©er de tournois payants.",
          "PREMIUM_REQUIRED",
        );
      }
    }

    // Contraintes de nombre de joueurs
    if (request.maxPlayers < maxPlayers.min || request.maxPlayers > maxPlayers.max) {
      throw new TournamentEligibilityError(
        `Le nombre de joueurs doit Ãªtre entre ${maxPlayers.min} et ${maxPlayers.max}.`,
        "INVALID_INPUT",
      );
    }

    return {
      allowed: true,
      constraints: {
        maxScope,
        minPoints,
        maxPlayers,
        canBePaid: isPremium || isAdmin,
      },
    };
  }

  /**
   * VÃ©rifie si un utilisateur peut rejoindre un tournoi
   */
  static async validateJoinTournament(
    request: JoinTournamentRequest,
  ): Promise<{
    allowed: boolean;
    tournament: any;
    entryCost: { type: "POINTS" | "CFA"; amount: number };
  }> {
    const [tournament, user] = await Promise.all([
      prisma.tournament.findUnique({
        where: { id: request.tournamentId },
        include: {
          participants: {
            select: { userId: true, status: true },
          },
          wallets: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: request.userId },
        select: { id: true, pointsFree: true, walletReal: true, elo: true },
      }),
    ]);

    if (!tournament) {
      throw new TournamentEligibilityError("Tournoi introuvable.", "NOT_FOUND");
    }

    if (tournament.status !== TournamentStatus.OPEN) {
      throw new TournamentEligibilityError(
        "Ce tournoi n'est pas ouvert aux inscriptions.",
        "TOURNAMENT_NOT_OPEN",
      );
    }

    if (tournament.participants.some((p) => p.userId === request.userId)) {
      throw new TournamentEligibilityError(
        "Vous Ãªtes dÃ©jÃ  inscrit Ã  ce tournoi.",
        "ALREADY_REGISTERED",
      );
    }

    if (tournament.participants.length >= tournament.maxPlayers) {
      throw new TournamentEligibilityError(
        "Le tournoi est complet.",
        "FULL",
      );
    }

    // VÃ©rifier les critÃ¨res d'Ã©ligibilitÃ© du tournoi
    if (tournament.minElo != null && user!.elo < tournament.minElo) {
      throw new TournamentEligibilityError(
        `Votre Elo (${user!.elo}) est infÃ©rieur au minimum requis (${tournament.minElo}).`,
        "NOT_ELIGIBLE",
      );
    }
    if (tournament.maxElo != null && user!.elo > tournament.maxElo) {
      throw new TournamentEligibilityError(
        `Votre Elo (${user!.elo}) est supÃ©rieur au maximum autorisÃ© (${tournament.maxElo}).`,
        "NOT_ELIGIBLE",
      );
    }
    if (tournament.minPoints != null && user!.pointsFree < tournament.minPoints) {
      throw new TournamentEligibilityError(
        `Vous devez avoir au moins ${tournament.minPoints} points pour participer.`,
        "NOT_ELIGIBLE",
      );
    }
    if (tournament.maxPoints != null && user!.pointsFree > tournament.maxPoints) {
      throw new TournamentEligibilityError(
        `Vous avez trop de points pour participer Ã  ce tournoi.`,
        "NOT_ELIGIBLE",
      );
    }

    // DÃ©terminer le coÃ»t d'inscription
    let entryCost: { type: "POINTS" | "CFA"; amount: number };
    if (tournament.isPaid) {
      entryCost = { type: "CFA", amount: Number(tournament.entryFee) };
      if (user!.walletReal < tournament.entryFee) {
        throw new TournamentEligibilityError(
          "Solde FCFA insuffisant pour l'inscription.",
          "INSUFFICIENT_POINTS",
        );
      }
    } else {
      entryCost = { type: "POINTS", amount: tournament.entryPoints };
      if (user!.pointsFree < tournament.entryPoints) {
        throw new TournamentEligibilityError(
          `Vous devez avoir au moins ${tournament.entryPoints} points pour vous inscrire.`,
          "INSUFFICIENT_POINTS",
        );
      }
    }

    return { allowed: true, tournament, entryCost };
  }

  /**
   * Inscrire un joueur Ã  un tournoi
   * Pour les tournois Survival Bank, crÃ©e aussi le portefeuille
   */
  static async registerPlayer(request: JoinTournamentRequest) {
    const { allowed, tournament, entryCost } = await this.validateJoinTournament(request);

    if (!allowed) {
      throw new TournamentEligibilityError("Inscription non autorisÃ©e.", "INVALID_INPUT");
    }

    return prisma.$transaction(async (tx) => {
      // DÃ©duire les frais d'inscription
      if (tournament.isPaid) {
        await tx.user.update({
          where: { id: request.userId },
          data: { walletReal: { decrement: tournament.entryFee } },
        });
        await tx.balanceTransaction.create({
          data: {
            userId: request.userId,
            balanceType: "REAL_WALLET",
            transactionType: "TOURNAMENT_ENTRY",
            amount: tournament.entryFee.negated(),
            referenceId: tournament.id,
            description: `Droit d'entrÃ©e tournoi ${tournament.id}`,
          },
        });
      } else {
        await tx.user.update({
          where: { id: request.userId },
          data: { pointsFree: { decrement: tournament.entryPoints } },
        });
        await tx.balanceTransaction.create({
          data: {
            userId: request.userId,
            balanceType: "FREE_POINTS",
            transactionType: "TOURNAMENT_POINTS_ENTRY",
            amount: new Prisma.Decimal(-tournament.entryPoints),
            referenceId: tournament.id,
            description: `Droit d'entrÃ©e en points tournoi ${tournament.id}`,
          },
        });
      }

      // CrÃ©er le participant
      const seed = tournament.participants.length + 1;
      const participant = await tx.tournamentParticipant.create({
        data: {
          tournamentId: request.tournamentId,
          userId: request.userId,
          seed,
          status: TournamentParticipantStatus.ACTIVE,
        },
      });

      // Si c'est un tournoi Survival Bank, crÃ©er le portefeuille
      let wallet = null;
      if (tournament.survivalBankEnabled && tournament.initialCapital) {
        const { SurvivalBankEngine } = await import("./survival-bank");
        wallet = await SurvivalBankEngine.createWallet(
          request.tournamentId,
          request.userId,
          tournament.initialCapital,
        );
      }

      // Si le tournoi est complet, le dÃ©marrer
      const joinedCount = seed;
      if (joinedCount === tournament.maxPlayers) {
        await tx.tournament.update({
          where: { id: request.tournamentId },
          data: { status: TournamentStatus.IN_PROGRESS },
        });

        // Initialiser le format de tournoi
        const { createFormatEngine } = await import("./formats");
        const formatEngine = createFormatEngine(tournament.type, request.tournamentId);
        await formatEngine.initialize();
      }

      return {
        participant,
        wallet,
        tournamentStarted: joinedCount === tournament.maxPlayers,
      };
    });
  }

  /**
   * RÃ©cupÃ©rer les tournois disponibles pour un utilisateur
   */
  static async getAvailableTournaments(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isPremium: true, isAdmin: true, premiumLevel: true, pointsFree: true, elo: true },
    });
    if (!user) return [];

    const tournaments = await prisma.tournament.findMany({
      where: {
        status: TournamentStatus.OPEN,
      },
      include: {
        _count: { select: { participants: true } },
        creator: { select: { id: true, username: true, isPremium: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const isAdmin = user.isAdmin === true;
    const premiumLevel = isAdmin ? 5 : (user.premiumLevel ?? 0);
    const scopeHierarchy: Record<string, number> = {
      NEIGHBORHOOD: 1,
      CITY: 2,
      REGION: 3,
      COUNTRY: 4,
      CONTINENT: 5,
      INTERNATIONAL: 6,
    };
    const maxScope = await TournamentConfigService.getPremiumScopeMax(premiumLevel);

    return tournaments
      .filter((t) => {
        // Filtrer par portÃ©e
        if (scopeHierarchy[t.scope] > (scopeHierarchy[maxScope] ?? 0)) return false;
        // Filtrer par capacitÃ©
        if (t._count.participants >= t.maxPlayers) return false;
        // Filtrer par critÃ¨res Elo
        if (t.minElo != null && user.elo < t.minElo) return false;
        if (t.maxElo != null && user.elo > t.maxElo) return false;
        // Filtrer par critÃ¨res points
        if (t.minPoints != null && user.pointsFree < t.minPoints) return false;
        if (t.maxPoints != null && user.pointsFree > t.maxPoints) return false;
        // Filtrer par type autorisÃ©
        return true;
      })
      .map((t) => ({
        ...t,
        entryFee: t.entryFee.toString(),
        totalPrizePool: t.totalPrizePool.toString(),
        platformFee: t.platformFee.toString(),
        canJoin: t._count.participants < t.maxPlayers,
      }));
  }
}
