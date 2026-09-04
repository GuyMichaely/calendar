const CACHE = "calendar-shell-v12";
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
      .catch(async (error) => {
        const cached = await caches.match(event.request);
        if (cached) return cached;

        const url = new URL(event.request.url);
        const frameworkNavigation = url.pathname.includes("/framework/");
        if (event.request.mode === "navigate" && !frameworkNavigation) {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }
        throw error;
      }),
  );
});
