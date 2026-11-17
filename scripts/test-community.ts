/**
 * Test d'intégration du module communautaire sur la base locale (données créées puis supprimées).
 * Lancement : npm run test:community
 */
import { TournamentType } from "@/generated/prisma-client";
import { createChallenge, expireChallenges, listChallenges, respondChallenge, cancelChallenge } from "@/lib/community/challenges";
import { CommunityError } from "@/lib/community/core";
import {
  areFriends,
  blockUser,
  listFriends,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  setFavorite,
} from "@/lib/community/friends";
import { inviteFriendsToClub, inviteFriendsToTournament, listMyInvitations, respondClubInvite, respondTournamentInvite } from "@/lib/community/invites";
import { issueSanction, listReports, reportContent, resolveReport, revokeSanction } from "@/lib/community/moderation";
import { listNotifications, markRead, savePreferences, unreadCount } from "@/lib/community/notifications";
import {
  createComment,
  createPost,
  deleteComment,
  deletePost,
  getFeed,
  listComments,
  reactToComment,
  reactToPost,
  setPinned,
  updatePost,
} from "@/lib/community/posts";
import { getPublicProfile, updateCommunityProfile } from "@/lib/community/profile";
import { createPrivateRoom, listRooms, setRoomMembership } from "@/lib/community/rooms";
import { decodeFromDb, encodeForDb } from "@/lib/community/text";
import { createTournament } from "@/lib/economy/tournaments";
import { prisma } from "@/lib/prisma";
import sharp from "sharp";
import { getClubMatch, interclubStandings, proposeClubMatch, respondClubMatch, setLineup, startBoardGame } from "@/lib/community/interclub";
import { deleteByUrl, keyFromUrl, readLocalObject, storageConfig } from "@/lib/storage";
import { detectImageType, saveImage } from "@/lib/uploads";

const tag = `cm${Date.now().toString(36)}`;
const userIds: string[] = [];
const tournamentIds: string[] = [];
const clubIds: string[] = [];
const roomIds: string[] = [];
let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail ?? "");
  }
}

async function rejects(label: string, fn: () => Promise<unknown>, status?: number) {
  try {
    await fn();
    check(label, false, "aucune erreur levée");
  } catch (error) {
    const ok = error instanceof CommunityError && (status === undefined || error.status === status);
    check(label, ok, error instanceof Error ? `${error.name}: ${error.message}` : error);
  }
}

async function user(name: string, extra: Record<string, unknown> = {}) {
  const u = await prisma.user.create({ data: { username: `${tag}${name}`.slice(0, 24), pointsFree: 500, ...extra } });
  userIds.push(u.id);
  return u;
}

