/**
 * Test d'intégration (base réelle) : score de session des affronts, classements
 * de l'accueil, niveaux de l'IA (gratuit / Premium), essai quotidien du niveau 5
 * avec publicité et notification, quota de 25 parties gratuites par jour.
 * Données créées puis supprimées. Lancement : npm run test:features
 */
import { prisma } from "@/lib/prisma";
import { AiAccessError, consumeTrial, ensureDailyTrialNotice, getAiAccess, startTrialAd, trialDay } from "@/lib/ai-training/access";
import { getMatchSession, SessionError } from "@/lib/match-session";
import { getHomeRankings, invalidateHomeRankings } from "@/lib/rankings/home";
import { assertCanStartGame, getQuotaStatus, QuotaReachedError } from "@/lib/quota";
import { countryCodeFromName, countryName, flagEmoji } from "@/lib/countries";
import { normalizeCountryCode } from "@/lib/monetization/rules";

const tag = `ft${Date.now().toString(36)}`;
const userIds: string[] = [];
let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail ?? "");
  }
}

async function user(name: string, data: Record<string, unknown> = {}) {
  const u = await prisma.user.create({ data: { username: `${tag}${name}`.slice(0, 24), ...data } });
  userIds.push(u.id);
  return u;
}

async function expectAiError(label: string, fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    check(label, false, "aucune erreur");
  } catch (error) {
    check(label, error instanceof AiAccessError && error.code === code, error instanceof AiAccessError ? error.code : error);
  }
}

