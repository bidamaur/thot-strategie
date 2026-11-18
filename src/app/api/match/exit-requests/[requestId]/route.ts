import { exitRoute, readBody } from "@/lib/game-exit/http";
import { cancelExitRequest, GameExitError, getSentRequest, respondExitRequest } from "@/lib/game-exit/service";

interface Ctx {
  params: Promise<{ requestId: string }>;
}

/** Suivi d'une demande envoyée. */
export async function GET(request: Request, { params }: Ctx) {
  const { requestId } = await params;
  return exitRoute(request, (user) => getSentRequest(user.id, requestId));
}

/** { action: accept | decline } (joueur sollicité) ou { action: cancel } (demandeur). */
export async function POST(request: Request, { params }: Ctx) {
  const { requestId } = await params;
  return exitRoute(request, async (user) => {
    const body = await readBody(request);
    if (body.action === "cancel") {
      await cancelExitRequest(user.id, requestId);
      return { status: "CANCELLED" };
    }
    if (body.action !== "accept" && body.action !== "decline") throw new GameExitError("Action inconnue.", 400);
    return respondExitRequest(user.id, requestId, body.action === "accept");
  });
}
