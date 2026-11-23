/**
 * Test d'intégration : monétisation (paiements Mobile Money manuels, dons,
 * intérêts Premium) et disponibilités hebdomadaires, sur la vraie base.
 * Les routes API sont appelées directement (session réelle) pour vérifier les
 * permissions. Données créées puis supprimées.
 * Lancement : npm run test:monetization
 */
import { createUserSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getPrivileges } from "@/lib/premium/privileges";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings/service";
import { saveAvailability, tournamentAvailability } from "@/lib/availability/service";
import { interestStats, recordInterest } from "@/lib/monetization/interest";
import { monetizationDashboard } from "@/lib/monetization/dashboard";
import { declarePayment, getCheckoutConfig, paymentInstructions, PaymentError, rejectPayment, validatePayment } from "@/lib/monetization/payments";
import { POST as declareRoute } from "@/app/api/monetization/payments/route";
import { GET as adminListRoute } from "@/app/api/admin/monetization/payments/route";
import { POST as validateRoute } from "@/app/api/admin/monetization/payments/[paymentId]/validate/route";
import { POST as interestRoute } from "@/app/api/monetization/interest/route";
import { GET as heatmapRoute } from "@/app/api/tournaments/[tournamentId]/availability/route";

const tag = `mo${Date.now().toString(36)}`;
const userIds: string[] = [];
const tournamentIds: string[] = [];
let failures = 0;
let refN = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail ?? "");
  }
}

async function expectError(label: string, fn: () => Promise<unknown>, code?: string) {
  try {
    await fn();
    check(label, false, "aucune erreur");
  } catch (error) {
    check(label, error instanceof PaymentError && (!code || error.code === code), error instanceof PaymentError ? `${error.code} : ${error.message}` : error);
  }
}

async function user(name: string, data: Record<string, unknown> = {}) {
  const u = await prisma.user.create({ data: { username: `${tag}${name}`.slice(0, 24), ...data } });
  userIds.push(u.id);
  return u;
}

const ref = () => `${tag.toUpperCase()}R${(refN += 1)}`;
const recentIso = () => new Date(Date.now() - 5 * 60_000).toISOString();
const DAY = 86_400_000;

async function req(url: string, userId: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (userId) headers.set("cookie", `${SESSION_COOKIE_NAME}=${await createUserSession(userId)}`);
  return new Request(`http://localhost${url}`, { ...init, headers });
}

