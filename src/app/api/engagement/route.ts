import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/session";
import {
  claimObjective,
  dismissOnboarding,
  EngagementError,
  getObjectives,
  getOnboarding,
  getStreaks,
  nextPrompt,
  readState,
  recordPrompt,
} from "@/lib/engagement/service";
import { getQuotaStatus, serializeQuota } from "@/lib/quota";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";

async function publicConfig() {
  const s = await getSettings([
    "pwa.installPromptEnabled",
    "pwa.installPromptMinVisits",
    "pwa.installPromptCooldownDays",
    "pwa.installPromptMaxDismissals",
    "pwa.installMessage",
    "analytics.enabled",
    "analytics.experiments",
    "engagement.premiumHintsEnabled",
    "freePlan.warnAtRemaining",
  ] as const);
  return {
    install: {
      enabled: s["pwa.installPromptEnabled"],
      minVisits: s["pwa.installPromptMinVisits"],
      cooldownDays: s["pwa.installPromptCooldownDays"],
      maxDismissals: s["pwa.installPromptMaxDismissals"],
      message: s["pwa.installMessage"],
    },
    analytics: s["analytics.enabled"],
    experiments: s["analytics.experiments"].filter((e) => e.enabled).map((e) => ({ id: e.id, variants: e.variants })),
    premiumHints: s["engagement.premiumHintsEnabled"],
    warnAtRemaining: s["freePlan.warnAtRemaining"],
  };
}

/**
 * GET /api/engagement?path=/… — tout ce dont l'interface a besoin pour la
 * fidélisation, en un seul appel : quota, objectifs, séries, premiers pas,
 * LA sollicitation éventuelle à afficher et la configuration d'installation.
 * ?scope=light : uniquement la configuration et la sollicitation (navigation).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = (url.searchParams.get("path") ?? "/").slice(0, 200);
  const light = url.searchParams.get("scope") === "light";
  const config = await publicConfig();
  const session = await getRequestUser(request);
  if (!session) return NextResponse.json({ user: null, config, prompt: null });

  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true, createdAt: true, engagement: true } });
  if (!user) return NextResponse.json({ user: null, config, prompt: null });
  const state = readState(user.engagement);
  const prompt = await nextPrompt(user, path);
  const install = state.prompts?.pwa_install ?? {};
  const base = { user: { id: user.id }, config, prompt, installState: install };
  if (light) return NextResponse.json(base);

  const [quota, objectives, streaks, onboarding] = await Promise.all([
    getQuotaStatus(user.id),
    getObjectives(user.id),
    getStreaks(user.id),
    getOnboarding(user.id, state, user.createdAt),
  ]);
  return NextResponse.json({ ...base, quota: serializeQuota(quota), objectives, streaks, onboarding });
}

/** { action: "claim", objectiveId } | { action: "prompt", id, event, kind } | { action: "dismissOnboarding" } */
export async function POST(request: Request) {
  const session = await getRequestUser(request);
  if (!session) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    switch (body.action) {
      case "claim":
        return NextResponse.json(await claimObjective(session.id, String(body.objectiveId ?? "")));
      case "prompt": {
        const event = body.event;
        if (event !== "shown" && event !== "dismissed" && event !== "clicked" && event !== "installed") {
          return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
        }
        const kind = body.kind === "modal" ? "modal" : "banner";
        await recordPrompt(session.id, String(body.id ?? ""), event, kind);
        return NextResponse.json({ ok: true });
      }
      case "dismissOnboarding":
        await dismissOnboarding(session.id);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof EngagementError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Engagement :", error);
    return NextResponse.json({ error: "Action impossible pour le moment." }, { status: 500 });
  }
}
