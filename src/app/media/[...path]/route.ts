import { readLocalObject } from "@/lib/storage";

const TYPES: Record<string, string> = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", gif: "image/gif" };

/**
 * Sert les images du stockage « dossier » (local ou partage réseau).
 * Next.js ne sert pas les fichiers ajoutés à /public après la compilation :
 * cette route rend les envois accessibles en production. Les noms étant
 * uniques et immuables, le cache navigateur/CDN peut être conservé un an.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const key = path.join("/");
  const data = await readLocalObject(key);
  if (!data) return new Response("Introuvable", { status: 404 });
  const ext = key.split(".").pop() ?? "";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Content-Length": String(data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
