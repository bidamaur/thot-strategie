import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Les parties contre l’IA sont locales. Les points ne sont crédités qu’après validation d’un résultat par le serveur.",
    },
    { status: 410 },
  );
}
