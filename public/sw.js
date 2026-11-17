/*
 * Service worker de Thot Stratégie.
 *
 * Stratégie volontairement prudente :
 *  - JAMAIS de cache pour l'API, le temps réel (socket.io), les pages HTML,
 *    le portefeuille ou toute réponse liée à la session : ces données doivent
 *    toujours venir du serveur ;
 *  - cache « d'abord » uniquement pour les fichiers statiques versionnés
 *    (/_next/static/…, dont le nom change à chaque version) et les icônes ;
 *  - hors connexion, une navigation affiche une page explicative : le jeu en
 *    ligne nécessite une connexion, rien n'est simulé.
 */

const VERSION = "thot-v1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)));
  // Pas de skipWaiting automatique : la nouvelle version attend que le joueur
  // accepte de recharger (jamais pendant une partie).
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"))
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    // Réseau uniquement ; page hors connexion si le serveur est injoignable.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok && response.type === "basic") {
              const copy = response.clone();
              void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
  // Tout le reste (API, socket.io, /media, pages) : comportement normal du navigateur.
});
