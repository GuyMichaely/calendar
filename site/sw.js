const CACHE_VERSION = "v12";
const CACHE_NAMESPACE = `calendar-shell:${new URL(self.registration.scope).pathname}`;
const CACHE = `${CACHE_NAMESPACE}:${CACHE_VERSION}`;
const LEGACY_CACHES = new Set(["calendar-shell-v11"]);
const PREVIEW_PATHS = ["vanilla/", "framework/"].map((segment) => new URL(segment, self.registration.scope).pathname);
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./editor-fixes.css",
  "./task-view.css",
  "./sleep-view.css",
  "./keyboard.css",
  "./interactions.css",
  "./app.js",
  "./editor-behavior.js",
  "./keyboard.js",
  "./calendar-projection.js",
  "./toast-history.js",
  "./modal-events.js",
  "./calendar-ui.js",
  "./task-enhancements.js",
  "./domain.js",
  "./storage.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith(`${CACHE_NAMESPACE}:`) && key !== CACHE) || LEGACY_CACHES.has(key),
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && PREVIEW_PATHS.some((path) => url.pathname.startsWith(path))) return;

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      fetch(event.request)
        .then((response) => {
          cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cache.match(event.request).then((cached) => cached || cache.match("./index.html"))),
    ),
  );
});
