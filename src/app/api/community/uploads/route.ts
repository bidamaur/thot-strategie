import { CommunityError, requireActor } from "@/lib/community/core";
import { communityRoute } from "@/lib/community/http";
import { getSettings } from "@/lib/settings/service";
import { saveImage } from "@/lib/uploads";

/** Téléverse une image de publication (vérifiée par signature binaire). */
export async function POST(request: Request) {
  return communityRoute(request, async (user) => {
    await requireActor(user!.id);
    const settings = await getSettings(["community.imagesEnabled", "community.imageMaxKb"] as const);
    if (!settings["community.imagesEnabled"]) throw new CommunityError("Les images sont désactivées.", 403);
    const form = await request.formData().catch(() => null);
    const file = form?.get("image");
    if (!(file instanceof File)) throw new CommunityError("Aucune image fournie.", 400);
    const url = await saveImage(file, { folder: "uploads/community", prefix: user!.id, maxBytes: settings["community.imageMaxKb"] * 1024 });
    return { url };
  });
}
