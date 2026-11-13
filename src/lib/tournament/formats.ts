import {
  Prisma,
  TournamentMatchStage,
  TournamentMatchStatus,
  TournamentParticipantStatus,
  TournamentStatus,
} from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";

export class TournamentFormatError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "INVALID_STATE" | "NOT_ENOUGH_PLAYERS" | "FORMAT_NOT_SUPPORTED",
  ) {
    super(message);
    this.name = "TournamentFormatError";
  }
}

export abstract class TournamentFormatEngine {
  protected tournamentId: string;

  constructor(tournamentId: string) {
    this.tournamentId = tournamentId;
  }

  abstract initialize(): Promise<void>;
  abstract generateNextRound(): Promise<void>;
  abstract isTournamentComplete(): Promise<boolean>;
  abstract finalize(): Promise<void>;
  abstract getStandings(): Promise<any[]>;

  protected async getActiveParticipants() {
    return prisma.tournamentParticipant.findMany({
      where: {
        tournamentId: this.tournamentId,
        status: TournamentParticipantStatus.ACTIVE,
      },
      include: { user: { select: { elo: true, username: true } } },
      orderBy: { seed: "asc" },
    });
  }

  protected async getAllParticipants() {
    return prisma.tournamentParticipant.findMany({
      where: { tournamentId: this.tournamentId },
      include: { user: { select: { elo: true, username: true } } },
      orderBy: { placement: "asc", seed: "asc" },
    });
  }
}

/**
 * Tournoi à élimination directe (bracket)
 * Les gagnants avancent, les perdants sont éliminés
 */
export class EliminationFormatEngine extends TournamentFormatEngine {
  async initialize(): Promise<void> {
    const participants = await this.getActiveParticipants();
    const count = participants.length;

    // Vérifier que c'est une puissance de 2
    if (count < 2 || (count & (count - 1)) !== 0) {
      throw new TournamentFormatError(
        "L'élimination directe nécessite un nombre de joueurs puissance de 2 (4, 8, 16, 32, 64).",
        "NOT_ENOUGH_PLAYERS",
      );
    }

    const rounds = Math.log2(count);
    let matchNumber = 1;

    // Créer le premier round
    for (let r = 1; r <= rounds; r++) {
      const matchesInRound = count / Math.pow(2, r);
      await prisma.tournamentRound.create({
        data: {
          tournamentId: this.tournamentId,
          roundNumber: r,
          stage: TournamentMatchStage.MAIN,
          status: r === 1 ? "WAITING" : "WAITING",
        },
      });

      for (let m = 0; m < matchesInRound; m++) {
        // Pour le premier round, appariement par seed
        // Pour les rounds suivants, les places sont laissées vides et remplies après
        await prisma.tournamentMatch.create({
          data: {
            tournamentId: this.tournamentId,
            roundId: undefined, // Sera lié après création du round
            stage: TournamentMatchStage.MAIN,
            round: r,
            matchNumber: m + 1,
            status: TournamentMatchStatus.WAITING,
            playerWhiteId: r === 1 ? participants[m]?.userId : null,
            playerBlackId: r === 1 ? participants[count - 1 - m]?.userId : null,
          },
        });
        matchNumber++;
      }
    }
  }

  async generateNextRound(): Promise<void> {
    // Dans l'élimination directe, les rounds suivants sont créés après chaque match
    // Cette méthode est appelée quand un round est complété
  }

  async isTournamentComplete(): Promise<boolean> {
    const finalMatches = await prisma.tournamentMatch.findMany({
      where: {
        tournamentId: this.tournamentId,
        stage: TournamentMatchStage.MAIN,
        status: TournamentMatchStatus.FINISHED,
      },
      orderBy: [{ round: "desc" }, { matchNumber: "asc" }],
    });

    if (finalMatches.length === 0) return false;

    // Vérifier si la finale est jouée
    const maxRound = Math.max(...finalMatches.map((m) => m.round));
    const finalMatch = finalMatches.find((m) => m.round === maxRound && m.matchNumber === 1);
    return !!finalMatch;
  }

