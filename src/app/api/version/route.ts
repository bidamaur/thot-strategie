import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

let cached: string | null = null;

/** Identifiant de la version déployée : sert à proposer le rechargement après une mise à jour. */
export async function GET() {
  if (!cached) {
    cached = await readFile(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8")
      .then((v) => v.trim())
      .catch(() => "dev");
  }
  return Response.json({ version: cached }, { headers: { "Cache-Control": "no-store" } });
}
