import { exitRoute, readBody } from "@/lib/game-exit/http";
import { forfeitActiveGames, GameExitError, listActiveGames, listReceivedRequests } from "@/lib/game-exit/service";

/** Mes parties en cours (et la conséquence d'un abandon) + demandes de sortie reçues. */
export async function GET(request: Request) {
  return exitRoute(request, async (user) => ({
    games: await listActiveGames(user.id),
    requests: await listReceivedRequests(user.id),
  }));
}

/** { confirm: true } : quitter toutes mes parties en cours (abandon). */
export async function POST(request: Request) {
  return exitRoute(request, async (user) => {
    const body = await readBody(request);
    if (body.confirm !== true) throw new GameExitError("Confirmation requise.", 400);
    return forfeitActiveGames(user.id);
  });
}
