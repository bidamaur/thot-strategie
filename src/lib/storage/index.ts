import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSettings } from "@/lib/settings/service";
import { amzDateOf, encodePath, sha256Hex, signV4 } from "./s3-signer";

/**
 * Stockage des fichiers envoyés (images), paramétrable dans l'administration :
 *  - « filesystem » (défaut) : un dossier local ou un partage réseau monté
 *    (NAS, autre serveur via NFS/SMB). Les fichiers sont servis par l'application
 *    via /media/… ou par un autre serveur si une adresse publique est renseignée ;
 *  - « s3 » : un serveur de fichiers compatible S3 (AWS, MinIO, R2, Backblaze…).
 * Les clés S3 ne sont jamais stockées en base : variables d'environnement.
 */

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/** Dossiers logiques autorisés. */
export type StorageFolder = "community" | "avatars" | "clubs" | "system";

export const MEDIA_ROUTE = "/media";

interface StorageConfig {
  driver: "filesystem" | "s3";
  fsRoot: string;
  publicBaseUrl: string;
  s3: { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };
}

export async function storageConfig(): Promise<StorageConfig> {
  const s = await getSettings([
    "storage.driver",
    "storage.fsRoot",
    "storage.publicBaseUrl",
    "storage.s3Endpoint",
    "storage.s3Bucket",
    "storage.s3Region",
  ] as const);
  return {
    driver: s["storage.driver"] === "s3" ? "s3" : "filesystem",
    fsRoot: s["storage.fsRoot"] || "storage/uploads",
    publicBaseUrl: s["storage.publicBaseUrl"].replace(/\/+$/, ""),
    s3: {
      endpoint: s["storage.s3Endpoint"].replace(/\/+$/, ""),
      bucket: s["storage.s3Bucket"],
      region: s["storage.s3Region"] || "us-east-1",
      accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY ?? "",
    },
  };
}

/** Dossier racine absolu du stockage fichier. */
export function resolveRoot(fsRoot: string): string {
  return path.isAbsolute(fsRoot) || /^\\\\/.test(fsRoot) ? fsRoot : path.join(process.cwd(), fsRoot);
}

const KEY_PATTERN = /^(community|avatars|clubs|system)\/[a-zA-Z0-9_-]+\.(webp|png|jpg|gif)$/;

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** Adresse publique d'un fichier selon la configuration actuelle. */
export function publicUrl(config: StorageConfig, key: string): string {
  if (config.publicBaseUrl) return `${config.publicBaseUrl}/${key}`;
  if (config.driver === "s3") return `${config.s3.endpoint}/${config.s3.bucket}/${key}`;
  return `${MEDIA_ROUTE}/${key}`;
}

/** Retrouve la clé d'un fichier à partir de son adresse (null si l'adresse n'appartient pas au stockage actuel). */
export function keyFromUrl(config: StorageConfig, url: string): string | null {
  const bases = [config.publicBaseUrl, config.driver === "s3" ? `${config.s3.endpoint}/${config.s3.bucket}` : "", MEDIA_ROUTE].filter(Boolean);
  for (const base of bases) {
    if (url.startsWith(`${base}/`)) {
      const key = url.slice(base.length + 1);
      return isValidKey(key) ? key : null;
    }
  }
  return null;
}

async function s3Request(config: StorageConfig, method: "PUT" | "DELETE", key: string, body?: Buffer, contentType?: string) {
  const { endpoint, bucket, region, accessKeyId, secretAccessKey } = config.s3;
  if (!endpoint || !bucket) throw new StorageError("Stockage S3 incomplet : renseignez l’adresse du serveur et le compartiment.");
  if (!accessKeyId || !secretAccessKey) {
    throw new StorageError("Clés S3 absentes : définissez STORAGE_S3_ACCESS_KEY_ID et STORAGE_S3_SECRET_ACCESS_KEY sur le serveur.");
  }
  const url = new URL(endpoint);
  const objectPath = `/${encodePath(bucket)}/${encodePath(key)}`;
  const payloadHash = sha256Hex(body ?? "");
  const amzDate = amzDateOf();
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(contentType ? { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable" } : {}),
  };
  const { authorization } = signV4({ method, path: objectPath, headers, payloadHash, region, accessKeyId, secretAccessKey, amzDate });
  const { host: _host, ...sent } = headers;
  void _host;
  const response = await fetch(`${url.origin}${objectPath}`, {
    method,
    headers: { ...sent, authorization },
    body: body ? new Uint8Array(body) : undefined,
  });
  if (!response.ok && !(method === "DELETE" && response.status === 404)) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new StorageError(`Le serveur de fichiers a refusé l’envoi (${response.status}). ${detail}`);
  }
}

/** Enregistre un fichier et renvoie son adresse publique. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<string> {
  if (!isValidKey(key)) throw new StorageError("Nom de fichier invalide.");
  const config = await storageConfig();
  if (config.driver === "s3") {
    await s3Request(config, "PUT", key, body, contentType);
  } else {
    const file = path.join(resolveRoot(config.fsRoot), ...key.split("/"));
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    } catch (error) {
      throw new StorageError(`Dossier de sauvegarde inaccessible (${(error as NodeJS.ErrnoException).code ?? "erreur"}).`);
    }
  }
  return publicUrl(config, key);
}

/** Supprime un fichier du stockage actuel (sans erreur s'il n'existe plus ou appartient à un ancien emplacement). */
export async function deleteByUrl(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const config = await storageConfig();
  const key = keyFromUrl(config, url);
  if (!key) return;
  try {
    if (config.driver === "s3") await s3Request(config, "DELETE", key);
    else await unlink(path.join(resolveRoot(config.fsRoot), ...key.split("/")));
  } catch {
    // nettoyage au mieux : un fichier orphelin n'est pas bloquant
  }
}

/** Lecture d'un fichier du stockage local (route /media). */
export async function readLocalObject(key: string): Promise<Buffer | null> {
  if (!isValidKey(key)) return null;
  const config = await storageConfig();
  const root = resolveRoot(config.fsRoot);
  const file = path.resolve(root, ...key.split("/"));
  if (!file.startsWith(path.resolve(root))) return null;
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}
