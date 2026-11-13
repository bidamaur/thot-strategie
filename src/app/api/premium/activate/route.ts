import { randomUUID } from "node:crypto";
import { MockPaymentPurpose, Prisma } from "@/generated/prisma-client";
import { getRequestUser } from "@/lib/auth/session";
import {
  isMockEconomyEnabled,
  mockEconomyDisabledResponse,
} from "@/lib/economy/mock-mode";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const PREMIUM_PRICE_CFA = 5_000;

export async function POST(request: Request) {
  if (!isMockEconomyEnabled()) return mockEconomyDisabledResponse();

  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }
  if (!currentUser.isAdmin) {
    return NextResponse.json(
      { error: "Seul le compte administrateur peut activer Premium." },
      { status: 403 },
    );
  }

  try {
    const user = await prisma.$transaction(async (transaction) => {
      const administrator = await transaction.user.findUnique({
        where: { id: currentUser.id },
        select: { isAdmin: true, isPremium: true },
      });
      if (!administrator?.isAdmin) {
        return {
          error: "Seul le compte administrateur peut activer Premium.",
          status: 403,
        } as const;
      }
      if (administrator.isPremium) {
        return { error: "Ce compte est déjà Premium.", status: 409 } as const;
      }

      const referenceId = randomUUID();
      const activated = await transaction.user.updateMany({
        where: { id: currentUser.id, isAdmin: true, isPremium: false },
        data: { isPremium: true },
      });
      if (activated.count !== 1) {
        throw new Error("L’activation Premium n’a pas pu être confirmée.");
      }
      await transaction.mockPayment.create({
        data: {
          userId: currentUser.id,
          purpose: MockPaymentPurpose.PREMIUM_MEMBERSHIP,
          amount: new Prisma.Decimal(PREMIUM_PRICE_CFA),
          referenceId,
        },
      });
      return { isPremium: true, amountCfa: PREMIUM_PRICE_CFA } as const;
    });

    if ("error" in user) {
      return NextResponse.json({ error: user.error }, { status: user.status });
    }
    return NextResponse.json({ payment: { ...user, simulated: true } });
  } catch (error) {
    console.error("Erreur lors de l’activation Premium simulée :", error);
    return NextResponse.json(
      { error: "Impossible de finaliser le paiement simulé." },
      { status: 500 },
    );
  }
}
