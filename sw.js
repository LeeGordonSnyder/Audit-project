const CACHE_NAME = "audit-tool-v4";
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
  "./js/adjustments.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./data/product-master-seed.txt",
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

  // Network-first for the preloaded catalog, so a newly pushed seed file
  // reaches devices as soon as they have a signal, not just on reinstall.
  if (req.url.includes("data/product-master-seed.txt")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

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
