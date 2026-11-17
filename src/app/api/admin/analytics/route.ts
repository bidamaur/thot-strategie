import { NextResponse } from "next/server";
import { computeKpis } from "@/lib/analytics";
import { getRequestUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user?.isAdmin) return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  try {
    return NextResponse.json(await computeKpis());
  } catch (error) {
    console.error("Indicateurs :", error);
    return NextResponse.json({ error: "Calcul des indicateurs impossible." }, { status: 500 });
  }
}
