import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const entity = searchParams.get("entity") ?? undefined;
  const take = Math.min(Number(searchParams.get("limit") ?? 100) || 100, 200);
  const logs = await prisma.auditLog.findMany({
    where: entity ? { entity } : undefined,
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { username: true } } },
  });
  return NextResponse.json({
    logs: logs.map((log) => ({
      id: log.id,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      before: log.before,
      after: log.after,
      actor: log.actor?.username ?? null,
      createdAt: log.createdAt,
    })),
  });
}
