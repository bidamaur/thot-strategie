import { Prisma } from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  getSettingDef,
  getSettingDefault,
  SETTING_DEFINITIONS,
  validateSettingValue,
  type SettingKey,
  type SettingValue,
} from "./registry";

/**
 * Lecture des paramètres avec cache mémoire court (évite une requête SQL par
 * règle métier). Chaque process (Next.js, serveur Socket.IO) possède son cache ;
 * la durée de vie limite l'écart après une modification.
 */
const CACHE_TTL_MS = 15_000;

let cache: Map<string, unknown> | null = null;
let cacheLoadedAt = 0;
let loading: Promise<Map<string, unknown>> | null = null;

async function loadAll(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return cache;
  if (loading) return loading;
  loading = prisma.tournamentConfig
    .findMany({ select: { key: true, value: true } })
    .then((rows) => {
      cache = new Map(rows.map((row) => [row.key, row.value]));
      cacheLoadedAt = Date.now();
      return cache;
    })
    .catch((error) => {
      console.error("Lecture des paramètres impossible, valeurs par défaut utilisées :", error);
      return cache ?? new Map<string, unknown>();
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function invalidateSettingsCache(): void {
  cache = null;
  cacheLoadedAt = 0;
}

function coerce<K extends SettingKey>(key: K, raw: unknown): SettingValue<K> {
  if (raw === undefined || raw === null) return getSettingDefault(key);
  const checked = validateSettingValue(key, raw);
  // Une valeur stockée devenue invalide ne doit jamais bloquer la plateforme.
  return (checked.ok ? checked.value : getSettingDefault(key)) as SettingValue<K>;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const all = await loadAll();
  return coerce(key, all.get(key));
}

export async function getSettings<const K extends readonly SettingKey[]>(
  keys: K,
): Promise<{ [I in K[number]]: SettingValue<I> }> {
  const all = await loadAll();
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = coerce(key, all.get(key));
  return out as { [I in K[number]]: SettingValue<I> };
}

/** Lecture synchrone depuis le cache (valeur par défaut si non chargé). */
export function peekSetting<K extends SettingKey>(key: K): SettingValue<K> {
  if (!cache) void loadAll();
  else if (Date.now() - cacheLoadedAt >= CACHE_TTL_MS) void loadAll();
  return coerce(key, cache?.get(key));
}

export async function listSettingsWithValues() {
  const rows = await prisma.tournamentConfig.findMany({
    include: { updatedBy: { select: { username: true } } },
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return SETTING_DEFINITIONS.map((def) => {
    const row = byKey.get(def.key);
    return {
      ...def,
      value: coerce(def.key, row?.value),
      isDefault: !row,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy?.username ?? null,
    };
  });
}

export class SettingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingValidationError";
  }
}

/**
 * Modifie un paramètre (administrateur uniquement — à vérifier par l'appelant)
 * et trace l'ancienne et la nouvelle valeur dans le journal d'audit.
 */
export async function updateSetting(
  key: string,
  value: unknown,
  actorId: string,
): Promise<unknown> {
  const def = getSettingDef(key);
  if (!def) throw new SettingValidationError("Paramètre inconnu.");
  const checked = validateSettingValue(key, value);
  if (!checked.ok) throw new SettingValidationError(checked.error);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.tournamentConfig.findUnique({ where: { key } });
    if (existing && !existing.isEditable) {
      throw new SettingValidationError("Ce paramètre est verrouillé.");
    }
    await tx.tournamentConfig.upsert({
      where: { key },
      update: { value: checked.value as Prisma.InputJsonValue, updatedById: actorId },
      create: {
        key,
        value: checked.value as Prisma.InputJsonValue,
        description: def.description ?? def.label,
        updatedById: actorId,
      },
    });
    await writeAuditLog(tx, {
      actorId,
      action: "SETTING_UPDATED",
      entity: "Setting",
      entityId: key,
      before: existing ? (existing.value as Prisma.InputJsonValue) : { default: def.default as Prisma.InputJsonValue },
      after: checked.value as Prisma.InputJsonValue,
    });
  });
  invalidateSettingsCache();
  return checked.value;
}

export async function resetSetting(key: string, actorId: string): Promise<void> {
  const def = getSettingDef(key);
  if (!def) throw new SettingValidationError("Paramètre inconnu.");
  await prisma.$transaction(async (tx) => {
    const existing = await tx.tournamentConfig.findUnique({ where: { key } });
    if (!existing) return;
    await tx.tournamentConfig.delete({ where: { key } });
    await writeAuditLog(tx, {
      actorId,
      action: "SETTING_RESET",
      entity: "Setting",
      entityId: key,
      before: existing.value as Prisma.InputJsonValue,
      after: { default: def.default as Prisma.InputJsonValue },
    });
  });
  invalidateSettingsCache();
}
