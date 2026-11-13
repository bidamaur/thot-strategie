import {
  hashSessionToken,
  readSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const token = readSessionCookie(request.headers.get("cookie"));
  if (token) {
    try {
      await prisma.userSession.deleteMany({
        where: { tokenHash: hashSessionToken(token) },
      });
    } catch (error) {
      console.error("Erreur lors de la fermeture de session :", error);
      return NextResponse.json(
        { error: "Impossible de fermer la session." },
        { status: 500 },
      );
    }
  }

  const secure =
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https";
  const response = NextResponse.json({ loggedOut: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  return response;
}
