
const CACHE_VERSION = "v2026-01-20-1";
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

      // Tell open pages to reload (so they pick up new cached JS/CSS)
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.postMessage({ type: "SW_ACTIVATED" });
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only same-origin
  if (url.origin !== self.location.origin) return;

  const accept = req.headers.get("accept") || "";
  const isNavigation = req.mode === "navigate" || accept.includes("text/html");

  const isStaticAsset =
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".json") ||
    url.pathname.endsWith(".ico");

  // Handle navigations (HTML) only
  if (isNavigation) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          // Try exact match, then fallback to index
          const cached = await caches.match(req);
          return cached || (await caches.match("/index.html"));
        }
      })(),
    );
    return;
  }

  // Handle static assets only
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
    return;
  }

  // Everything else: do not intercept (prevents "no-op" overhead)
  return;
});
