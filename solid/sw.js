// The calendar's offline copy. It opens from the files cached here, online or not, and the browser
// checks this script on each visit: a deploy changes the list below, so the new version installs
// in the background, fetching only the files it doesn't have, and the next launch uses it. Sync
// (sync/…) and Access (/cdn-cgi/…) always go to the network. The build fills in FILES (vite.config.ts).
const FILES = self.__FILES__;
const CACHE = "calendar-app";
const scope = new URL(self.registration.scope);
const urls = ["./", ...FILES].map(file => new URL(file, scope).href);
// Sync, and Cloudflare Access's own pages (signing in comes back through /cdn-cgi/access/), are the server's.
const isServer = url => url.pathname.startsWith(`${scope.pathname}sync`) || url.pathname.startsWith("/cdn-cgi/");

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Hashed files don't change, so ones already cached are kept; the app's page is always fetched.
    for (const url of urls) {
      if (url !== scope.href && await cache.match(url)) continue;
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Could not cache ${url} (${response.status})`);
      await cache.put(url, response);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const keep = new Set(urls);
    for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname) || isServer(url)) return;
  // Every page in scope is the app (its routes are in the hash).
  const key = event.request.mode === "navigate" ? scope.href : url.href;
  event.respondWith(caches.match(key).then(cached => cached || fetch(event.request)));
});
