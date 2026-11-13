import {
  Prisma,
  TournamentConfig,
  User,
} from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";

export class TournamentConfigError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "NOT_EDITABLE" | "INVALID_INPUT" | "UNAUTHORIZED",
  ) {
    super(message);
    this.name = "TournamentConfigError";
  }
}

export interface ConfigValue {
  key: string;
  value: unknown;
  description?: string;
  isEditable: boolean;
}

export class TournamentConfigService {
  /**
   * Récupère une configuration par sa clé
   */
  static async getConfig(key: string): Promise<TournamentConfig | null> {
    return prisma.tournamentConfig.findUnique({ where: { key } });
  }

  /**
   * Récupère toutes les configurations
   */
  static async getAllConfigs(): Promise<TournamentConfig[]> {
    return prisma.tournamentConfig.findMany({
      orderBy: { key: "asc" },
    });
  }

  /**
   * Récupère une valeur de configuration typée
   */
  static async getConfigValue<T = unknown>(key: string): Promise<T | null> {
    const config = await prisma.tournamentConfig.findUnique({ where: { key } });
    return config ? (config.value as T) : null;
  }

  /**
   * Définit ou met à jour une configuration
   * Seuls les administrateurs peuvent modifier les configurations
   */
  static async setConfig(
    key: string,
    value: Prisma.InputJsonValue,
    description: string | null,
    adminId: string,
    isEditable: boolean = true,
  ): Promise<TournamentConfig> {
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { id: true, isAdmin: true },
    });
    if (!admin || !admin.isAdmin) {
      throw new TournamentConfigError(
        "Seul un administrateur peut modifier la configuration des tournois.",
        "UNAUTHORIZED",
      );
    }

    const existing = await prisma.tournamentConfig.findUnique({ where: { key } });
    if (existing && !existing.isEditable) {
      throw new TournamentConfigError(
        "Cette configuration n'est pas modifiable.",
        "NOT_EDITABLE",
      );
    }

    return prisma.tournamentConfig.upsert({
      where: { key },
      update: {
        value,
        description,
        isEditable,
        updatedById: adminId,
      },
      create: {
        key,
        value,
        description,
        isEditable,
        updatedById: adminId,
      },
    });
  }

  /**
   * Supprime une configuration (admin uniquement)
   */
  static async deleteConfig(key: string, adminId: string): Promise<void> {
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { id: true, isAdmin: true },
    });
    if (!admin || !admin.isAdmin) {
      throw new TournamentConfigError(
        "Seul un administrateur peut supprimer une configuration.",
        "UNAUTHORIZED",
      );
    }

    const config = await prisma.tournamentConfig.findUnique({ where: { key } });
    if (!config) {
      throw new TournamentConfigError("Configuration introuvable.", "NOT_FOUND");
    }
    if (!config.isEditable) {
      throw new TournamentConfigError(
        "Cette configuration n'est pas modifiable.",
        "NOT_EDITABLE",
      );
    }

    await prisma.tournamentConfig.delete({ where: { key } });
  }

  // ── Paramètres spécifiques prédéfinis ──

  static async getMinPointsForCommunityTournament(): Promise<number> {
    const val = await this.getConfigValue<number>(
      "community_tournament_min_points",
    );
    return val ?? 5000;
  }

  static async getMaxPlayersPerTournament(): Promise<{ min: number; max: number }> {
    const val = await this.getConfigValue<{ min: number; max: number }>(
      "tournament_max_players",
    );
    return val ?? { min: 4, max: 64 };
  }

  static async getInitialCapitalDefault(): Promise<number> {
    const val = await this.getConfigValue<number>("survival_bank_initial_capital");
    return val ?? 500;
  }

  static async getMinBetDefault(): Promise<number> {
    const val = await this.getConfigValue<number>("survival_bank_min_bet");
    return val ?? 10;
  }

  static async getMaxBetDefault(): Promise<number> {
    const val = await this.getConfigValue<number>("survival_bank_max_bet");
    return val ?? 100;
  }

  static async getRebuyEnabledDefault(): Promise<boolean> {
    const val = await this.getConfigValue<boolean>("survival_bank_rebuy_enabled");
    return val ?? false;
  }

  static async getRebuyCostDefault(): Promise<number> {
    const val = await this.getConfigValue<number>("survival_bank_rebuy_cost");
    return val ?? 0;
  }

  static async getPremiumScopeMax(premiumLevel: number): Promise<string> {
    const scopes = await this.getConfigValue<Record<number, string>>(
      "premium_scope_max",
    );
    return scopes?.[premiumLevel] || "CITY";
  }

  static async getAllowedTournamentTypes(): Promise<string[]> {
    const val = await this.getConfigValue<string[]>("allowed_tournament_types");
    return val ?? ["SURVIVAL_BANK", "ARENA", "SWISS", "ROUND_ROBIN", "ELIMINATION", "DOUBLE_ELIMINATION", "GROUPS_ELIMINATION", "LEAGUE"];
  }

  static async getPlatformFeePercentage(): Promise<number> {
    const val = await this.getConfigValue<number>("platform_fee_percentage");
    return val ?? 10;
  }

  static async getEntryFeeMinCfa(): Promise<number> {
    const val = await this.getConfigValue<number>("entry_fee_min_cfa");
    return val ?? 100;
  }

  static async initializeDefaultConfigs(adminId: string): Promise<void> {
    const defaults: Array<{
      key: string;
      value: Prisma.InputJsonValue;
      description: string;
      isEditable: boolean;
    }> = [
      {
        key: "community_tournament_min_points",
        value: 5000,
        description: "Seuil minimum de points requis pour créer un tournoi communautaire Survival Bank",
        isEditable: true,
      },
      {
        key: "tournament_max_players",
        value: { min: 4, max: 64 },
        description: "Nombre minimum et maximum de participants par tournoi",
        isEditable: true,
      },
      {
        key: "survival_bank_initial_capital",
        value: 500,
        description: "Capital initial par défaut pour les joueurs dans un tournoi Survival Bank",
        isEditable: true,
      },
      {
        key: "survival_bank_min_bet",
        value: 10,
        description: "Mise minimale par défaut par match dans un tournoi Survival Bank",
        isEditable: true,
      },
      {
        key: "survival_bank_max_bet",
        value: 100,
        description: "Mise maximale par défaut par match dans un tournoi Survival Bank",
        isEditable: true,
      },
      {
        key: "survival_bank_rebuy_enabled",
        value: false,
        description: "Autoriser le rebuy (rechargement de capital) après élimination",
        isEditable: true,
      },
      {
        key: "survival_bank_rebuy_cost",
        value: 0,
        description: "Coût du rebuy en points normaux",
        isEditable: true,
      },
      {
        key: "premium_scope_max",
        value: { 1: "NEIGHBORHOOD", 2: "CITY", 3: "COUNTRY", 4: "CONTINENT", 5: "INTERNATIONAL" },
        description: "Portée géographique maximale par niveau Premium",
        isEditable: true,
      },
      {
        key: "allowed_tournament_types",
        value: ["SURVIVAL_BANK", "ARENA", "SWISS", "ROUND_ROBIN", "ELIMINATION", "DOUBLE_ELIMINATION", "GROUPS_ELIMINATION", "LEAGUE"],
        description: "Types de tournois autorisés par l'administration",
        isEditable: true,
      },
      {
        key: "platform_fee_percentage",
        value: 10,
        description: "Pourcentage de commission de la plateforme sur les gains",
        isEditable: true,
      },
      {
        key: "entry_fee_min_cfa",
        value: 100,
        description: "Droit d'entrée minimum en FCFA pour un tournoi payant",
        isEditable: true,
      },
    ];

    const existingKeys = new Set(
      (await this.getAllConfigs()).map((config) => config.key),
    );
    for (const def of defaults) {
      if (!existingKeys.has(def.key)) {
        await this.setConfig(
          def.key,
          def.value,
          def.description,
          adminId,
          def.isEditable,
        );
      }
    }
  }
}