  async finalize(): Promise<void> {
    // Attribuer les places
    const participants = await this.getAllParticipants();
    // La logique d'attribution des places est déjà dans recordValidatedTournamentResult
    // qui gère le bracket existant
  }

  async getStandings(): Promise<any[]> {
    const participants = await this.getAllParticipants();
    return participants.map((p) => ({
      userId: p.userId,
      username: p.user.username,
      elo: p.user.elo,
      placement: p.placement,
      status: p.status,
      seed: p.seed,
    }));
  }
}

/**
 * Tournoi Swiss
 * Nombre de rondes déterminé, appariement par score
 */
export class SwissFormatEngine extends TournamentFormatEngine {
  private rounds: number;

  constructor(tournamentId: string, rounds: number = 4) {
    super(tournamentId);
    this.rounds = rounds;
  }

  async initialize(): Promise<void> {
    const participants = await this.getActiveParticipants();
    if (participants.length < 2) {
      throw new TournamentFormatError(
        "Au moins 2 joueurs requis pour un tournoi Swiss.",
        "NOT_ENOUGH_PLAYERS",
      );
    }

    // Créer le premier round avec appariement aléatoire ou par Elo
    await this.createSwissRound(1, participants);
  }

  private async createSwissRound(roundNumber: number, participants: any[]) {
    await prisma.tournamentRound.create({
      data: {
        tournamentId: this.tournamentId,
        roundNumber,
        stage: TournamentMatchStage.MAIN,
        status: "WAITING",
      },
    });

    // Appariement : trier par score (victoires), puis appariement adjacent
    const sorted = [...participants].sort((a, b) => {
      const scoreA = (a as any).matchesWon || 0;
      const scoreB = (b as any).matchesWon || 0;
      return scoreB - scoreA;
    });

    for (let i = 0; i < sorted.length / 2; i++) {
      const white = sorted[i];
      const black = sorted[sorted.length - 1 - i];

      await prisma.tournamentMatch.create({
        data: {
          tournamentId: this.tournamentId,
          stage: TournamentMatchStage.MAIN,
          round: roundNumber,
          matchNumber: i + 1,
          playerWhiteId: white.userId,
          playerBlackId: black.userId,
          status: TournamentMatchStatus.WAITING,
        },
      });
    }
  }

  async generateNextRound(): Promise<void> {
    // Déterminer le round suivant
    const lastRound = await prisma.tournamentRound.findFirst({
      where: { tournamentId: this.tournamentId },
      orderBy: { roundNumber: "desc" },
    });

    if (!lastRound || lastRound.status !== "COMPLETED") {
      throw new TournamentFormatError("Le round précédent n'est pas terminé.", "INVALID_STATE");
    }

    const nextRound = (lastRound.roundNumber as number) + 1;
    if (nextRound > this.rounds) {
      return; // Tournoi terminé
    }

    const participants = await this.getActiveParticipants();
    await this.createSwissRound(nextRound, participants);
  }

  async isTournamentComplete(): Promise<boolean> {
    const lastRound = await prisma.tournamentRound.findFirst({
      where: { tournamentId: this.tournamentId },
      orderBy: { roundNumber: "desc" },
    });

    if (!lastRound) return false;
    if (lastRound.roundNumber < this.rounds) return false;

    // Vérifier si tous les matchs du dernier round sont terminés
    const unfinished = await prisma.tournamentMatch.count({
      where: {
        tournamentId: this.tournamentId,
        round: lastRound.roundNumber,
        status: { not: TournamentMatchStatus.FINISHED },
      },
    });

    return unfinished === 0;
  }

  async finalize(): Promise<void> {
    // Marquer le tournoi comme terminé
    await prisma.tournament.update({
      where: { id: this.tournamentId },
      data: { status: TournamentStatus.COMPLETED },
    });
  }

  async getStandings(): Promise<any[]> {
    const participants = await this.getAllParticipants();
    return participants.map((p) => ({
      userId: p.userId,
      username: p.user.username,
      elo: p.user.elo,
      placement: p.placement,
      status: p.status,
      matchesPlayed: 0, // Sera calculé depuis les matchs
      matchesWon: 0,
    }));
  }
}