async function main() {
  const tiers = (await getSetting("premium.tiers")).filter((t) => t.level > 0 && t.available !== false);
  const admin = await user("admin", { isAdmin: true });
  const cm = await user("cm", { country: "Cameroun" });
  const fr = await user("fr", { country: "France" });
  const noCountry = await user("nocountry");

  console.log("Configuration et instructions");
  const cfg = await getCheckoutConfig(cm.id);
  check("joueur camerounais : paiement Mobile Money ouvert", cfg.eligibility.mobileMoney === true);
  check("deux opérateurs, numéros paramétrés (Orange 656716849, MTN 677125468)",
    cfg.providers.find((p) => p.id === "ORANGE_MONEY")?.number === "656716849" && cfg.providers.find((p) => p.id === "MTN_MOMO")?.number === "677125468", cfg.providers);
  check("niveaux P1 à P5 proposés avec tarif et durée du paramétrage", cfg.tiers.length === 5 && cfg.tiers.every((t, i) => t.priceCfa === tiers[i]!.priceCfa && t.durationDays === tiers[i]!.durationDays));
  for (const t of tiers) {
    const ins = await paymentInstructions({ purpose: "PREMIUM", tierLevel: t.level });
    const om = ins.find((i) => i.id === "ORANGE_MONEY")!;
    const mtn = ins.find((i) => i.id === "MTN_MOMO")!;
    check(`P${t.level} : montant ${t.priceCfa} FCFA, USSD Orange et MTN générés`,
      om.amount === t.priceCfa && om.ussd === `#150*1*1*656716849*${t.priceCfa}#` && mtn.ussd === `*126*1*1*677125468*${t.priceCfa}#`, { om: om.ussd, mtn: mtn.ussd });
  }
  const frCfg = await getCheckoutConfig(fr.id);
  check("joueur hors Cameroun : pas de paiement, message de lancement", !frCfg.eligibility.mobileMoney && frCfg.eligibility.reason === "INTERNATIONAL" && frCfg.messages.comingSoonTitle.includes("février 2027"), frCfg.messages.comingSoonTitle);
  check("pays non renseigné : invité à compléter son profil", (await getCheckoutConfig(noCountry.id)).eligibility.reason === "COUNTRY_MISSING");

  console.log("Achat de chaque niveau Premium (déclaration → validation → activation)");
  const buyers: Awaited<ReturnType<typeof user>>[] = [];
  for (const t of tiers) buyers.push(await user(`b${t.level}`, { country: "Cameroun" }));
  for (const [i, t] of tiers.entries()) {
    const b = buyers[i]!;
    const d = await declarePayment(b.id, { purpose: "PREMIUM", provider: i % 2 ? "MTN_MOMO" : "ORANGE_MONEY", tierLevel: t.level, senderPhone: "+237 6 90 00 00 0" + i, declaredAmount: t.priceCfa, transactionRef: ref(), paidAt: recentIso() });
    const before = await getPrivileges((await prisma.user.findUniqueOrThrow({ where: { id: b.id } })));
    check(`P${t.level} : déclaration en attente, aucune activation automatique`, d.status === "PENDING" && before.level === 0);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: d.id } });
    check(`P${t.level} : montant attendu calculé par le serveur (${t.priceCfa})`, row.expectedAmount === t.priceCfa && row.recipientPhone === (i % 2 ? "677125468" : "656716849"));
    const t0 = Date.now();
    await validatePayment(admin.id, d.id, { receivedAmount: t.priceCfa });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: b.id } });
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: d.id } });
    const lvl = await getPrivileges(after);
    const expectedEnd = p.premiumStartsAt!.getTime() + t.durationDays * DAY;
    check(`P${t.level} : activé, expiration = début + ${t.durationDays} jours, validateur enregistré`,
      lvl.level === t.level && after.premiumExpiresAt?.getTime() === expectedEnd && Math.abs(p.premiumStartsAt!.getTime() - t0) < 60_000 && p.reviewedById === admin.id && p.reviewedAt !== null && p.status === "VALIDATED",
      { level: lvl.level, exp: after.premiumExpiresAt, expectedEnd: new Date(expectedEnd) });
  }
  const audit = await prisma.auditLog.count({ where: { actorId: admin.id, action: "PAYMENT_VALIDATED_PREMIUM" } });
  check("chaque validation est journalisée", audit === tiers.length, audit);
  const notes = await prisma.notification.count({ where: { userId: { in: buyers.map((b) => b.id) }, type: "PAYMENT" } });
  check("chaque joueur reçoit une notification de validation", notes === tiers.length, notes);

  console.log("Renouvellement");
  const b1 = buyers[0]!;
  const end1 = (await prisma.user.findUniqueOrThrow({ where: { id: b1.id } })).premiumExpiresAt!;
  const r1 = await declarePayment(b1.id, { purpose: "PREMIUM", provider: "ORANGE_MONEY", tierLevel: 1, senderPhone: "690000000", declaredAmount: tiers[0]!.priceCfa, transactionRef: ref(), paidAt: recentIso() });
  await validatePayment(admin.id, r1.id, { receivedAmount: tiers[0]!.priceCfa });
  const end2 = (await prisma.user.findUniqueOrThrow({ where: { id: b1.id } })).premiumExpiresAt!;
  check("même niveau : prolongé à partir de l'échéance en cours", end2.getTime() === end1.getTime() + tiers[0]!.durationDays * DAY, { end1, end2 });
  await expectError("niveau inférieur au niveau actif refusé à la déclaration", () =>
    declarePayment(buyers[3]!.id, { purpose: "PREMIUM", provider: "MTN_MOMO", tierLevel: 1, senderPhone: "690000000", declaredAmount: 2000, transactionRef: ref(), paidAt: recentIso() }), "LOWER_TIER");

  console.log("Références et sécurité");
  const usedRef = ref();
  const a = await declarePayment(cm.id, { purpose: "PREMIUM", provider: "ORANGE_MONEY", tierLevel: 2, senderPhone: "656000001", declaredAmount: tiers[1]!.priceCfa, transactionRef: usedRef, paidAt: recentIso() });
  const other = await user("other", { country: "cameroon" });
  await expectError("même référence déjà déclarée (même opérateur) : refusée", () =>
    declarePayment(other.id, { purpose: "PREMIUM", provider: "ORANGE_MONEY", tierLevel: 1, senderPhone: "656000002", declaredAmount: 2000, transactionRef: usedRef.toLowerCase(), paidAt: recentIso() }), "REFERENCE_USED");
  await expectError("une seule déclaration en attente à la fois", () =>
    declarePayment(cm.id, { purpose: "PREMIUM", provider: "MTN_MOMO", tierLevel: 2, senderPhone: "656000001", declaredAmount: 5000, transactionRef: ref(), paidAt: recentIso() }), "ALREADY_PENDING");
  await expectError("référence obligatoire", () =>
    declarePayment(other.id, { purpose: "PREMIUM", provider: "MTN_MOMO", tierLevel: 1, senderPhone: "656000002", declaredAmount: 2000, transactionRef: "", paidAt: recentIso() }));
  await expectError("numéro expéditeur non camerounais refusé", () =>
    declarePayment(other.id, { purpose: "PREMIUM", provider: "MTN_MOMO", tierLevel: 1, senderPhone: "+33612345678", declaredAmount: 2000, transactionRef: ref(), paidAt: recentIso() }));
  await expectError("date de paiement dans le futur refusée", () =>
    declarePayment(other.id, { purpose: "PREMIUM", provider: "MTN_MOMO", tierLevel: 1, senderPhone: "656000002", declaredAmount: 2000, transactionRef: ref(), paidAt: new Date(Date.now() + 3 * 3600_000).toISOString() }));
  await expectError("montant reçu inférieur au tarif : validation refusée", () => validatePayment(admin.id, a.id, { receivedAmount: 100 }), "AMOUNT");

  // Deux validations simultanées : une seule réussit, un seul abonnement.
  const results = await Promise.allSettled([
    validatePayment(admin.id, a.id, { receivedAmount: tiers[1]!.priceCfa }),
    validatePayment(admin.id, a.id, { receivedAmount: tiers[1]!.priceCfa }),
  ]);
  check("deux validations simultanées : une seule aboutit", results.filter((r) => r.status === "fulfilled").length === 1, results.map((r) => r.status));
  await expectError("une déclaration déjà validée ne peut pas l'être une seconde fois", () => validatePayment(admin.id, a.id, { receivedAmount: 5000 }), "ALREADY_PROCESSED");
  await expectError("une déclaration validée ne peut pas être rejetée", () => rejectPayment(admin.id, a.id, { reason: "NOT_FOUND" }), "ALREADY_PROCESSED");
  await expectError("référence déjà validée : nouvelle déclaration refusée", () =>
    declarePayment(other.id, { purpose: "PREMIUM", provider: "ORANGE_MONEY", tierLevel: 1, senderPhone: "656000002", declaredAmount: 2000, transactionRef: usedRef, paidAt: recentIso() }), "REFERENCE_USED");
  // Garantie en base : même en contournant le service, deux paiements validés ne peuvent partager une référence.
  let dbGuard = false;
  try {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: a.id } });
    const { id: _id, reference: _r, ...rest } = p;
    void _id; void _r;
    await prisma.payment.create({ data: { ...rest, reference: `PAY-${tag}`.slice(0, 20), userId: other.id } });
  } catch {
    dbGuard = true;
  }
  check("index unique en base : une référence validée une seule fois par opérateur", dbGuard);

  console.log("Rejet");
  const rj = await declarePayment(other.id, { purpose: "PREMIUM", provider: "MTN_MOMO", tierLevel: 1, senderPhone: "677000000", declaredAmount: 1500, transactionRef: ref(), paidAt: recentIso() });
  await expectError("rejet sans motif refusé", () => rejectPayment(admin.id, rj.id, { reason: "" }));
  await expectError("motif « Autre » sans précision refusé", () => rejectPayment(admin.id, rj.id, { reason: "OTHER", note: "" }));
  await rejectPayment(admin.id, rj.id, { reason: "WRONG_AMOUNT", note: "1 500 reçus au lieu de 2 000" });
  const rjRow = await prisma.payment.findUniqueOrThrow({ where: { id: rj.id } });
  const otherUser = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
  check("rejeté avec motif, aucun Premium activé", rjRow.status === "REJECTED" && rjRow.rejectReason === "WRONG_AMOUNT" && (await getPrivileges(otherUser)).level === 0);
  check("le joueur est notifié du rejet", (await prisma.notification.count({ where: { userId: other.id, type: "PAYMENT" } })) === 1);
  const again = await declarePayment(other.id, { purpose: "PREMIUM", provider: "MTN_MOMO", tierLevel: 1, senderPhone: "677000000", declaredAmount: 2000, transactionRef: ref(), paidAt: recentIso() });
  check("après un rejet, le joueur peut déclarer à nouveau", again.status === "PENDING");
  check("journal : rejet tracé", (await prisma.auditLog.count({ where: { entityId: rj.id, action: "PAYMENT_REJECTED" } })) === 1);

  console.log("Dons");
  const donor = await user("donor", { country: "Cameroun" });
  const don = await declarePayment(donor.id, { purpose: "DONATION", provider: "ORANGE_MONEY", amount: 2500, senderPhone: "655555555", declaredAmount: 2500, transactionRef: ref(), paidAt: recentIso() });
  const custom = await paymentInstructions({ purpose: "DONATION", amount: 3700 });
  check("don : montant libre accepté, USSD avec ce montant", custom[0]!.ussd === "#150*1*1*656716849*3700#", custom[0]!.ussd);
  await expectError("don hors limites refusé", () => paymentInstructions({ purpose: "DONATION", amount: 10 }));
  await validatePayment(admin.id, don.id, { receivedAmount: 2500 });
  const donorAfter = await prisma.user.findUniqueOrThrow({ where: { id: donor.id } });
  check("don validé : AUCUN Premium activé ni prolongé", !donorAfter.isPremium && donorAfter.premiumLevel === 0 && donorAfter.premiumExpiresAt === null);
  await expectError("joueur hors Cameroun : don Mobile Money refusé", () =>
    declarePayment(fr.id, { purpose: "DONATION", provider: "ORANGE_MONEY", amount: 1000, senderPhone: "655555555", declaredAmount: 1000, transactionRef: ref(), paidAt: recentIso() }), "INTERNATIONAL");
  await expectError("joueur hors Cameroun : Premium refusé", () =>
    declarePayment(fr.id, { purpose: "PREMIUM", provider: "ORANGE_MONEY", tierLevel: 1, senderPhone: "655555555", declaredAmount: 2000, transactionRef: ref(), paidAt: recentIso() }), "INTERNATIONAL");
  // Contrôle administratif du pays : l'administrateur peut confirmer ou corriger le pays déclaré.
  await prisma.user.update({ where: { id: fr.id }, data: { verifiedCountryCode: "CM" } });
  check("pays confirmé par l'administration : prime sur le pays déclaré", (await getCheckoutConfig(fr.id)).eligibility.mobileMoney === true);
  await prisma.user.update({ where: { id: cm.id }, data: { verifiedCountryCode: "FR" } });
  check("pays corrigé par l'administration : paiement camerounais fermé", (await getCheckoutConfig(cm.id)).eligibility.mobileMoney === false);

  console.log("Intérêts et liste d'attente");
  await recordInterest(fr.id, { feature: "ADVANCED_STATS" });
  await recordInterest(fr.id, { feature: "ADVANCED_STATS" });
  await recordInterest(fr.id, { feature: "ADVANCED_STATS" });
  await recordInterest(fr.id, { feature: "PREMIUM_OFFER", tierLevel: 3 });
  const rows = await prisma.premiumInterest.findMany({ where: { userId: fr.id } });
  check("sollicitations agrégées : une ligne par joueur et fonctionnalité, compteur à 3", rows.length === 2 && rows.find((r) => r.feature === "ADVANCED_STATS")?.views === 3, rows.map((r) => [r.feature, r.views]));
  check("consultation ≠ liste d'attente", rows.every((r) => !r.waitlist));
  await recordInterest(fr.id, { feature: "PREMIUM_OFFER", tierLevel: 3, waitlist: true });
  const wl = await prisma.premiumInterest.findFirstOrThrow({ where: { userId: fr.id, feature: "PREMIUM_OFFER" } });
  check("inscription volontaire à la liste d'attente enregistrée (pays, niveau)", wl.waitlist && wl.waitlistAt !== null && wl.tierLevel === 3 && wl.country === "France");
  const stats = await interestStats({});
  // Le pays agrégé est celui retenu pour les paiements (ici confirmé « CM » par l'administration plus haut).
  check("statistiques : fonctionnalités, niveaux et pays", stats.features.some((f) => f.feature === "ADVANCED_STATS") && stats.tiers.some((t) => t.level === 3) && stats.countries.some((c) => c.code === "CM"), { tiers: stats.tiers, countries: stats.countries });

  console.log("Tableau de bord : revenus = paiements vérifiés uniquement");
  const dash = await monetizationDashboard();
  const validatedPremium = await prisma.payment.aggregate({ where: { status: "VALIDATED", purpose: "PREMIUM" }, _sum: { receivedAmount: true } });
  const allDeclared = await prisma.payment.aggregate({ where: { purpose: "PREMIUM" }, _sum: { declaredAmount: true } });
  check("revenus Premium = somme des montants reçus validés (les déclarations en attente ne comptent pas)",
    dash.premium.revenue === (validatedPremium._sum.receivedAmount ?? 0) && dash.premium.revenue < (allDeclared._sum.declaredAmount ?? 0), { revenue: dash.premium.revenue });
  check("dons encaissés comptés à part", dash.donations.total >= 2500 && dash.donations.validated >= 1);

  console.log("Permissions (routes API)");
  const listAsPlayer = await adminListRoute(await req("/api/admin/monetization/payments", cm.id));
  const listAnon = await adminListRoute(await req("/api/admin/monetization/payments", null));
  const listAsAdmin = await adminListRoute(await req("/api/admin/monetization/payments?status=PENDING", admin.id));
  check("liste des déclarations : 401 sans session, 403 pour un joueur, 200 pour l'administrateur", listAnon.status === 401 && listAsPlayer.status === 403 && listAsAdmin.status === 200, [listAnon.status, listAsPlayer.status, listAsAdmin.status]);
  const vAsPlayer = await validateRoute(await req(`/api/admin/monetization/payments/${again.id}/validate`, other.id, { method: "POST", body: JSON.stringify({ confirm: true, receivedAmount: 2000 }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ paymentId: again.id }) });
  check("un joueur ne peut pas valider son propre paiement (403)", vAsPlayer.status === 403, vAsPlayer.status);
  const vNoConfirm = await validateRoute(await req(`/api/admin/monetization/payments/${again.id}/validate`, admin.id, { method: "POST", body: JSON.stringify({ receivedAmount: 2000 }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ paymentId: again.id }) });
  check("validation sans confirmation explicite refusée (400)", vNoConfirm.status === 400, vNoConfirm.status);
  // Le navigateur ne peut pas imposer le montant ni le niveau : un faux montant attendu est ignoré.
  const forged = await declareRoute(await req("/api/monetization/payments", fr.id, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose: "PREMIUM", provider: "MTN_MOMO", tierLevel: 5, expectedAmount: 1, senderPhone: "677000001", declaredAmount: 1, transactionRef: ref(), paidAt: recentIso() }),
  }));
  const forgedJson = (await forged.json()) as { payment?: { id: string } };
  const forgedRow = forgedJson.payment ? await prisma.payment.findUnique({ where: { id: forgedJson.payment.id } }) : null;
  check("montant attendu fixé par le serveur, jamais par le navigateur", forged.status === 200 && forgedRow?.expectedAmount === tiers[4]!.priceCfa && forgedRow.declaredAmount === 1, forgedRow);
  const anonInterest = await interestRoute(await req("/api/monetization/interest", null, { method: "POST", body: JSON.stringify({ feature: "ADVANCED_STATS" }), headers: { "content-type": "application/json" } }));
  check("intérêt d'un visiteur non connecté : rien n'est enregistré (204)", anonInterest.status === 204);

  console.log("Disponibilités");
  const org = await user("org");
  const ps = [await user("p1"), await user("p2"), await user("p3")];
  const t = await prisma.tournament.create({ data: { name: `${tag} dispo`, creatorId: org.id, scope: "CITY", maxPlayers: 8, status: "OPEN" } });
  tournamentIds.push(t.id);
  await prisma.tournamentParticipant.createMany({ data: ps.map((p, i) => ({ tournamentId: t.id, userId: p.id, seed: i + 1 })) });
  const empty = { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [], "7": [] };
  await saveAvailability(ps[0]!.id, { timeZone: "Africa/Douala", weekly: { ...empty, "1": [["18:00", "21:00"]], "6": [["09:00", "12:00"], ["15:00", "20:00"]] } });
  await saveAvailability(ps[1]!.id, { timeZone: "Africa/Douala", weekly: { ...empty, "1": [["19:00", "22:00"]] } });
  await saveAvailability(ps[2]!.id, { timeZone: "Europe/Paris", weekly: { ...empty, "1": [["19:00", "21:00"]] } });
  let invalid = false;
  try {
    await saveAvailability(ps[0]!.id, { timeZone: "Africa/Douala", weekly: { ...empty, "2": [["21:00", "18:00"]] } });
  } catch {
    invalid = true;
  }
  check("plage incohérente refusée", invalid);
  const own = await prisma.playerAvailability.findUniqueOrThrow({ where: { userId: ps[0]!.id } });
  check("plusieurs plages par jour enregistrées", JSON.stringify((own.weekly as Record<string, unknown>)["6"]) === JSON.stringify([["09:00", "12:00"], ["15:00", "20:00"]]));
  const hm = await tournamentAvailability(t.id, { id: org.id, isAdmin: false }, "Africa/Douala");
  const monday = hm.available ? hm.heatmap.rows.find((r) => r.weekday === 1)!.counts : [];
  // Paris 19:00–21:00 (hiver, UTC+1) = Douala 19:00–21:00.
  check("synthèse : nombre de joueurs disponibles par créneau (fuseaux pris en compte)", hm.available && monday[18] === 1 && monday[19] === 3 && monday[20] === 3 && monday[21] === 1, monday.slice(17, 23));
  check("synthèse : meilleur créneau = lundi 19h–21h, 3 joueurs", hm.available && hm.heatmap.best[0]?.weekday === 1 && hm.heatmap.best[0]?.from === 19 && hm.heatmap.best[0]?.to === 21 && hm.heatmap.best[0]?.count === 3, hm.available && hm.heatmap.best[0]);
  check("synthèse : aucun nom de joueur exposé", !JSON.stringify(hm).includes(tag));
  const outsider = await user("outsider");
  let denied = false;
  try {
    await tournamentAvailability(t.id, { id: outsider.id, isAdmin: false }, "Africa/Douala");
  } catch {
    denied = true;
  }
  check("synthèse réservée aux participants et à l'organisateur", denied);
  const viaRoute = await heatmapRoute(await req(`/api/tournaments/${t.id}/availability?tz=Africa/Douala`, ps[1]!.id), { params: Promise.resolve({ tournamentId: t.id }) });
  check("route de synthèse accessible à un participant", viaRoute.status === 200, viaRoute.status);
  const startsBefore = await prisma.tournament.findUniqueOrThrow({ where: { id: t.id }, select: { startedAt: true, endsAt: true, status: true } });
  check("les disponibilités ne modifient jamais le tournoi", startsBefore.startedAt === null && startsBefore.endsAt === null && startsBefore.status === "OPEN");
  await prisma.tournament.update({ where: { id: t.id }, data: { status: "IN_PROGRESS" } });
  const started = await tournamentAvailability(t.id, { id: org.id, isAdmin: false }, "Africa/Douala");
  check("tournoi commencé : synthèse plus proposée", !started.available);
}

main()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(async () => {
    await prisma.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    console.log(failures === 0 ? "\nTous les contrôles passent." : `\n${failures} contrôle(s) en échec.`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
