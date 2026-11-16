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
import { getPrivileges, SCOPE_RANK } from "@/lib/premium/privileges";
import { getSetting } from "@/lib/settings/service";

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
  visibility?: "PUBLIC" | "PRIVATE" | "CLUB";
  clubId?: string | null;
}

export interface JoinTournamentRequest {
  userId: string;
  tournamentId: string;
}

export class TournamentEligibilityEngine {
  /**
   * Vérifie si un utilisateur peut créer un tournoi
   * et retourne les contraintes appliquées
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
        premiumExpiresAt: true,
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
    const { privileges, level } = await getPrivileges({
      isAdmin,
      isPremium: user.isPremium,
      premiumLevel: user.premiumLevel ?? 0,
      premiumExpiresAt: user.premiumExpiresAt,
    });
    const isPremium = isAdmin || level > 0;

    const [minPoints, maxPlayers, allowedTypes, paidEnabled] = await Promise.all([
      TournamentConfigService.getMinPointsForCommunityTournament(),
      TournamentConfigService.getMaxPlayersPerTournament(),
      TournamentConfigService.getAllowedTournamentTypes(),
      getSetting("money.tournamentsEnabled"),
    ]);
    const maxScope = privileges.maxScope;

    if (!allowedTypes.includes(request.type)) {
      throw new TournamentEligibilityError(
        "Ce format de tournoi est désactivé par l’administration.",
        "INVALID_INPUT",
      );
    }

    // Survival : ouvert à TOUS les joueurs disposant du minimum de points.
    const isSurvival = request.type === TournamentType.SURVIVAL_BANK;
    if (isSurvival) {
      if (!isPremium && user.pointsFree < minPoints) {
        throw new TournamentEligibilityError(
          `Il faut au moins ${minPoints} points classiques pour organiser un tournoi Survival.`,
          "INSUFFICIENT_POINTS",
        );
      }
    } else if (!privileges.tournamentFormats.includes(request.type)) {
      throw new TournamentEligibilityError(
        isPremium
          ? "Ce format n’est pas inclus dans votre niveau Premium."
          : "Ce format est réservé aux membres Premium. Le Survival reste ouvert à tous.",
        "PREMIUM_REQUIRED",
      );
    }

    if (
      SCOPE_RANK[request.scope] === undefined ||
      SCOPE_RANK[request.scope]! > (SCOPE_RANK[maxScope] ?? 0)
    ) {
      throw new TournamentEligibilityError(
        `Votre niveau permet une portée maximale « ${maxScope} ».`,
        "INVALID_SCOPE",
      );
    }

    if (request.isPaid) {
      if (!paidEnabled) {
        throw new TournamentEligibilityError(
          "Les tournois payants sont désactivés par l’administration.",
          "INVALID_INPUT",
        );
      }
      if (!privileges.paidTournaments) {
        throw new TournamentEligibilityError(
          "Votre niveau Premium ne permet pas d’organiser des tournois payants.",
          "PREMIUM_REQUIRED",
        );
      }
    }

    if (request.visibility === "PRIVATE" && !privileges.privateTournaments) {
      throw new TournamentEligibilityError(
        "Les tournois privés sont réservés aux membres Premium.",
        "PREMIUM_REQUIRED",
      );
    }
    if (request.visibility === "CLUB" || request.clubId) {
      if (!request.clubId) {
        throw new TournamentEligibilityError("Club requis pour un tournoi de club.", "INVALID_INPUT");
      }
      const membership = await prisma.clubMember.findUnique({
        where: { clubId_userId: { clubId: request.clubId, userId: request.userId } },
        select: { role: true },
      });
      if (!isAdmin && (!membership || membership.role === "MEMBER")) {
        throw new TournamentEligibilityError(
          "Seuls les responsables du club peuvent organiser ses tournois.",
          "NOT_ELIGIBLE",
        );
      }
    }

    const capacityMax = Math.min(maxPlayers.max, privileges.maxTournamentPlayers);
    if (request.maxPlayers < maxPlayers.min || request.maxPlayers > capacityMax) {
      throw new TournamentEligibilityError(
        `Le nombre de joueurs doit être compris entre ${maxPlayers.min} et ${capacityMax}.`,
        "INVALID_INPUT",
      );
    }

    if (!isAdmin) {
      const active = await prisma.tournament.count({
        where: {
          creatorId: request.userId,
          status: { in: [TournamentStatus.OPEN, TournamentStatus.IN_PROGRESS] },
        },
      });
      if (active >= privileges.maxActiveTournaments) {
        throw new TournamentEligibilityError(
          `Vous avez déjà ${active} tournoi(s) actif(s) : limite de votre niveau atteinte.`,
          "PREMIUM_REQUIRED",
        );
      }
    }

    return {
      allowed: true,
      constraints: {
        maxScope,
        minPoints,
        maxPlayers,
        canBePaid: privileges.paidTournaments && paidEnabled,
      },
    };
  }

  /**
   * Vérifie si un utilisateur peut rejoindre un tournoi
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
        "Vous êtes déjà inscrit à ce tournoi.",
        "ALREADY_REGISTERED",
      );
    }

    if (tournament.participants.length >= tournament.maxPlayers) {
      throw new TournamentEligibilityError(
        "Le tournoi est complet.",
        "FULL",
      );
    }

    // Vérifier les critères d'éligibilité du tournoi
    if (tournament.minElo != null && user!.elo < tournament.minElo) {
      throw new TournamentEligibilityError(
        `Votre Elo (${user!.elo}) est inférieur au minimum requis (${tournament.minElo}).`,
        "NOT_ELIGIBLE",
      );
    }
    if (tournament.maxElo != null && user!.elo > tournament.maxElo) {
      throw new TournamentEligibilityError(
        `Votre Elo (${user!.elo}) est supérieur au maximum autorisé (${tournament.maxElo}).`,
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
        `Vous avez trop de points pour participer à ce tournoi.`,
        "NOT_ELIGIBLE",
      );
    }

    // Déterminer le coût d'inscription
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
   * Inscrire un joueur à un tournoi
   * Pour les tournois Survival Bank, crée aussi le portefeuille
   */
  static async registerPlayer(request: JoinTournamentRequest) {
    const { allowed, tournament, entryCost } = await this.validateJoinTournament(request);

    if (!allowed) {
      throw new TournamentEligibilityError("Inscription non autorisée.", "INVALID_INPUT");
    }

    return prisma.$transaction(async (tx) => {
      // Déduire les frais d'inscription
      if (tournament.isPaid) {
        const debit = await tx.user.updateMany({
          where: {
            id: request.userId,
            walletReal: { gte: tournament.entryFee },
          },
          data: { walletReal: { decrement: tournament.entryFee } },
        });
        if (debit.count !== 1) {
          throw new TournamentEligibilityError(
            "Solde FCFA insuffisant pour l'inscription.",
            "INSUFFICIENT_POINTS",
          );
        }
        await tx.balanceTransaction.create({
          data: {
            userId: request.userId,
            balanceType: "REAL_WALLET",
            transactionType: "TOURNAMENT_ENTRY",
            amount: tournament.entryFee.negated(),
            referenceId: tournament.id,
            description: `Droit d'entrée tournoi ${tournament.id}`,
          },
        });
      } else {
        const debit = await tx.user.updateMany({
          where: {
            id: request.userId,
            pointsFree: { gte: tournament.entryPoints },
          },
          data: { pointsFree: { decrement: tournament.entryPoints } },
        });
        if (debit.count !== 1) {
          throw new TournamentEligibilityError(
            `Vous devez avoir au moins ${tournament.entryPoints} points pour vous inscrire.`,
            "INSUFFICIENT_POINTS",
          );
        }
        await tx.balanceTransaction.create({
          data: {
            userId: request.userId,
            balanceType: "FREE_POINTS",
            transactionType: "TOURNAMENT_POINTS_ENTRY",
            amount: new Prisma.Decimal(-tournament.entryPoints),
            referenceId: tournament.id,
            description: `Droit d'entrée en points tournoi ${tournament.id}`,
          },
        });
      }

      // Créer le participant
      const seed = tournament.participants.length + 1;
      const participant = await tx.tournamentParticipant.create({
        data: {
          tournamentId: request.tournamentId,
          userId: request.userId,
          seed,
          status: TournamentParticipantStatus.ACTIVE,
        },
      });

      // Si c'est un tournoi Survival Bank, créer le portefeuille
      let wallet = null;
      if (tournament.survivalBankEnabled && tournament.initialCapital) {
        const { SurvivalBankEngine } = await import("./survival-bank");
        wallet = await SurvivalBankEngine.createWallet(
          request.tournamentId,
          request.userId,
          tournament.initialCapital,
        );
      }

      // Si le tournoi est complet, le démarrer
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
   * Récupérer les tournois disponibles pour un utilisateur
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

    return tournaments
      .filter((t) => {
        // Filtrer par capacité
        if (t._count.participants >= t.maxPlayers) return false;
        // Filtrer par critères Elo
        if (t.minElo != null && user.elo < t.minElo) return false;
        if (t.maxElo != null && user.elo > t.maxElo) return false;
        // Filtrer par critères points
        if (t.minPoints != null && user.pointsFree < t.minPoints) return false;
        if (t.maxPoints != null && user.pointsFree > t.maxPoints) return false;
        // Filtrer par type autorisé
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
