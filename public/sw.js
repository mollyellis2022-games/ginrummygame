
const CACHE_VERSION = "v1";
const STATIC_CACHE = `static-${CACHE_VERSION}`;

// Keep this list small  important. Runtime cache will pick up the rest.
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/css/style.css",
  "/css/animations.css",
  "/css/deck-discard.css",
  "/js/main.js",
  "/manifest.json",
  "/assets/card-back-classic.webp",
  "/assets/card-back-classic.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("static-") && k !== STATIC_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET; ignore ws and any non-idempotent requests.
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only same-origin caching.
  if (url.origin !== self.location.origin) return;

  const accept = req.headers.get("accept") || "";
  const isNavigation = req.mode === "navigate" || accept.includes("text/html");
  const isStaticAsset =
    accept.includes("image/") ||
    accept.includes("text/css") ||
    accept.includes("application/javascript") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".json");

  // Navigation: network-first, fallback to cached index.html (offline friendly)
  if (isNavigation) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(req);
          return cached || caches.match("/index.html");
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first, then network  populate cache.
  if (isStaticAsset) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fresh = await fetch(req);
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      })(),
    );
  }
});
