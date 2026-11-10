import {
  getRequestUser,
  toPublicProfile,
} from "@/lib/auth/session";
import { connection } from "next/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  await connection();
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
    }
    return NextResponse.json({ user: toPublicProfile(user) });
  } catch (error) {
    console.error("Erreur lors de la lecture de la session :", error);
    return NextResponse.json(
      { error: "Impossible de charger votre session." },
      { status: 500 },
    );
  }
}
