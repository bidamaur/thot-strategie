import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Téléversement d'images sûr : le type est déterminé par la signature binaire du
 * fichier (jamais par son nom ni par le type annoncé par le navigateur), et
 * l'extension enregistrée découle de ce type. Un fichier `.html` déguisé en
 * image est donc refusé au lieu d'être servi tel quel depuis /public.
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

/**
 * Enregistre une image dans public/<folder>/ et renvoie son URL publique.
 * Le nom est `<prefix>_<aléatoire>.<ext>` : le préfixe (id du joueur) permet de vérifier la propriété.
 */
export async function saveImage(file: File, options: { folder: string; prefix: string; maxBytes: number }): Promise<string> {
  if (file.size === 0) throw new UploadError("Aucune image fournie.");
  if (file.size > options.maxBytes) {
    throw new UploadError(`L’image ne doit pas dépasser ${Math.round(options.maxBytes / 1024)} Ko.`);
  }
  if (!/^[a-z0-9/-]+$/.test(options.folder) || !/^[a-z0-9]+$/i.test(options.prefix)) {
    throw new UploadError("Destination invalide.");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = detectImageType(buffer);
  if (!ext) throw new UploadError("Format d’image non supporté (PNG, JPEG, WEBP, GIF).");
  const dir = path.join(process.cwd(), "public", ...options.folder.split("/"));
  await mkdir(dir, { recursive: true });
  const name = `${options.prefix}_${randomBytes(9).toString("hex")}.${ext}`;
  await writeFile(path.join(dir, name), buffer);
  return `/${options.folder}/${name}`;
}
