const CACHE_NAME = "audit-tool-v9";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/utils.js",
  "./js/storage.js",
  "./js/scanner.js",
  "./js/masterlist.js",
  "./js/taglookup.js",
  "./js/audit.js",
  "./js/sync.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Only manage caching for our own files. Cross-origin requests (the Google
  // Sheet sync, the camera-scanning CDN script) pass straight through — we
  // never want the Sheet's live data served from a stale cache.
  if (new URL(req.url).origin !== self.location.origin) return;

  // Cache-first app shell — everything else changes only on a new deploy.
  event.respondWith(
    caches.match(req).then((cached) => {
      return (
        cached ||
        fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            return res;
          })
          .catch(() => cached)
      );
    })
  );
});
