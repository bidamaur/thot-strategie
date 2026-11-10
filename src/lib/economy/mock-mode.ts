import { NextResponse } from "next/server";

export function isMockEconomyEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

export function mockEconomyDisabledResponse() {
  return NextResponse.json(
    {
      error:
        "Les opérations économiques simulées sont limitées au serveur de développement.",
    },
    { status: 404 },
  );
}