/**
 * Tournoi Round Robin
 * Chaque participant rencontre tous les autres
 */
export class RoundRobinFormatEngine extends TournamentFormatEngine {
  async initialize(): Promise<void> {
    const participants = await this.getActiveParticipants();
    const count = participants.length;

    if (count < 2) {
      throw new TournamentFormatError(
        "Au moins 2 joueurs requis pour un Round Robin.",
        "NOT_ENOUGH_PLAYERS",
      );
    }

    const rounds = count % 2 === 0 ? count - 1 : count;
    let matchNumber = 1;

    // Algorithme de cercle pour Round Robin
    const players = [...participants];
    if (count % 2 !== 0) {
      players.push({ userId: "bye", user: { username: "Bye", elo: 0 } } as any);
    }

    for (let r = 1; r <= rounds; r++) {
      await prisma.tournamentRound.create({
        data: {
          tournamentId: this.tournamentId,
          roundNumber: r,
          stage: TournamentMatchStage.MAIN,
          status: r === 1 ? "WAITING" : "WAITING",
        },
      });

      const half = players.length / 2;
      for (let m = 0; m < half; m++) {
        const white = players[m];
        const black = players[players.length - 1 - m];

        if (white.userId === "bye" || black.userId === "bye") {
          // Un joueur a un bye (repos), pas de match créé
          continue;
        }

        await prisma.tournamentMatch.create({
          data: {
            tournamentId: this.tournamentId,
            stage: TournamentMatchStage.MAIN,
            round: r,
            matchNumber: matchNumber,
            playerWhiteId: white.userId,
            playerBlackId: black.userId,
            status: TournamentMatchStatus.WAITING,
          },
        });
        matchNumber++;
      }

      // Rotation pour le round suivant (sauf le premier joueur qui reste fixe)
      players.splice(1, 0, players.pop()!);
    }
  }

  async generateNextRound(): Promise<void> {
    // Dans Round Robin, tous les rounds sont créés à l'initialisation
    // Cette méthode vérifie si le round actuel est terminé et passe au suivant
  }

  async isTournamentComplete(): Promise<boolean> {
    const unfinished = await prisma.tournamentMatch.count({
      where: {
        tournamentId: this.tournamentId,
        status: { not: TournamentMatchStatus.FINISHED },
      },
    });
    return unfinished === 0;
  }

  async finalize(): Promise<void> {
    await prisma.tournament.update({
      where: { id: this.tournamentId },
      data: { status: TournamentStatus.COMPLETED },
    });
  }

  async getStandings(): Promise<any[]> {
    const participants = await this.getAllParticipants();
    return participants.map((p) => ({
      userId: p.userId,
      username: p.user.username,
      elo: p.user.elo,
      placement: p.placement,
      status: p.status,
    }));
  }
}

/**
 * Factory pour créer le moteur de format approprié
 */
export function createFormatEngine(
  tournamentType: string,
  tournamentId: string,
  options?: { rounds?: number },
): TournamentFormatEngine {
  switch (tournamentType) {
    case "ELIMINATION":
      return new EliminationFormatEngine(tournamentId);
    case "SWISS":
      return new SwissFormatEngine(tournamentId, options?.rounds);
    case "ROUND_ROBIN":
      return new RoundRobinFormatEngine(tournamentId);
    case "SURVIVAL_BANK":
      // Survival Bank utilise le matchmaking continu, pas de rounds fixes
      return new EliminationFormatEngine(tournamentId); // Placeholder
    case "DOUBLE_ELIMINATION":
      return new EliminationFormatEngine(tournamentId); // Placeholder
    case "GROUPS_ELIMINATION":
      return new EliminationFormatEngine(tournamentId); // Placeholder
    case "LEAGUE":
      return new RoundRobinFormatEngine(tournamentId); // Placeholder
    default:
      throw new TournamentFormatError(
        `Format de tournoi non supporté: ${tournamentType}`,
        "FORMAT_NOT_SUPPORTED",
      );
  }
}
