import { clearAvailability, getMyAvailability, saveAvailability } from "@/lib/availability/service";
import { apiRoute, readJson } from "@/lib/monetization/http";

export async function GET(request: Request) {
  return apiRoute(request, async (user) => ({ availability: await getMyAvailability(user!.id) }));
}

export async function PUT(request: Request) {
  return apiRoute(request, async (user) => {
    const body = await readJson(request);
    const override =
      body.override && typeof body.override === "object" ? (body.override as { from?: unknown; to?: unknown; weekly?: unknown }) : null;
    return { availability: await saveAvailability(user!.id, { timeZone: body.timeZone, weekly: body.weekly, override }) };
  });
}

export async function DELETE(request: Request) {
  return apiRoute(request, async (user) => {
    await clearAvailability(user!.id);
    return { ok: true };
  });
}
