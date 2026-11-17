import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/session";
import { getQuotaStatus, serializeQuota } from "@/lib/quota";

/** Parties en ligne gratuites restantes aujourd'hui. */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  return NextResponse.json(serializeQuota(await getQuotaStatus(user.id)), { headers: { "Cache-Control": "no-store" } });
}
