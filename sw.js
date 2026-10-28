// Bump CACHE_VERSION on every shipped change (and the header version in index.html).
const CACHE_PREFIX = "ops2-";
const CACHE_VERSION = 10;
const CACHE_NAME = `${CACHE_PREFIX}v${CACHE_VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./css/app.css",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./js/vendor/html5-qrcode.min.js",
  "./js/core/utils.js",
  "./js/core/store.js",
  "./js/core/api.js",
  "./js/core/data.js",
  "./js/core/ui.js",
  "./js/core/scanner.js",
  "./js/core/exceptions.js",
  "./js/core/router.js",
  "./js/modules/login.js",
  "./js/modules/settings.js",
  "./js/modules/home.js",
  "./js/modules/catalog.js",
  "./js/modules/counts.js",
  "./js/modules/consol.js",
  "./js/modules/receiving.js",
  "./js/modules/floor.js",
  "./js/app.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // "reload" skips the browser's HTTP cache, so an update never caches a
    // stale copy of a file next to fresh ones.
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

// Only ever clean up this app's own old caches. The original app may be
// served from the same origin, and Cache Storage is shared per origin —
// deleting anything outside the "ops2-" prefix would break it offline.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Never cache the sheet (cross-origin) — live data only.
  if (new URL(req.url).origin !== self.location.origin) return;

  // Cache-first app shell. The original app's worker deletes every cache
  // that isn't its own when it updates, so a miss here re-fetches and
  // re-caches instead of assuming the cache is intact.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(req).then(
        (cached) =>
          cached ||
          fetch(req)
            .then((res) => {
              if (res.ok) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached)
      )
    )
  );
});
