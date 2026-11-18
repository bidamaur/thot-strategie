/**
 * Test d'intégration : quota de l'offre gratuite, objectifs, séries, premiers
 * pas, sollicitations, historique/statistiques et mesure d'audience.
 * Données créées puis supprimées ; paramètres modifiés temporairement puis restaurés.
 * Lancement : npm run test:engagement
 */
import { Prisma } from "@/generated/prisma-client";
import { computeKpis, recordClientEvents, trackServer } from "@/lib/analytics";
import { claimObjective, getObjectives, getOnboarding, getStreaks, nextPrompt, readState, recordPrompt } from "@/lib/engagement/service";
import { listMyGames, myStats } from "@/lib/player-stats";
import { prisma } from "@/lib/prisma";
import { assertCanStartGame, getQuotaStatus, QuotaReachedError } from "@/lib/quota";
import { invalidateSettingsCache } from "@/lib/settings/service";

const tag = `en${Date.now().toString(36)}`;
const userIds: string[] = [];
const touchedSettings = new Map<string, { value: Prisma.JsonValue } | null>();
let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail ?? "");
  }
}

async function setSetting(key: string, value: unknown) {
  if (!touchedSettings.has(key)) {
    const row = await prisma.tournamentConfig.findUnique({ where: { key }, select: { value: true } });
    touchedSettings.set(key, row);
  }
  await prisma.tournamentConfig.upsert({
    where: { key },
    update: { value: value as Prisma.InputJsonValue },
    create: { key, value: value as Prisma.InputJsonValue },
  });
  invalidateSettingsCache();
}

