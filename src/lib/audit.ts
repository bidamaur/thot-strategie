import type { Prisma } from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

/**
 * Écrit une entrée dans le journal d'audit. À appeler dans la même
 * transaction que l'opération tracée pour garantir la cohérence.
 */
export async function writeAuditLog(
  client: Prisma.TransactionClient | typeof prisma,
  entry: AuditEntry,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action.slice(0, 80),
      entity: entry.entity.slice(0, 80),
      entityId: entry.entityId?.slice(0, 120) ?? null,
      before: entry.before ?? undefined,
      after: entry.after ?? undefined,
    },
  });
}
