const CACHE_NAME = "gr-static-v16"; // 👈 bump this when you deploy changes

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

      // Cache sequentially so one bad file doesn't brick install
      for (const url of PRECACHE_URLS) {
        try {
          const res = await fetch(new Request(url, { cache: "reload" }));
          if (res.ok) await cache.put(url, res);
        } catch (e) {
          // don't fail install
          console.warn("[SW] precache skipped:", url, e);
        }
      }

      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))),
      );
      await self.clients.claim();

      // Tell all open tabs to reload once the new SW is active
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) client.postMessage({ type: "SW_UPDATED" });
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  // ✅ Network-first for navigations (fixes "unstyled after login")
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put("/index.html", res.clone());
          return res;
        } catch {
          const cached = await caches.match("/index.html");
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // ✅ Stale-while-revalidate for static assets
  const isStatic =
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".woff2");

  if (isStatic) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);

        const fetchPromise = fetch(req)
          .then((res) => {
            // Only cache successful, correct-type responses
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);

        return cached || (await fetchPromise) || Response.error();
      })(),
    );
  }
});
