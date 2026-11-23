import { cookies } from "next/headers";
import { getSessionUserByToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { SUPER_LEVEL, type Difficulty } from "@/lib/engine/game-settings";
import { getAiAccess } from "./access";

export type AiPageDecision =
  | { kind: "play"; maxLevel: Difficulty }
  | { kind: "trial"; maxLevel: Difficulty }
  | { kind: "locked"; maxLevel: Difficulty; reason: string };

/** Décision côté serveur pour une page d'entraînement au niveau demandé. */
export async function decideAiPage(level: Difficulty): Promise<AiPageDecision> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
  const user = await getSessionUserByToken(token);
  const access = await getAiAccess(user?.id ?? null);
  if (level <= access.maxLevel) return { kind: "play", maxLevel: access.maxLevel };
  if (level === SUPER_LEVEL && access.trial.available) return { kind: "trial", maxLevel: access.maxLevel };
  const reason =
    level === SUPER_LEVEL && access.trial.enabled
      ? !access.loggedIn
        ? "Connectez-vous pour profiter de votre partie offerte du jour contre le niveau 5."
        : access.trial.usedToday
          ? "Vous avez déjà joué votre partie offerte d’aujourd’hui contre le niveau 5. Revenez demain, ou passez Premium pour jouer sans limite."
          : `L’offre gratuite donne accès aux niveaux 1 à ${access.freeMaxLevel}.`
      : `L’offre gratuite donne accès aux niveaux 1 à ${access.freeMaxLevel}${access.trial.enabled ? ", et à une partie offerte par jour contre le niveau 5" : ""}.`;
  return { kind: "locked", maxLevel: access.maxLevel, reason };
}