async function user(name: string, extra: Record<string, unknown> = {}) {
  const u = await prisma.user.create({ data: { username: `${tag}${name}`.slice(0, 24), pointsFree: 100, ...extra } as Prisma.UserCreateInput });
  userIds.push(u.id);
  return u;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function game(white: string, black: string, data: Partial<Prisma.MatchUncheckedCreateInput> = {}) {
  return prisma.match.create({
    data: { playerWhiteId: white, playerBlackId: black, gameType: "CHESS", status: "FINISHED", mode: "CASUAL", ...data },
  });
}

async function main() {
  const old = daysAgo(40);
  const [alice, bob, newbie, prem] = [
    await user("alice", { createdAt: old }),
    await user("bob", { createdAt: old }),
    await user("newbie"),
    await user("prem", { createdAt: old, isPremium: true, premiumLevel: 1, premiumExpiresAt: daysAgo(-10) }),
  ];

  console.log("1. Quota quotidien de l'offre gratuite");
  await setSetting("freePlan.dailyGamesEnabled", false);
  check("désactivé par défaut : aucune limite", (await getQuotaStatus(alice.id)).limited === false);
  await setSetting("freePlan.dailyGamesEnabled", true);
  await setSetting("freePlan.dailyGames", 3);
  await setSetting("freePlan.newPlayerGraceDays", 7);
  await setSetting("freePlan.countFriendChallenges", true);
  await game(alice.id, bob.id);
  await game(bob.id, alice.id, { mode: "RATED", winnerId: alice.id });
  await game(alice.id, bob.id, { status: "ABORTED" });
  await game(alice.id, bob.id, { mode: "MONEY" });
  await game(alice.id, bob.id, { createdAt: daysAgo(1) });
  let q = await getQuotaStatus(alice.id);
  check("comptées : amicale + classée du jour ; ignorées : annulée, rémunérée, veille", q.limited && q.used === 2 && q.remaining === 1, q);
  await assertCanStartGame(alice.id, "CASUAL");
  check("une partie restante : lancement autorisé", true);
  await game(alice.id, bob.id, { status: "IN_PROGRESS" });
  q = await getQuotaStatus(alice.id);
  check("une partie en cours compte (pas de lancement en parallèle pour contourner)", q.used === 3 && q.remaining === 0);
  let blocked = false;
  try {
    await assertCanStartGame(alice.id, "RATED");
  } catch (e) {
    blocked = e instanceof QuotaReachedError;
  }
  check("quota atteint : nouvelle partie classée refusée", blocked);
  await assertCanStartGame(alice.id, "MONEY");
  check("le mode rémunéré n'est pas concerné par le quota", true);
  check("nouveau compte : période de découverte sans limite", (await getQuotaStatus(newbie.id)).exemptReason === "discovery");
  check("Premium : parties illimitées", (await getQuotaStatus(prem.id)).exemptReason === "premium");
  await setSetting("freePlan.newPlayerGraceDays", 0);
  for (let i = 0; i < 3; i += 1) await game(newbie.id, bob.id);
  blocked = false;
  try {
    await assertCanStartGame(newbie.id, "CASUAL", "challenge");
  } catch (e) {
    blocked = e instanceof QuotaReachedError;
  }
  check("sans période de découverte : le défi entre amis est aussi décompté", blocked);
  await setSetting("freePlan.countFriendChallenges", false);
  await assertCanStartGame(newbie.id, "CASUAL", "challenge");
  check("réglage « défis hors quota » : défi autorisé", true);
  await setSetting("freePlan.dailyGamesEnabled", false);

  console.log("2. Objectifs (récompense en points classiques uniquement)");
  const objectives = await getObjectives(alice.id);
  const win1 = objectives.find((o) => o.id === "d_win1");
  check("objectif « gagner une partie » accompli", Boolean(win1?.completed) && !win1?.claimed, win1);
  const before = await prisma.user.findUniqueOrThrow({ where: { id: alice.id }, select: { pointsFree: true, elo: true, walletReal: true } });
  const results = await Promise.allSettled([claimObjective(alice.id, "d_win1"), claimObjective(alice.id, "d_win1"), claimObjective(alice.id, "d_win1")]);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: alice.id }, select: { pointsFree: true, elo: true, walletReal: true } });
  check("trois réclamations simultanées : un seul crédit", results.filter((r) => r.status === "fulfilled").length === 1 && after.pointsFree - before.pointsFree === (win1?.rewardPoints ?? 0), { results: results.map((r) => r.status), delta: after.pointsFree - before.pointsFree });
  check("ni ELO ni points argent modifiés", after.elo === before.elo && after.walletReal.equals(before.walletReal));
  check("objectif marqué comme reçu", (await getObjectives(alice.id)).find((o) => o.id === "d_win1")?.claimed === true);
  let notReached = false;
  try {
    await claimObjective(bob.id, "w_tournament");
  } catch {
    notReached = true;
  }
  check("objectif non atteint : réclamation refusée", notReached);

  console.log("3. Séries");
  const streaks = await getStreaks(alice.id);
  check("jours d'affilée : hier + aujourd'hui = 2", streaks.playDays === 2, streaks);
  check("victoires de suite calculées sur les parties récentes", streaks.winStreak === 0 || streaks.winStreak === 1, streaks);

  console.log("4. Premiers pas");
  const onboarding = await getOnboarding(newbie.id, {}, newbie.createdAt);
  check("première partie cochée, ami/club/tournoi à faire", Boolean(onboarding?.steps.find((s) => s.id === "first_game")?.done) && !onboarding?.steps.find((s) => s.id === "friend")?.done, onboarding);
  check("masqué une fois refermé", (await getOnboarding(newbie.id, { onboardingDismissedAt: new Date().toISOString() }, newbie.createdAt)) === null);

  console.log("5. Sollicitations : une à la fois, jamais en partie, refus respecté");
  await setSetting("engagement.promptsEnabled", true);
  await setSetting("engagement.campaigns", [
    { id: "test_banner", enabled: true, audience: "free", kind: "banner", title: "Test", body: "Corps", ctaLabel: "Voir", ctaHref: "/tournois", pages: ["/clubs"], startsAt: null, endsAt: null, maxShows: 2, cooldownDays: 0, variantB: { title: "Test B", body: "Corps B" } },
  ]);
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: newbie.id }, select: { id: true, createdAt: true, engagement: true } });
  check("bienvenue proposée au nouveau joueur sur l'accueil", (await nextPrompt(fresh, "/"))?.id === "welcome");
  check("rien en salle de jeu", (await nextPrompt(fresh, "/match/abc123")) === null);
  check("rien pendant la recherche d'adversaire ni l'entraînement", (await nextPrompt(fresh, "/match/en-ligne")) === null && (await nextPrompt(fresh, "/match/ia/dames")) === null);
  await recordPrompt(newbie.id, "welcome", "shown", "modal");
  const afterWelcome = await prisma.user.findUniqueOrThrow({ where: { id: newbie.id }, select: { id: true, createdAt: true, engagement: true } });
  check("bienvenue affichée une seule fois", (await nextPrompt(afterWelcome, "/"))?.id !== "welcome");
  const campaign = await nextPrompt(afterWelcome, "/clubs");
  check("campagne ciblée (gratuit, page /clubs) avec variante A/B", campaign?.id === "test_banner" && (campaign.title === "Test" || campaign.title === "Test B"), campaign);
  check("campagne « gratuit » non montrée au Premium", (await nextPrompt(await prisma.user.findUniqueOrThrow({ where: { id: prem.id }, select: { id: true, createdAt: true, engagement: true } }), "/clubs")) === null);
  await recordPrompt(newbie.id, "test_banner", "dismissed");
  const afterDismiss = await prisma.user.findUniqueOrThrow({ where: { id: newbie.id }, select: { id: true, createdAt: true, engagement: true } });
  check("refus respecté : plus réaffichée", (await nextPrompt(afterDismiss, "/clubs")) === null);
  check("état enregistré côté serveur", readState(afterDismiss.engagement).prompts?.test_banner?.dismissals === 1);
  let unknownRejected = false;
  try {
    await recordPrompt(newbie.id, "inconnue", "shown");
  } catch {
    unknownRejected = true;
  }
  check("identifiant de sollicitation inconnu refusé", unknownRejected);

  console.log("6. Historique et statistiques selon le niveau");
  await game(alice.id, bob.id, { createdAt: daysAgo(45), winnerId: bob.id });
  const freeHistory = await listMyGames(alice.id, {});
  check("gratuit : historique limité (30 jours), parties anciennes comptées", freeHistory.historyDays === 30 && freeHistory.hiddenOlder >= 1 && freeHistory.items.every((g) => Date.parse(g.createdAt) > daysAgo(31).getTime()), freeHistory);
  const freeStats = await myStats(alice.id);
  check("gratuit : statistiques essentielles, avancées verrouillées", freeStats.advanced === null && freeStats.advancedLocked && freeStats.essential.overall.all.played >= 4);
  await prisma.user.update({ where: { id: alice.id }, data: { isPremium: true, premiumLevel: 3, premiumExpiresAt: daysAgo(-5) } });
  const fullHistory = await listMyGames(alice.id, {});
  check("Or : historique complet", fullHistory.historyDays === 0 && fullHistory.hiddenOlder === 0 && fullHistory.items.some((g) => Date.parse(g.createdAt) < daysAgo(44).getTime()));
  const premStats = await myStats(alice.id);
  check("Premium : statistiques avancées (couleur, mode, adversaires)", Boolean(premStats.advanced && premStats.advanced.byColor.WHITE.played > 0 && premStats.advanced.topOpponents[0]?.username === bob.username), premStats.advanced);

  console.log("7. Mesure d'audience");
  await setSetting("analytics.enabled", true);
  const stored = await recordClientEvents(
    [
      { name: "app_open", anonId: "abcdef12-3456", device: "mobile", standalone: true },
      { name: "evenement_libre", anonId: "abcdef12-3456" },
      { name: "premium_view", anonId: "abcdef12-3456", device: "pirate<script>", experiment: "premium_hero", variant: "B", props: { from: "stats<script>", "bad key": 1, seconds: 12.3456 } },
    ],
    alice.id,
  );
  check("liste fermée : l'événement inconnu est ignoré", stored === 2);
  const ev = await prisma.analyticsEvent.findFirst({ where: { userId: alice.id, name: "premium_view" } });
  check("valeurs nettoyées (appareil invalide rejeté, propriétés filtrées)", ev?.device === null && JSON.stringify(ev?.props) === JSON.stringify({ from: "statsscript", seconds: 12.35 }), ev);
  await trackServer("signup", newbie.id);
  const kpis = await computeKpis();
  check("indicateurs calculés", kpis.users.total > 0 && kpis.users.mau >= 2 && kpis.experiments.some((e) => e.experiment === "premium_hero" && e.variant === "B"), kpis.users);
}

main()
  .catch((error) => {
    failures += 1;
    console.error("Erreur inattendue :", error);
  })
  .finally(async () => {
    for (const [key, row] of touchedSettings) {
      if (row) await prisma.tournamentConfig.update({ where: { key }, data: { value: row.value as Prisma.InputJsonValue } });
      else await prisma.tournamentConfig.deleteMany({ where: { key } });
    }
    invalidateSettingsCache();
    const matchIds = (
      await prisma.match.findMany({ where: { OR: [{ playerWhiteId: { in: userIds } }, { playerBlackId: { in: userIds } }] }, select: { id: true } })
    ).map((m) => m.id);
    await prisma.analyticsEvent.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { anonId: "abcdef12-3456" }] } });
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nTous les contrôles d'engagement sont passés." : `\n${failures} contrôle(s) en échec.`);
    process.exit(failures === 0 ? 0 : 1);
  });
