import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/session";
import { deleteByUrl, putObject, storageConfig, StorageError } from "@/lib/storage";

/** Vérifie la configuration du stockage : envoi d'une petite image, relecture par son adresse publique, suppression. */
export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user?.isAdmin) return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  const config = await storageConfig();
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#86c7a8" } }).webp({ quality: 50 }).toBuffer();
  let url: string | null = null;
  try {
    url = await putObject(`system/test_${randomBytes(6).toString("hex")}.webp`, image, "image/webp");
    const absolute = url.startsWith("http") ? url : new URL(url, request.url).toString();
    const check = await fetch(absolute, { cache: "no-store" }).catch(() => null);
    const readable = !!check?.ok;
    return NextResponse.json({
      ok: true,
      driver: config.driver,
      url,
      readable,
      message: readable
        ? "Stockage opérationnel : image enregistrée puis relue à son adresse publique."
        : "Image enregistrée, mais son adresse publique ne répond pas : vérifiez l’adresse publique ou les droits de lecture du compartiment.",
    });
  } catch (error) {
    const message = error instanceof StorageError ? error.message : "Erreur inattendue pendant le test.";
    return NextResponse.json({ ok: false, driver: config.driver, message }, { status: 502 });
  } finally {
    if (url) await deleteByUrl(url);
  }
}
