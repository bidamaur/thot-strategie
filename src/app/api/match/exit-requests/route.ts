import { exitRoute, readBody } from "@/lib/game-exit/http";
import { createExitRequest } from "@/lib/game-exit/service";

/** { targetId, returnPath } : demander à un joueur de quitter sa partie en cours. */
export async function POST(request: Request) {
  return exitRoute(request, async (user) => {
    const body = await readBody(request);
    return createExitRequest(user.id, typeof body.targetId === "string" ? body.targetId : "", body.returnPath);
  });
}
