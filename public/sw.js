const CACHE_NAME = "gr-v1";
const STATIC_CACHE = `static-${CACHE_NAME}`;

// Keep this list small  important. Runtime cache will pick up the rest.
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/main.js",
  "/manifest.json",
  "/assets/icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Cache sequentially so we can pinpoint failures
      for (const url of PRECACHE_URLS) {
        try {
          const res = await fetch(url, { cache: "reload" });
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          await cache.put(url, res);
        } catch (err) {
          console.error("[SW] Failed to precache:", url, err);
        }
      }

      // Optional: ensure SW activates even if some assets failed
      self.skipWaiting();
    })(),
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
