import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compressImage, detectImageType, UploadError } from "@/lib/uploads";

/**
 * Captures d'écran des SMS de paiement : données personnelles et financières.
 * Elles ne passent PAS par le stockage public (/media, S3 public) : elles sont
 * gardées dans un dossier privé du serveur et servies uniquement aux
 * administrateurs par une route protégée.
 */

const PROOF_DIR = path.join(process.cwd(), "storage", "private", "payment-proofs");
const NAME = /^[a-z0-9]{6,40}_[a-f0-9]{18}\.webp$/;
const MAX_BYTES = 6 * 1024 * 1024;

export async function saveProof(file: File, userId: string): Promise<string> {
  if (file.size === 0) throw new UploadError("Capture vide.");
  if (file.size > MAX_BYTES) throw new UploadError("La capture ne doit pas dépasser 6 Mo.");
  if (!/^[a-z0-9]+$/i.test(userId)) throw new UploadError("Destination invalide.");
  const raw = Buffer.from(await file.arrayBuffer());
  if (!detectImageType(raw)) throw new UploadError("Format d’image non supporté (PNG, JPEG, WEBP).");
  // Recompression : supprime les métadonnées (EXIF, position) et réduit le poids.
  const { buffer } = await compressImage(raw, { maxDimension: 1600, quality: 80 });
  const name = `${userId.toLowerCase()}_${randomBytes(9).toString("hex")}.webp`;
  await mkdir(PROOF_DIR, { recursive: true });
  await writeFile(path.join(PROOF_DIR, name), buffer);
  return name;
}

export async function readProof(name: string): Promise<Buffer | null> {
  if (!NAME.test(name)) return null;
  try {
    return await readFile(path.join(PROOF_DIR, name));
  } catch {
    return null;
  }
}
