import { NextResponse } from "next/server";
import { recordClientEvents, type IncomingEvent } from "@/lib/analytics";
import { getRequestUser } from "@/lib/auth/session";

// Garde-fou simple contre l'envoi en masse (par processus).
const buckets = new Map<string, { count: number; resetAt: number }>();

function allow(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    if (buckets.size > 10_000) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= 30;
}

/** POST { events: [...] } — envoyé via navigator.sendBeacon ou fetch keepalive. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { events?: IncomingEvent[] } | null;
  if (!body || !Array.isArray(body.events)) return new NextResponse(null, { status: 204 });
  const user = await getRequestUser(request).catch(() => null);
  const key = user?.id ?? (typeof body.events[0]?.anonId === "string" ? String(body.events[0].anonId) : "anon");
  if (!allow(key)) return new NextResponse(null, { status: 204 });
  try {
    await recordClientEvents(body.events, user?.id ?? null);
  } catch (error) {
    console.error("Mesure d'audience :", error);
  }
  return new NextResponse(null, { status: 204 });
}
