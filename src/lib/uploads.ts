import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { getSettings } from "@/lib/settings/service";
import { putObject, type StorageFolder } from "@/lib/storage";

/**
 * Téléversement d'images : contrôle du vrai type (signature binaire), puis
 * compression maximale avant sauvegarde :
 *  - conversion en WebP (qualité réglable, effort de compression maximal) ;
 *  - redimensionnement à la taille utile (publication, avatar, logo) ;
 *  - suppression des métadonnées (EXIF, position GPS…) et orientation corrigée ;
 *  - une GIF animée devient une image fixe (première image).
 * Le fichier enregistré est donc toujours une image propre produite par le serveur :
 * aucun contenu fourni par l'utilisateur n'est servi tel quel.
 */

const SIGNATURES: { ext: "png" | "jpg" | "gif" | "webp"; test: (b: Buffer) => boolean }[] = [
  { ext: "png", test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", test: (b) => b.length > 6 && (b.subarray(0, 6).toString("ascii") === "GIF87a" || b.subarray(0, 6).toString("ascii") === "GIF89a") },
  { ext: "webp", test: (b) => b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

export function detectImageType(buffer: Buffer): "png" | "jpg" | "gif" | "webp" | null {
  return SIGNATURES.find((s) => s.test(buffer))?.ext ?? null;
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export type ImageKind = "post" | "avatar" | "logo";

const FOLDER: Record<ImageKind, StorageFolder> = { post: "community", avatar: "avatars", logo: "clubs" };

/** Compresse une image ; renvoie le WebP le plus léger possible à la qualité demandée. */
export async function compressImage(input: Buffer, options: { maxDimension: number; quality: number; square?: boolean }): Promise<{ buffer: Buffer; width: number; height: number }> {
  let pipeline = sharp(input, { animated: false, limitInputPixels: 50_000_000, failOn: "error" }).rotate();
  pipeline = options.square
    ? pipeline.resize(options.maxDimension, options.maxDimension, { fit: "cover", position: "attention", withoutEnlargement: true })
    : pipeline.resize(options.maxDimension, options.maxDimension, { fit: "inside", withoutEnlargement: true });
  try {
    const { data, info } = await pipeline
      .webp({ quality: options.quality, effort: 6, smartSubsample: true, alphaQuality: Math.min(100, options.quality + 10) })
      .toBuffer({ resolveWithObject: true });
    // Pour les images déjà très petites, la version sans perte est parfois plus légère.
    if (data.length > 4096) return { buffer: data, width: info.width, height: info.height };
    const lossless = await sharp(data).webp({ lossless: true, effort: 6 }).toBuffer();
    return { buffer: lossless.length < data.length ? lossless : data, width: info.width, height: info.height };
  } catch {
    throw new UploadError("Image illisible ou endommagée.");
  }
}

/**
 * Contrôle, compresse et enregistre une image ; renvoie son adresse publique.
 * Le nom est `<prefix>_<aléatoire>.webp` : le préfixe (id du joueur ou du club) permet de vérifier la propriété.
 */
export async function saveImage(file: File, options: { kind: ImageKind; prefix: string; maxBytes: number }): Promise<string> {
  if (file.size === 0) throw new UploadError("Aucune image fournie.");
  if (file.size > options.maxBytes) {
    throw new UploadError(`L’image ne doit pas dépasser ${Math.round(options.maxBytes / 1024)} Ko.`);
  }
  if (!/^[a-z0-9]+$/i.test(options.prefix)) throw new UploadError("Destination invalide.");
  const raw = Buffer.from(await file.arrayBuffer());
  if (!detectImageType(raw)) throw new UploadError("Format d’image non supporté (PNG, JPEG, WEBP, GIF).");

  const s = await getSettings(["images.quality", "images.maxPostDimension", "images.maxAvatarDimension", "images.maxLogoDimension"] as const);
  const maxDimension =
    options.kind === "avatar" ? s["images.maxAvatarDimension"] : options.kind === "logo" ? s["images.maxLogoDimension"] : s["images.maxPostDimension"];
  const { buffer } = await compressImage(raw, { maxDimension, quality: s["images.quality"], square: options.kind !== "post" });
  const key = `${FOLDER[options.kind]}/${options.prefix}_${randomBytes(9).toString("hex")}.webp`;
  return putObject(key, buffer, "image/webp");
}
