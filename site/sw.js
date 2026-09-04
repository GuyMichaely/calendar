const CACHE = "calendar-shell-v9";
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
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))),
  );
});
