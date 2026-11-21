// Offline for the built site: what the page has loaded is kept, and served from the phone when
// there is no network. The page (index.html) comes from the network when there is one, so a new
// version shows up at once; its hashed files never change, so the kept copy is always right.
const CACHE = "chimera-mic-v1";
const INDEX = self.registration.scope;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// the page lists what it loaded: keep whatever isn't kept yet
self.addEventListener("message", (e) => {
  const urls = e.data && e.data.keep;
  if (!Array.isArray(urls)) return;
  e.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      for (const u of urls) {
        try {
          if (!(await cache.match(u))) await cache.add(u);
        } catch {
          // one file that can't be fetched now is fetched another time
        }
      }
    }),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === "navigate") {
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(INDEX, res.clone());
          return res;
        } catch {
          return (await cache.match(INDEX)) || Response.error();
        }
      }
      const kept = await cache.match(req);
      if (kept) return kept;
      const res = await fetch(req);
      if (res.ok && res.status === 200) cache.put(req, res.clone());
      return res;
    })(),
  );
});