async function main() {
  console.log("1. Encodage des textes (base WIN1252)");
  const sample = "Bravo ♞ ⛀ 🎉 « été » & co &#x41;";
  check("emoji, symboles et & : aller-retour sans perte", decodeFromDb(encodeForDb(sample)) === sample, encodeForDb(sample));

  const [alice, bob, carol, dave, eve] = [await user("alice"), await user("bob"), await user("carol"), await user("dave"), await user("eve")];
  const v = (u: { id: string }) => ({ id: u.id, isAdmin: false });

  console.log("2. Amitiés");
  const req = await sendFriendRequest(alice.id, bob.username);
  check("demande envoyée (en attente)", req.status === "PENDING");
  await rejects("pas de demande en double", () => sendFriendRequest(alice.id, bob.id), 409);
  await rejects("pas d'amitié avec soi-même", () => sendFriendRequest(alice.id, alice.id), 400);
  const incoming = await prisma.friendship.findFirstOrThrow({ where: { requesterId: alice.id, addresseeId: bob.id } });
  await rejects("seul le destinataire peut répondre", () => respondFriendRequest(alice.id, incoming.id, "accept"), 404);
  await respondFriendRequest(bob.id, incoming.id, "accept");
  check("acceptée : amis des deux côtés", (await areFriends(alice.id, bob.id)) && (await listFriends(bob.id)).some((f) => f.id === alice.id));
  const cross = await sendFriendRequest(carol.id, alice.id);
  const crossBack = await sendFriendRequest(alice.id, carol.id);
  check("demande croisée = acceptation automatique", cross.status === "PENDING" && crossBack.status === "ACCEPTED");
  await sendFriendRequest(dave.id, alice.id);
  const daveReq = await prisma.friendship.findFirstOrThrow({ where: { requesterId: dave.id, addresseeId: alice.id } });
  await respondFriendRequest(alice.id, daveReq.id, "decline");
  await rejects("après un refus, délai avant de redemander", () => sendFriendRequest(dave.id, alice.id), 429);
  await setFavorite(alice.id, bob.id, true);
  check("favori enregistré", (await listFriends(alice.id))[0]?.id === bob.id);
  await updateCommunityProfile(eve.id, { privacy: { friendRequests: "NOBODY" } });
  await rejects("confidentialité : demandes refusées par le joueur", () => sendFriendRequest(alice.id, eve.id), 403);

  console.log("3. Blocage");
  await sendFriendRequest(dave.id, carol.id);
  await blockUser(carol.id, dave.id);
  check("bloquer annule la demande en cours", (await prisma.friendship.findFirstOrThrow({ where: { requesterId: dave.id, addresseeId: carol.id } })).status === "CANCELLED");
  await rejects("un joueur bloqué ne peut plus demander en ami", () => sendFriendRequest(dave.id, carol.id), 403);

  console.log("4. Publications, commentaires, réactions");
  const post = await createPost(alice.id, { room: "dames", title: "Finale 🎯", body: "Quelle finale ! ⛀⛁ Coup de dame 🎉" });
  check("publication créée avec emojis", post.body === "Quelle finale ! ⛀⛁ Coup de dame 🎉" && post.title === "Finale 🎯" && post.room?.slug === "dames");
  await rejects("publication vide refusée", () => createPost(alice.id, { room: "dames", body: "  " }), 400);
  await rejects("salon Actualités réservé aux modérateurs", () => createPost(alice.id, { room: "actualites", body: "Annonce" }), 403);
  await rejects("image d'un autre joueur refusée", () => createPost(alice.id, { body: "img", imageUrl: `/uploads/community/${bob.id}_abc.png` }), 400);
  const edited = await updatePost(alice.id, post.id, { body: "Quelle finale (modifié)" });
  check("modification par l'auteur", edited.body === "Quelle finale (modifié)" && edited.editedAt !== null);
  await rejects("modification par un autre refusée", () => updatePost(bob.id, post.id, { body: "x" }), 403);

  await Promise.all([reactToPost(bob.id, post.id, "LIKE"), reactToPost(bob.id, post.id, "LIKE"), reactToPost(carol.id, post.id, "BRAVO")]);
  let fresh = await prisma.communityPost.findUniqueOrThrow({ where: { id: post.id } });
  check("réactions simultanées : une seule par joueur", fresh.reactionCount === 2, fresh.reactionCount);
  await reactToPost(bob.id, post.id, "INTERESTING");
  fresh = await prisma.communityPost.findUniqueOrThrow({ where: { id: post.id } });
  check("changer de réaction ne la duplique pas", fresh.reactionCount === 2);
  await reactToPost(bob.id, post.id, null);
  fresh = await prisma.communityPost.findUniqueOrThrow({ where: { id: post.id } });
  check("retirer sa réaction", fresh.reactionCount === 1);
  const carolPost = await createPost(carol.id, { room: "general", body: "Bonjour" });
  await rejects("un joueur bloqué ne peut pas réagir", () => reactToPost(dave.id, carolPost.id, "LIKE"), 403);
  await rejects("un joueur bloqué ne peut pas commenter", () => createComment(dave.id, carolPost.id, { body: "x" }), 403);

  const c1 = await createComment(bob.id, post.id, { body: "Superbe 👏" });
  const reply = await createComment(alice.id, post.id, { body: "Merci !", parentId: c1.id });
  const reply2 = await createComment(carol.id, post.id, { body: "Réponse à la réponse", parentId: reply.id });
  check("réponses rattachées au commentaire principal (un niveau)", reply.parentId === c1.id && reply2.parentId === c1.id);
  for (let i = 0; i < 12; i += 1) await createComment(carol.id, post.id, { body: `Commentaire ${i}` });
  const page1 = await listComments(v(alice), post.id, { limit: 10 });
  const page2 = await listComments(v(alice), post.id, { limit: 10, cursor: page1.nextCursor });
  check("commentaires paginés (10 + 3)", page1.items.length === 10 && page2.items.length === 3 && page2.nextCursor === null);
  const replies = await listComments(v(alice), post.id, { parentId: c1.id });
  check("réponses chargées à la demande", replies.items.length === 2);
  await reactToComment(alice.id, c1.id, "BRAVO");
  await reactToComment(alice.id, c1.id, "BRAVO");
  check("réaction sur commentaire unique", (await prisma.communityComment.findUniqueOrThrow({ where: { id: c1.id } })).reactionCount === 1);
  await rejects("suppression d'un commentaire d'autrui refusée", () => deleteComment(bob.id, reply.id), 403);
  await deleteComment(alice.id, reply.id);
  fresh = await prisma.communityPost.findUniqueOrThrow({ where: { id: post.id } });
  check("compteur de commentaires à jour", fresh.commentCount === 14, fresh.commentCount);

  console.log("5. Fil et confidentialité");
  for (let i = 0; i < 4; i += 1) await createPost(bob.id, { room: "general", body: `Message ${i} de Bob` });
  const feedAlice = await getFeed(v(alice), { limit: 3 });
  check("fil paginé", feedAlice.items.length === 3 && feedAlice.nextCursor !== null);
  const feedDave = await getFeed(v(dave), { author: alice.username, limit: 30 });
  check("contenus non bloqués visibles", feedDave.items.some((p) => p.id === post.id));
  const feedCarol = await getFeed(v(carol), { room: "general", limit: 30 });
  check("les publications d'un joueur bloqué sont masquées", !feedCarol.items.some((p) => p.author.id === dave.id));

  console.log("6. Notifications");
  const notes = await listNotifications(alice.id);
  check("notifications reçues (amitié, réactions, commentaires)", ["FRIEND_REQUEST", "POST_REACTION", "POST_COMMENT"].every((t) => notes.items.some((n) => n.type === t)), notes.items.map((n) => n.type));
  check("notification avec lien vers la ressource", notes.items.every((n) => n.link?.startsWith("/")));
  await savePreferences(alice.id, ["POST_REACTION"]);
  const before = await prisma.notification.count({ where: { userId: alice.id, type: "POST_REACTION" } });
  await reactToPost(eve.id, post.id, "LIKE");
  check("préférence respectée (réactions coupées)", (await prisma.notification.count({ where: { userId: alice.id, type: "POST_REACTION" } })) === before);
  await markRead(alice.id, "all");
  check("tout marquer comme lu", (await unreadCount(alice.id)) === 0);

  console.log("7. Défis entre amis");
  await rejects("défi refusé à un non-ami", () => createChallenge(alice.id, { to: dave.id, gameType: "CHESS" }), 403);
  await rejects("défi en points argent refusé sans consentement", () => createChallenge(alice.id, { to: bob.id, gameType: "CHESS", mode: "MONEY", stake: 100 }), 400);
  const walletBefore = (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).walletReal.toString();
  await rejects("mode rémunéré fermé : aucun défi argent", () => createChallenge(alice.id, { to: bob.id, gameType: "CHESS", mode: "MONEY", stake: 100, moneyConsent: true }), 403);
  check("aucun débit d'argent", (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).walletReal.toString() === walletBefore);
  const ch = await createChallenge(alice.id, { to: bob.id, gameType: "CHECKERS", draughtsVariant: "INTERNATIONAL", timeControlMinutes: 5, mode: "CASUAL", color: "white", message: "Revanche ? ⚔️" });
  await rejects("pas de second défi en attente vers le même ami", () => createChallenge(alice.id, { to: bob.id, gameType: "CHESS" }), 409);
  check("défi reçu par le destinataire", (await listChallenges(bob.id)).some((c) => c.id === ch.id && c.direction === "RECEIVED" && c.message === "Revanche ? ⚔️"));
  const accepted = await respondChallenge(bob.id, ch.id, "accept");
  const match = await prisma.match.findUniqueOrThrow({ where: { id: accepted.matchId! } });
  check(
    "acceptation : partie créée par le moteur existant (couleur, variante, cadence, mode)",
    match.status === "IN_PROGRESS" && match.playerWhiteId === alice.id && match.draughtsVariant === "INTERNATIONAL" && match.timeControlMinutes === 5 && match.mode === "CASUAL",
  );
  await rejects("un défi accepté ne peut pas l'être deux fois", () => respondChallenge(bob.id, ch.id, "accept"), 409);
  await prisma.match.update({ where: { id: match.id }, data: { status: "ABORTED" } });
  check("défi terminé quand la partie est finie", (await listChallenges(alice.id)).find((c) => c.id === ch.id)?.status === "COMPLETED");

  const ch2 = await createChallenge(carol.id, { to: alice.id, gameType: "CHESS" });
  await prisma.friendChallenge.update({ where: { id: ch2.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await expireChallenges();
  check("défi sans réponse : expiré", (await prisma.friendChallenge.findUniqueOrThrow({ where: { id: ch2.id } })).status === "EXPIRED");
  await rejects("un défi expiré ne peut plus être accepté", () => respondChallenge(alice.id, ch2.id, "accept"), 409);
  const ch3 = await createChallenge(carol.id, { to: alice.id, gameType: "CHESS" });
  await cancelChallenge(carol.id, ch3.id);
  const ch4 = await createChallenge(carol.id, { to: alice.id, gameType: "CHESS" });
  await respondChallenge(alice.id, ch4.id, "decline");
  check("défis annulé et refusé", (await prisma.friendChallenge.findMany({ where: { id: { in: [ch3.id, ch4.id] } } })).map((c) => c.status).sort().join() === "CANCELLED,DECLINED");

  console.log("8. Invitations aux tournois et aux clubs");
  const tournament = await createTournament({
    creatorId: carol.id, name: `${tag} invit`, type: TournamentType.SWISS, scope: "CITY", gameType: "CHECKERS", draughtsVariant: "INTERNATIONAL",
    isPaid: false, entryFeeCfa: 0, entryPoints: 10, maxPlayers: 8, betMode: "FIXED", rebuyEnabled: false,
  });
  tournamentIds.push(tournament.id);
  const sent = await inviteFriendsToTournament(alice.id, tournament.id, [bob.id, dave.id, carol.id]);
  check("invitation aux amis seulement (non-amis ignorés, inscrits déjà comptés)", sent.invited === 1 && sent.alreadyRegistered === 1, sent);
  const bobInv = (await listMyInvitations(bob.id)).tournaments.find((i) => i.tournament.id === tournament.id);
  check("invitation visible par l'invité", !!bobInv && bobInv.invitedBy === alice.username);
  await respondTournamentInvite(bob.id, bobInv!.id, true);
  const reg = await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId: tournament.id, userId: bob.id } } });
  const bobPoints = (await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).pointsFree;
  check("accepter = inscription par le service habituel (droit d'entrée débité)", !!reg && bobPoints === 490, bobPoints);
  const privateT = await createTournament({
    creatorId: carol.id, name: `${tag} privé`, type: TournamentType.SWISS, scope: "CITY", gameType: "CHESS",
    draughtsVariant: "INTERNATIONAL", isPaid: false, entryFeeCfa: 0, entryPoints: 5, maxPlayers: 8, betMode: "FIXED", rebuyEnabled: false, visibility: "PRIVATE",
  }).catch((error: unknown) => {
    console.error("    (création du tournoi privé)", error instanceof Error ? error.message : error);
    return null;
  });
  check("tournoi privé créé pour le test", privateT !== null);
  if (privateT) {
    tournamentIds.push(privateT.id);
    await rejects("tournoi privé : seul l'organisateur invite", () => inviteFriendsToTournament(alice.id, privateT.id, [bob.id]), 403);
  }
  const club = await prisma.club.create({ data: { name: `${tag} club`, slug: `${tag}-club`, ownerId: alice.id, maxMembers: 10, members: { create: { userId: alice.id, role: "OWNER" } } } });
  clubIds.push(club.id);
  await inviteFriendsToClub(alice.id, club.slug, [bob.id]);
  const clubInv = (await listMyInvitations(bob.id)).clubs[0]!;
  await respondClubInvite(bob.id, clubInv.id, true);
  check("invitation au club acceptée : membre", !!(await prisma.clubMember.findUnique({ where: { clubId_userId: { clubId: club.id, userId: bob.id } } })));
  const clubPost = await createPost(bob.id, { club: club.slug, body: "Entraînement samedi" });
  await rejects("publication de club réservée aux membres", () => createPost(carol.id, { club: club.slug, body: "Je ne suis pas membre" }), 403);
  await rejects("épingler (club) : Premium requis pour le responsable gratuit", () => setPinned(alice.id, clubPost.id, true), 403);

  console.log("9. Premium : salons privés");
  await rejects("salon privé refusé au niveau gratuit", () => createPrivateRoom(alice.id, { name: `${tag} salon` }), 403);
  await prisma.user.update({ where: { id: alice.id }, data: { isPremium: true, premiumLevel: 2 } });
  const room = await createPrivateRoom(alice.id, { name: `${tag} salon` });
  roomIds.push(room.id);
  check("salon privé créé au niveau Argent", room.visibility === "PRIVATE");
  await rejects("limite de salons du niveau", () => createPrivateRoom(alice.id, { name: `${tag} salon2` }), 403);
  check("salon privé invisible pour un non-membre", !(await listRooms(v(bob))).some((r) => r.id === room.id));
  await rejects("salon privé : adhésion libre refusée", () => setRoomMembership(bob.id, room.slug, "join"), 403);
  await setPinned(alice.id, clubPost.id, true);
  check("épingler dans son club avec le privilège Premium", (await prisma.communityPost.findUniqueOrThrow({ where: { id: clubPost.id } })).isPinned);

  console.log("10. Modération");
  const spam = await createPost(dave.id, { room: "general", body: "SPAM SPAM" });
  await reportContent(alice.id, { targetType: "POST", targetId: spam.id, reason: "SPAM" });
  await rejects("un seul signalement par joueur et par contenu", () => reportContent(alice.id, { targetType: "POST", targetId: spam.id, reason: "SPAM" }), 409);
  const report = (await listReports("OPEN")).find((r) => r.post?.id === spam.id);
  check("signalement visible dans l'espace de modération", !!report);
  const admin = await user("admin", { isAdmin: true });
  await resolveReport(admin.id, report!.id, "HIDE", "Spam");
  check("contenu masqué par la modération", (await prisma.communityPost.findUniqueOrThrow({ where: { id: spam.id } })).isHidden);
  check("masqué : absent du fil des autres", !(await getFeed(v(bob), { room: "general", limit: 30 })).items.some((p) => p.id === spam.id));
  check("sanction tracée dans l'audit", (await prisma.auditLog.count({ where: { action: "COMMUNITY_REPORT_HIDE", entityId: spam.id } })) === 1);
  const sanction = await issueSanction(admin.id, { userId: dave.id, type: "MUTE", reason: "Spam répété", durationHours: 24 });
  await rejects("restriction temporaire : publication impossible", () => createPost(dave.id, { body: "encore" }), 403);
  check("le joueur est informé de la sanction", (await prisma.notification.count({ where: { userId: dave.id, type: "MODERATION" } })) >= 1);
  await revokeSanction(admin.id, sanction.id);
  const after = await createPost(dave.id, { room: "general", body: "Pardon" });
  check("sanction levée : publication possible", !!after.id);
  await deletePost(admin.id, after.id);
  check("suppression par un administrateur", (await prisma.communityPost.findUniqueOrThrow({ where: { id: after.id } })).deletedAt !== null);

  console.log("11. Profil public");
  const profile = await getPublicProfile(alice.username, v(bob));
  check("profil : compteurs communautaires", profile.community.posts >= 1 && (profile.community.friends ?? 0) >= 2 && profile.relationship.status === "FRIENDS");
  check("profil : badge Premium", profile.badges.some((b) => b.id === "premium"));
  await updateCommunityProfile(alice.id, { bio: "Joueuse de dames 🎯", privacy: { showRatings: false } });
  const hidden = await getPublicProfile(alice.username, v(bob));
  check("confidentialité : classement masqué aux autres", hidden.ratings === null && hidden.bio === "Joueuse de dames 🎯");
  check("le joueur voit tout sur son propre profil", (await getPublicProfile(alice.username, v(alice))).ratings !== null);
  await rejects("profil invisible pour un joueur bloqué", () => getPublicProfile(carol.username, v(dave)), 404);
  await removeFriend(alice.id, bob.id);
  check("retirer un ami", !(await areFriends(alice.id, bob.id)));

  console.log("12. Images : compression puis sauvegarde dans le stockage configuré");
  {
    const w = 2400, h = 1600, raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3, g = ((x * 13 + y * 7) % 11) - 5;
      raw[i] = 120 + 80 * Math.sin(x / 90) + g; raw[i + 1] = 120 + 80 * Math.cos(y / 70) + g; raw[i + 2] = 140 + 50 * Math.sin((x - y) / 160) + g;
    }
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const url = await saveImage(new File([new Uint8Array(png)], "photo.png", { type: "image/png" }), { kind: "post", prefix: alice.id, maxBytes: 20 * 1024 * 1024 });
    const key = keyFromUrl(await storageConfig(), url);
    const stored = key ? await readLocalObject(key) : null;
    check("image enregistrée en WebP dans le stockage", !!stored && detectImageType(stored) === "webp", url);
    const meta = stored ? await sharp(stored).metadata() : null;
    check(`compressée : ${Math.round(png.length / 1024)} Ko → ${Math.round((stored?.length ?? 0) / 1024)} Ko, ${meta?.width}×${meta?.height}`, !!stored && stored.length < png.length / 10 && meta?.width === 1600);
    const withImage = await createPost(alice.id, { room: "general", body: "Ma position préférée", imageUrl: url });
    check("publication avec l'image compressée", withImage.imageUrl === url);
    await rejects("l'image d'un autre joueur reste refusée", () => createPost(bob.id, { room: "general", body: "vol", imageUrl: url }), 400);
    await rejects("adresse étrangère refusée", () => createPost(alice.id, { room: "general", body: "x y", imageUrl: "https://ailleurs.com/a.webp" }), 400);
    await deleteByUrl(url);
    check("suppression du fichier", key !== null && (await readLocalObject(key)) === null);
  }

  console.log("13. Rencontre interclubs");
  {
    const clubA = await prisma.club.findUniqueOrThrow({ where: { id: clubIds[0]! } });
    await prisma.clubMember.create({ data: { clubId: clubA.id, userId: carol.id } });
    const clubB = await prisma.club.create({ data: { name: `${tag} club B`, slug: `${tag}-club-b`, ownerId: dave.id, maxMembers: 10, members: { create: [{ userId: dave.id, role: "OWNER" }, { userId: eve.id }] } } });
    clubIds.push(clubB.id);
    await rejects("lancer une rencontre exige le privilège Premium (fondateur gratuit)", () => proposeClubMatch(dave.id, { homeClub: clubB.slug, awayClub: clubA.slug, boards: 2, gameType: "CHESS" }), 403);
    await rejects("un simple membre ne lance pas de rencontre", () => proposeClubMatch(carol.id, { homeClub: clubA.slug, awayClub: clubB.slug, boards: 2, gameType: "CHESS" }), 403);
    const { id } = await proposeClubMatch(alice.id, { homeClub: clubA.slug, awayClub: clubB.slug, boards: 2, gameType: "CHECKERS", draughtsVariant: "INTERNATIONAL", timeControlMinutes: 5, mode: "CASUAL" });
    await rejects("pas deux rencontres simultanées entre les mêmes clubs", () => proposeClubMatch(alice.id, { homeClub: clubA.slug, awayClub: clubB.slug, boards: 1, gameType: "CHESS" }), 409);
    check("le club défié est notifié", (await prisma.notification.count({ where: { userId: dave.id, type: "CLUB_MATCH" } })) === 1);
    await rejects("seul le club défié répond", () => respondClubMatch(alice.id, id, true), 403);
    await respondClubMatch(dave.id, id, true);
    await rejects("composition : membres du club uniquement", () => setLineup(alice.id, id, "HOME", [alice.id, eve.id]), 400);
    await setLineup(alice.id, id, "HOME", [alice.id, carol.id]);
    await setLineup(dave.id, id, "AWAY", [dave.id, eve.id]);
    let view = await getClubMatch(id, { id: alice.id, isAdmin: false });
    check("les deux équipes composées : rencontre en cours", view.status === "IN_PROGRESS" && view.boardList.every((b) => b.home && b.away));
    const [b1, b2] = view.boardList;
    await rejects("seuls les joueurs de l'échiquier lancent la partie", () => startBoardGame(carol.id, b1!.id), 403);
    const g1 = await startBoardGame(alice.id, b1!.id);
    const again = await startBoardGame(dave.id, b1!.id);
    check("même partie pour les deux joueurs", g1.matchId === again.matchId);
    const m1 = await prisma.match.findUniqueOrThrow({ where: { id: g1.matchId } });
    check("échiquier 1 : le club recevant a les blancs, partie ordinaire", m1.playerWhiteId === alice.id && m1.playerBlackId === dave.id && m1.mode === "CASUAL" && m1.timeControlMinutes === 5);
    await prisma.match.update({ where: { id: g1.matchId }, data: { status: "FINISHED", winnerId: alice.id } });
    const g2 = await startBoardGame(eve.id, b2!.id);
    const m2 = await prisma.match.findUniqueOrThrow({ where: { id: g2.matchId } });
    check("échiquier 2 : couleurs inversées", m2.playerWhiteId === eve.id);
    await prisma.match.update({ where: { id: g2.matchId }, data: { status: "ABORTED" } });
    view = await getClubMatch(id, null);
    check("partie annulée : l'échiquier redevient jouable", view.boardList[1]!.matchId === null && view.boardList[1]!.result === null && view.home.score === 1);
    const g3 = await startBoardGame(carol.id, b2!.id);
    await prisma.match.update({ where: { id: g3.matchId }, data: { status: "FINISHED", winnerId: null } });
    view = await getClubMatch(id, null);
    check("rencontre terminée 1,5 – 0,5, victoire du club A", view.status === "COMPLETED" && view.home.score === 1.5 && view.away.score === 0.5 && view.winnerClubId === clubA.id);
    const table = await interclubStandings();
    const rowA = table.find((r) => r.clubId === clubA.id);
    const rowB = table.find((r) => r.clubId === clubB.id);
    check("classement interclubs : 2 pts au vainqueur, 0 au perdant", rowA?.points === 2 && rowB?.points === 0 && rowA.rank < rowB!.rank);
  }
}

main()
  .catch((error) => {
    failures += 1;
    console.error("Erreur inattendue :", error);
  })
  .finally(async () => {
    const matchIds = (
      await prisma.match.findMany({ where: { OR: [{ playerWhiteId: { in: userIds } }, { playerBlackId: { in: userIds } }] }, select: { id: true } })
    ).map((m) => m.id);
    await prisma.friendChallenge.deleteMany({ where: { challengerId: { in: userIds } } });
    await prisma.matchResult.deleteMany({ where: { matchId: { in: matchIds } } });
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    await prisma.communityRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.communityPost.deleteMany({ where: { authorId: { in: userIds } } });
    await prisma.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
    await prisma.club.deleteMany({ where: { id: { in: clubIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nTous les contrôles communautaires sont passés." : `\n${failures} contrôle(s) en échec.`);
    process.exit(failures === 0 ? 0 : 1);
  });
