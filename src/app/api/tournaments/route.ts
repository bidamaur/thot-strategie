import {
  Prisma,
  TournamentScope,
  TournamentType,
} from "@/generated/prisma-client";
import {
  createTournament,
  TournamentEconomyError,
} from "@/lib/economy/tournaments";
import {
  isMockEconomyEnabled,
  mockEconomyDisabledResponse,
} from "@/lib/economy/mock-mode";
import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { TournamentEligibilityEngine } from "@/lib/tournament/eligibility";
import { NextResponse } from "next/server";

const SCOPES = new Set<TournamentScope>(Object.values(TournamentScope));
const TYPES = new Set<TournamentType>(Object.values(TournamentType));

export async function GET(request: Request) {
  try {
    const currentUser = await getRequestUser(request);
    let tournaments;
    try {
      // Visibilité : public pour tous ; privé pour le créateur, les invités et
      // les inscrits ; club pour ses membres.
      const memberClubIds = currentUser
        ? (
            await prisma.clubMember.findMany({
              where: { userId: currentUser.id },
              select: { clubId: true },
            })
          ).map((m) => m.clubId)
        : [];
      tournaments = await prisma.tournament.findMany({
        where: currentUser?.isAdmin
          ? undefined
          : {
              OR: [
                { visibility: "PUBLIC" },
                ...(currentUser
                  ? [
                      { creatorId: currentUser.id },
                      { invitations: { some: { userId: currentUser.id } } },
                      { participants: { some: { userId: currentUser.id } } },
                      { visibility: "CLUB" as const, clubId: { in: memberClubIds } },
                    ]
                  : []),
              ],
            },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          club: { select: { id: true, name: true, slug: true } },
          creator: { select: { id: true, username: true } },
          _count: { select: { participants: true } },
          invitations: currentUser
            ? {
                where: { userId: currentUser.id },
                select: { id: true, userId: true, status: true },
              }
            : false,
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
          invitations: currentUser
            ? {
                where: { userId: currentUser.id },
                select: { id: true, userId: true, status: true },
              }
            : false,
        },
      });
    }

    const registrations = currentUser
      ? await prisma.tournamentParticipant.findMany({
          where: { userId: currentUser.id },
          select: { tournamentId: true },
        })
      : [];
    const registeredTournamentIds = new Set(
      registrations.map((registration) => registration.tournamentId),
    );
    return NextResponse.json({
      tournaments: tournaments.map((tournament) => {
        const hasDetails = "name" in tournament;
        const details = tournament as typeof tournament & {
          city?: string | null;
          region?: string | null;
          country?: string | null;
          continent?: string | null;
        };
        return {
          ...tournament,
          name: hasDetails
            ? tournament.name
            : `Tournoi de ${tournament.creator.username}`,
          city: hasDetails ? details.city ?? null : null,
          region: hasDetails ? details.region ?? null : null,
          country: hasDetails ? details.country ?? null : null,
          continent: hasDetails ? details.continent ?? null : null,
          type: "type" in tournament ? tournament.type : "ELIMINATION",
          gameType: "gameType" in tournament ? tournament.gameType : "CHECKERS",
          draughtsVariant:
            "draughtsVariant" in tournament
              ? tournament.draughtsVariant
              : "INTERNATIONAL",
          minElo: "minElo" in tournament ? tournament.minElo : null,
          maxElo: "maxElo" in tournament ? tournament.maxElo : null,
          minPoints: "minPoints" in tournament ? tournament.minPoints : null,
          maxPoints: "maxPoints" in tournament ? tournament.maxPoints : null,
          minBet: "minBet" in tournament ? tournament.minBet : null,
          maxBet: "maxBet" in tournament ? tournament.maxBet : null,
          survivalBankEnabled:
            "survivalBankEnabled" in tournament
              ? tournament.survivalBankEnabled
              : false,
          isParticipant: registeredTournamentIds.has(tournament.id),
          invitations: Array.isArray(tournament.invitations)
            ? tournament.invitations
            : [],
          entryFee: tournament.entryFee.toString(),
          totalPrizePool: tournament.totalPrizePool.toString(),
          platformFee: tournament.platformFee.toString(),
        };
      }),
    });
  } catch (error) {
    console.error("Erreur lors de la lecture des tournois :", error);
    return NextResponse.json(
      { error: "Impossible de charger les tournois." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json(
      { error: "Connectez-vous pour créer un tournoi." },
      { status: 401 },
    );
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
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Données de tournoi invalides." },
      { status: 400 },
    );
  }

  const fields = body as Record<string, unknown>;
  const {
    name,
    type,
    scope,
    isPaid,
    entryFeeCfa,
    entryPoints,
    maxPlayers,
    gameType,
    draughtsVariant,
    timeControlMinutes,
    minElo,
    maxElo,
    minPoints,
    maxPoints,
    initialCapital,
    minBet,
    maxBet,
    betMode,
    rebuyEnabled,
    city,
    region,
    country,
    continent,
    visibility,
    clubId,
    description,
    durationDays,
    durationMinutes,
  } = fields;
  if (durationMinutes !== undefined && (typeof durationMinutes !== "number" || !Number.isInteger(durationMinutes))) {
    return NextResponse.json({ error: "Durée invalide." }, { status: 400 });
  }
  if (durationDays !== undefined && (typeof durationDays !== "number" || !Number.isInteger(durationDays))) {
    return NextResponse.json({ error: "Durée invalide." }, { status: 400 });
  }
  const resolvedVisibility =
    visibility === "PRIVATE" || visibility === "CLUB" ? visibility : "PUBLIC";
  const resolvedClubId = typeof clubId === "string" && clubId ? clubId : null;
  const resolvedDescription =
    typeof description === "string" && description.trim() ? description.trim().slice(0, 1000) : null;
  // Les tournois payants passent par un paiement simulé tant qu'aucun
  // prestataire de paiement réel n'est branché.
  if (isPaid === true && !isMockEconomyEnabled()) return mockEconomyDisabledResponse();

  const resolvedName =
    typeof name === "string" && name.trim()
      ? name.trim()
      : `Tournoi de ${currentUser.username}`;
  const resolvedType = type ?? "SURVIVAL_BANK";
  const resolvedScope = scope ?? "CITY";
  const resolvedIsPaid = isPaid ?? false;
  const resolvedEntryPoints = entryPoints ?? 1;
  const resolvedMaxPlayers = maxPlayers ?? 4;
  const resolvedGameType = gameType ?? "CHECKERS";
  const resolvedDraughtsVariant = draughtsVariant ?? "INTERNATIONAL";
  const resolvedBetMode = betMode ?? "FIXED";
  const inviteUserIds = fields.inviteUserIds;
  const optionalIntegerFields = [
    timeControlMinutes,
    minElo,
    maxElo,
    minPoints,
    maxPoints,
    initialCapital,
    minBet,
    maxBet,
  ];

  if (
    resolvedName.length > 100 ||
    typeof resolvedType !== "string" ||
    !TYPES.has(resolvedType as TournamentType) ||
    typeof resolvedScope !== "string" ||
    !SCOPES.has(resolvedScope as TournamentScope) ||
    typeof resolvedIsPaid !== "boolean" ||
    typeof resolvedEntryPoints !== "number" ||
    !Number.isSafeInteger(resolvedEntryPoints) ||
    (resolvedIsPaid ? resolvedEntryPoints !== 0 : resolvedEntryPoints < 1) ||
    (resolvedIsPaid &&
      (typeof entryFeeCfa !== "number" ||
        !Number.isSafeInteger(entryFeeCfa) ||
        entryFeeCfa < 100)) ||
    (!resolvedIsPaid && entryFeeCfa !== undefined && entryFeeCfa !== 0) ||
    typeof resolvedMaxPlayers !== "number" ||
    !Number.isInteger(resolvedMaxPlayers) ||
    typeof resolvedGameType !== "string" ||
    !["CHESS", "CHECKERS"].includes(resolvedGameType) ||
    typeof resolvedDraughtsVariant !== "string" ||
    !["ENGLISH", "INTERNATIONAL"].includes(resolvedDraughtsVariant) ||
    typeof resolvedBetMode !== "string" ||
    !["FIXED", "VARIABLE"].includes(resolvedBetMode) ||
    optionalIntegerFields.some(
      (value) =>
        value !== undefined &&
        value !== null &&
        (typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value < 0),
    ) ||
    (minElo != null && maxElo != null && (minElo as number) > (maxElo as number)) ||
    (minPoints != null &&
        maxPoints != null &&
        (minPoints as number) > (maxPoints as number)) ||
    (minBet != null &&
        maxBet != null &&
        (minBet as number) > (maxBet as number)) ||
    [city, region, country, continent].some(
      (value) =>
        value !== undefined &&
        value !== null &&
        (typeof value !== "string" || value.trim().length > 80),
    ) ||
    (inviteUserIds !== undefined &&
      (!Array.isArray(inviteUserIds) ||
        !inviteUserIds.every((userId) => typeof userId === "string")))
  ) {
    return NextResponse.json(
      {
        error:
          "Vérifiez le type, la portée, le nombre de joueurs, le droit d’entrée et les conditions du tournoi.",
      },
      { status: 400 },
    );
  }

  const entryFee = typeof entryFeeCfa === "number" ? entryFeeCfa : 0;
  const requiredPoints = resolvedEntryPoints as number;
  const playerCount = resolvedMaxPlayers as number;
  const tournamentType = resolvedType as TournamentType;
  const tournamentScope = resolvedScope as TournamentScope;
  const game = resolvedGameType as "CHESS" | "CHECKERS";
  const variant = resolvedDraughtsVariant as "ENGLISH" | "INTERNATIONAL";
  const paid = resolvedIsPaid;
  const optionalNumber = (value: unknown) =>
    typeof value === "number" ? value : undefined;
  const optionalLocation = (value: unknown) =>
    typeof value === "string" ? value.trim() || null : null;

  try {
    await TournamentEligibilityEngine.validateCreateTournament({
      userId: currentUser.id,
      type: tournamentType,
      scope: tournamentScope,
      city: optionalLocation(city),
      region: optionalLocation(region),
      country: optionalLocation(country),
      continent: optionalLocation(continent),
      isPaid: paid,
      entryFeeCfa: entryFee,
      entryPoints: requiredPoints,
      maxPlayers: playerCount,
      gameType: game,
      draughtsVariant: variant,
      timeControlMinutes: optionalNumber(timeControlMinutes),
      minElo: optionalNumber(minElo),
      maxElo: optionalNumber(maxElo),
      minPoints: optionalNumber(minPoints),
      maxPoints: optionalNumber(maxPoints),
      initialCapital: optionalNumber(initialCapital),
      minBet: optionalNumber(minBet),
      maxBet: optionalNumber(maxBet),
      betMode: resolvedBetMode as "FIXED" | "VARIABLE",
      survivalBankEnabled: tournamentType === "SURVIVAL_BANK",
      rebuyEnabled: typeof rebuyEnabled === "boolean" ? rebuyEnabled : false,
      invitedUserIds: inviteUserIds as string[] | undefined,
      visibility: resolvedVisibility,
      clubId: resolvedClubId,
    });

    const tournament = await createTournament({
      creatorId: currentUser.id,
      name: resolvedName,
      type: tournamentType,
      scope: tournamentScope,
      gameType: game,
      draughtsVariant: variant,
      city: optionalLocation(city),
      region: optionalLocation(region),
      country: optionalLocation(country),
      continent: optionalLocation(continent),
      isPaid: paid,
      entryFeeCfa: entryFee,
      entryPoints: requiredPoints,
      maxPlayers: playerCount,
      timeControlMinutes: optionalNumber(timeControlMinutes),
      minElo: optionalNumber(minElo),
      maxElo: optionalNumber(maxElo),
      minPoints: optionalNumber(minPoints),
      maxPoints: optionalNumber(maxPoints),
      initialCapital: optionalNumber(initialCapital),
      minBet: optionalNumber(minBet),
      maxBet: optionalNumber(maxBet),
      betMode: resolvedBetMode as "FIXED" | "VARIABLE",
      rebuyEnabled: typeof rebuyEnabled === "boolean" ? rebuyEnabled : false,
      invitedUserIds: inviteUserIds as string[] | undefined,
      visibility: resolvedVisibility,
      clubId: resolvedClubId,
      description: resolvedDescription,
      durationDays: typeof durationDays === "number" ? durationDays : undefined,
      durationMinutes: typeof durationMinutes === "number" ? durationMinutes : undefined,
    });

    return NextResponse.json(
      {
        tournament: {
          ...tournament,
          entryFee: tournament.entryFee.toString(),
          totalPrizePool: tournament.totalPrizePool.toString(),
          platformFee: tournament.platformFee.toString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof TournamentEconomyError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "PREMIUM_REQUIRED"
            ? 403
            : error.code === "INSUFFICIENT_FUNDS"
              ? 402
              : error.code === "NOT_OPEN" ||
                  error.code === "ALREADY_JOINED" ||
                  error.code === "FULL"
                ? 409
                : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    if (error instanceof Error && error.name === "TournamentEligibilityError") {
      const code = (error as Error & { code?: string }).code;
      return NextResponse.json(
        { error: error.message, code },
        { status: code === "PREMIUM_REQUIRED" ? 403 : 400 },
      );
    }
    console.error("Erreur lors de la création du tournoi :", error);
    return NextResponse.json(
      { error: "Impossible de créer le tournoi." },
      { status: 500 },
    );
  }
}
