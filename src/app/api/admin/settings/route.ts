import { getRequestUser } from "@/lib/auth/session";
import { SETTING_CATEGORIES } from "@/lib/settings/registry";
import {
  listSettingsWithValues,
  resetSetting,
  SettingValidationError,
  updateSetting,
} from "@/lib/settings/service";
import { NextResponse } from "next/server";

async function requireAdmin(request: Request) {
  const user = await getRequestUser(request);
  return user?.isAdmin ? user : null;
}

export async function GET(request: Request) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  }
  const settings = await listSettingsWithValues();
  return NextResponse.json({ categories: SETTING_CATEGORIES, settings });
}

/** Modifie un paramètre : { key, value }. Chaque modification est auditée. */
export async function PUT(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  }
  let body: { key?: unknown; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  if (typeof body.key !== "string") {
    return NextResponse.json({ error: "Clé requise." }, { status: 400 });
  }
  try {
    const value = await updateSetting(body.key, body.value, admin.id);
    return NextResponse.json({ key: body.key, value });
  } catch (error) {
    if (error instanceof SettingValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Erreur lors de la mise à jour d'un paramètre :", error);
    return NextResponse.json({ error: "Impossible d'enregistrer le paramètre." }, { status: 500 });
  }
}

/** Rétablit la valeur par défaut : ?key=... */
export async function DELETE(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  }
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Clé requise." }, { status: 400 });
  try {
    await resetSetting(key, admin.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SettingValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Erreur interne." }, { status: 500 });
  }
}
