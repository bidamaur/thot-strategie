import { Prisma } from "@/generated/prisma-client";

/**
 * Rejoue une transaction SERIALIZABLE en cas de conflit d'écriture (P2034).
 * Sous isolation sérialisable, PostgreSQL annule l'une des transactions
 * concurrentes ; la rejouer lui permet de constater l'état final (partie déjà
 * réglée, mise déjà bloquée…) et d'échouer proprement plutôt qu'au hasard.
 */
export async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retriable =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retriable || attempt >= attempts) throw error;
      // Attente courte et aléatoire pour désynchroniser les transactions rivales.
      await new Promise((resolve) => setTimeout(resolve, 15 * attempt + Math.random() * 25));
    }
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
