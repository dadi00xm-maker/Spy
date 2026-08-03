/* Service worker : mise en cache de l'application pour jouer hors ligne. */
var CACHE = 'spy-v26';
var ASSETS = [
  './',
  './index.html',
  './tv.html',
  './css/style.css',
  './js/rules.js',
  './js/i18n.js',
  './js/firebase-config.js',
  './js/net.js',
  './js/cast.js',
  './js/online.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Réseau d'abord (les mises à jour arrivent dès le rechargement),
   cache en secours (le jeu reste jouable hors ligne).
   Le service worker ne touche QUE les fichiers du jeu : tout ce qui est
   externe (SDK Firebase, synchronisation temps réel des salons) part
   directement au réseau, sans interception ni mise en cache. */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
