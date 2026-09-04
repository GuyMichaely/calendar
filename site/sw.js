importScripts("./sw-shell.js");

const CACHE_VERSION = "v12";
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const CACHE_NAMESPACE = `calendar-shell:${SCOPE_PATH}`;
const CACHE = `${CACHE_NAMESPACE}:${CACHE_VERSION}`;
const IS_PREVIEW_SCOPE = /\/(?:vanilla|framework)\/$/.test(SCOPE_PATH);
const LEGACY_CACHES = IS_PREVIEW_SCOPE ? new Set() : new Set(["calendar-shell-v11"]);
const PREVIEW_PATHS = IS_PREVIEW_SCOPE
  ? []
  : ["vanilla/", "framework/"].map((segment) => new URL(segment, self.registration.scope).pathname);
const SHELL = Array.isArray(self.CALENDAR_SHELL) ? self.CALENDAR_SHELL : [];

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