async function main() {
  console.log("Pays et drapeaux");
  check("noms français fournis par le système, codes ISO", countryName("CM") === "Cameroun" && countryCodeFromName("Cameroun") === "CM" && countryCodeFromName("Côte d’Ivoire") === "CI" && countryCodeFromName("Germany") === "DE");
  check("drapeau emoji calculé depuis le code", flagEmoji("CM") === "\u{1F1E8}\u{1F1F2}");
  check("profils existants en texte libre toujours reconnus (paiements)", normalizeCountryCode("Sénégal") === "SN" && normalizeCountryCode("cameroun") === "CM");

  console.log("Score de session d'un affront");
  const a = await user("A");
  const b = await user("B");
  const c = await user("C");
  const base = { gameType: "CHECKERS" as const, draughtsVariant: "INTERNATIONAL" as const, mode: "CASUAL" as const };
  const m1 = await prisma.match.create({ data: { ...base, playerWhiteId: a.id, playerBlackId: b.id, status: "FINISHED", winnerId: a.id } });
  let s1 = await getMatchSession(m1.id, a.id);
  check("1re partie gagnée par A : 1 – 0", s1.players.find((p) => p.id === a.id)?.wins === 1 && s1.players.find((p) => p.id === b.id)?.wins === 0 && s1.gameNumber === 1);
  const m2 = await prisma.match.create({ data: { ...base, playerWhiteId: b.id, playerBlackId: a.id, status: "FINISHED", winnerId: b.id, rematchOfId: m1.id } });
  const m3 = await prisma.match.create({ data: { ...base, playerWhiteId: a.id, playerBlackId: b.id, status: "FINISHED", winnerId: null, rematchOfId: m2.id } });
  const m4 = await prisma.match.create({ data: { ...base, playerWhiteId: b.id, playerBlackId: a.id, status: "IN_PROGRESS", rematchOfId: m3.id } });
  s1 = await getMatchSession(m4.id, b.id);
  check("revanches enchaînées (couleurs inversées) : 1 – 1, 1 nulle, partie 4 en cours", s1.players.find((p) => p.id === a.id)?.wins === 1 && s1.players.find((p) => p.id === b.id)?.wins === 1 && s1.draws === 1 && s1.gameNumber === 4 && s1.played === 3, s1);
  const fresh = await prisma.match.create({ data: { ...base, playerWhiteId: a.id, playerBlackId: b.id, status: "IN_PROGRESS" } });
  check("nouvel affront (sans revanche) : la session repart de 0 – 0", (await getMatchSession(fresh.id, a.id)).played === 0);
  let denied = false;
  try {
    await getMatchSession(m4.id, c.id);
  } catch (error) {
    denied = error instanceof SessionError && error.status === 404;
  }
  check("score réservé aux deux joueurs de la partie", denied);

  console.log("Classements de l'accueil");
  const ranked = [
    await user("R1", { pointsFree: 50, country: "Cameroun" }),
    await user("R2", { pointsFree: 4000, country: "Gabon" }),
    await user("R3", { pointsFree: 900 }),
    await user("R4", { pointsFree: 99999 }), // 1 seule partie : non classé (minimum 3)
  ];
  const ratings = [[2900, 10], [2850, 8], [2800, 5], [2990, 1]] as const;
  for (const [i, u] of ranked.entries()) {
    await prisma.playerRating.create({ data: { userId: u.id, variant: "INTERNATIONAL", timeControl: "BLITZ", eloRating: ratings[i]![0], gamesPlayed: ratings[i]![1] } });
  }
  invalidateHomeRankings();
  const home = await getHomeRankings();
  const mine = (home.top ?? []).filter((e) => e.username.startsWith(tag));
  check("Top 20 calculé (au plus 20 joueurs)", Array.isArray(home.top) && home.top.length <= 20);
  check("joueur avec trop peu de parties classées exclu", !mine.some((e) => e.username === `${tag}R4`));
  check("ordre selon l'indice (ELO + points) : R2 devant R1 malgré un ELO plus faible", mine.findIndex((e) => e.username === `${tag}R2`) < mine.findIndex((e) => e.username === `${tag}R1`), mine.map((e) => [e.username, e.index]));
  const r1 = mine.find((e) => e.username === `${tag}R1`);
  check("chaque ligne : drapeau (pays), avatar, nom, points, ELO, indice", !!r1 && r1.country === "Cameroun" && r1.points === 50 && r1.elo === 2900 && typeof r1.index === "number" && "avatar" in r1);
  check("Top 10 Or masqué tant que les parties rémunérées sont désactivées", home.gold === null);
  check("aucun solde d'argent dans la réponse publique", !JSON.stringify(home).includes("wallet"));

  console.log("Niveaux de l'IA");
  const free = await user("Free");
  const prem = await user("Prem", { isPremium: true, premiumLevel: 1, premiumExpiresAt: new Date(Date.now() + 86400_000) });
  const freeAccess = await getAiAccess(free.id);
  check("gratuit : niveaux 1 à 3, essai du niveau 5 disponible", freeAccess.maxLevel === 3 && !freeAccess.premium && freeAccess.trial.available);
  const premAccess = await getAiAccess(prem.id);
  check("Premium : niveaux 1 à 5, pas d'essai nécessaire", premAccess.maxLevel === 5 && premAccess.premium && !premAccess.trial.available);
  check("visiteur non connecté : niveaux 1 à 3, essai réservé aux comptes", (await getAiAccess(null)).maxLevel === 3 && !(await getAiAccess(null)).trial.available);

  console.log("Notification de l'essai quotidien");
  check("joueur gratuit : notification envoyée", await ensureDailyTrialNotice(free.id));
  const notifs = await prisma.notification.findMany({ where: { userId: free.id, type: "AI_TRIAL" } });
  check("notification « partie offerte contre le niveau super »", notifs.length === 1 && notifs[0]!.title.includes("niveau super") && notifs[0]!.link === "/match/ia");
  check("une seule notification par jour", !(await ensureDailyTrialNotice(free.id)));
  check("pas de notification pour un Premium", !(await ensureDailyTrialNotice(prem.id)) && (await prisma.notification.count({ where: { userId: prem.id, type: "AI_TRIAL" } })) === 0);

  console.log("Essai du niveau 5 : publicité puis partie");
  const t0 = new Date();
  await expectAiError("partie impossible sans avoir regardé la publicité", () => consumeTrial(free.id, "CHECKERS", t0), "AD_REQUIRED");
  const ad = await startTrialAd(free.id, t0);
  check(`publicité de ${ad.adSeconds} s démarrée (horloge serveur)`, ad.adSeconds === 15 && ad.remainingMs === 15000, ad);
  await expectAiError("partie refusée avant la fin de la publicité", () => consumeTrial(free.id, "CHECKERS", new Date(t0.getTime() + 5000)), "AD_NOT_FINISHED");
  const again = await startTrialAd(free.id, new Date(t0.getTime() + 8000));
  check("relancer la publicité ne remet pas le compteur à zéro", again.remainingMs === 7000, again);
  const used = await consumeTrial(free.id, "CHECKERS", new Date(t0.getTime() + 15500));
  check("après la publicité : partie lancée", used.premium === false && !!used.usedAt);
  await expectAiError("une seule partie offerte par jour", () => consumeTrial(free.id, "CHESS", new Date(t0.getTime() + 20000)), "USED");
  await expectAiError("publicité refusée une fois l'essai utilisé", () => startTrialAd(free.id, new Date(t0.getTime() + 20000)), "USED");
  const after = await getAiAccess(free.id);
  check("niveau 5 de nouveau verrouillé pour aujourd'hui", after.trial.usedToday && !after.trial.available && after.maxLevel === 3);
  const tomorrow = new Date(t0.getTime() + 86400_000);
  check("le lendemain, l'essai est de nouveau disponible", (await getAiAccess(free.id, tomorrow)).trial.available && trialDay(tomorrow) !== trialDay(t0));

  console.log("Quota de l'offre gratuite : 25 parties en ligne par jour");
  const q = await user("Quota", { createdAt: new Date(Date.now() - 30 * 86400_000) });
  const status0 = await getQuotaStatus(q.id);
  check("joueur gratuit limité à 25 parties, compteur à 0", status0.limited && status0.limit === 25 && status0.remaining === 25, status0);
  const opp = await user("QOpp");
  await prisma.match.createMany({ data: Array.from({ length: 25 }, () => ({ ...base, playerWhiteId: q.id, playerBlackId: opp.id, status: "FINISHED" as const })) });
  const status25 = await getQuotaStatus(q.id);
  check("après 25 parties : plus aucune partie restante", status25.remaining === 0, status25);
  let blocked = false;
  try {
    await assertCanStartGame(q.id, "CASUAL", "queue");
  } catch (error) {
    blocked = error instanceof QuotaReachedError;
  }
  check("26e partie refusée par le serveur", blocked);
  await prisma.user.update({ where: { id: q.id }, data: { isPremium: true, premiumLevel: 1, premiumExpiresAt: new Date(Date.now() + 86400_000) } });
  const premStatus = await getQuotaStatus(q.id);
  check("Premium : parties illimitées", !premStatus.limited && premStatus.exemptReason === "premium");
  let premOk = true;
  try {
    await assertCanStartGame(q.id, "RATED", "queue");
  } catch {
    premOk = false;
  }
  check("Premium : la 26e partie est autorisée", premOk);
}

main()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(async () => {
    await prisma.match.deleteMany({ where: { OR: [{ playerWhiteId: { in: userIds } }, { playerBlackId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    invalidateHomeRankings();
    console.log(failures === 0 ? "\nTous les contrôles passent." : `\n${failures} contrôle(s) en échec.`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
