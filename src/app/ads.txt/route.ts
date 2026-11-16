import { getSetting } from "@/lib/settings/service";

/**
 * /ads.txt exigé par Google AdSense, généré à partir de l'identifiant
 * éditeur configuré dans l'administration.
 */
export async function GET() {
  const clientId = await getSetting("ads.clientId");
  const publisher = clientId?.replace(/^ca-/, "");
  const body = publisher
    ? `google.com, ${publisher}, DIRECT, f08c47fec0942fa0\n`
    : "# Aucun identifiant AdSense configuré.\n";
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
