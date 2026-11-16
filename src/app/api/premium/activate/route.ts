import { randomUUID } from "node:crypto";
import { MockPaymentPurpose, Prisma } from "@/generated/prisma-client";
import { writeAuditLog } from "@/lib/audit";
import { getRequestUser } from "@/lib/auth/session";
import {
  isMockEconomyEnabled,
  mockEconomyDisabledResponse,
} from "@/lib/economy/mock-mode";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings/service";
import { NextResponse } from "next/server";

/**
 * Activation Premium par paiement SIMULÉ (développement uniquement).
 * Comportement historique conservé : réservé au compte administrateur tant
 * qu'aucun prestataire de paiement réel n'est branché. Le niveau choisi et
 * son tarif proviennent désormais du paramètre `premium.tiers`.
 */
export async function POST(request: Request) {
  if (!isMockEconomyEnabled()) return mockEconomyDisabledResponse();

  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }
  if (!currentUser.isAdmin) {
    return NextResponse.json(
      { error: "Seul le compte administrateur peut activer Premium (paiement simulé)." },
      { status: 403 },
    );
  }

  let requestedLevel = 1;
  try {
    const body = (await request.json().catch(() => ({}))) as { level?: unknown };
    if (typeof body.level === "number" && Number.isInteger(body.level)) requestedLevel = body.level;
  } catch {
    // corps vide accepté : niveau 1 par défaut (comportement historique)
  }

  const tiers = await getSetting("premium.tiers");
  const tier = tiers.find((t) => t.level === requestedLevel && t.level > 0);
  if (!tier) {
    return NextResponse.json({ error: "Niveau Premium inconnu." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({
        where: { id: currentUser.id },
        select: { isPremium: true, premiumLevel: true, premiumExpiresAt: true },
      });
      const expiresAt =
        tier.durationDays > 0
          ? new Date(Date.now() + tier.durationDays * 24 * 60 * 60 * 1000)
          : null;
      await tx.user.update({
        where: { id: currentUser.id },
        data: { isPremium: true, premiumLevel: tier.level, premiumExpiresAt: expiresAt },
      });
      await tx.mockPayment.create({
        data: {
          userId: currentUser.id,
          purpose: MockPaymentPurpose.PREMIUM_MEMBERSHIP,
          amount: new Prisma.Decimal(tier.priceCfa),
          referenceId: randomUUID(),
        },
      });
      await writeAuditLog(tx, {
        actorId: currentUser.id,
        action: "PREMIUM_ACTIVATED",
        entity: "User",
        entityId: currentUser.id,
        before: { ...before, premiumExpiresAt: before.premiumExpiresAt?.toISOString() ?? null },
        after: { isPremium: true, premiumLevel: tier.level, premiumExpiresAt: expiresAt?.toISOString() ?? null },
      });
      return { level: tier.level, name: tier.name, amountCfa: tier.priceCfa, expiresAt };
    });
    return NextResponse.json({ payment: { ...result, isPremium: true, simulated: true } });
  } catch (error) {
    console.error("Erreur lors de l’activation Premium simulée :", error);
    return NextResponse.json(
      { error: "Impossible de finaliser le paiement simulé." },
      { status: 500 },
    );
  }
}
