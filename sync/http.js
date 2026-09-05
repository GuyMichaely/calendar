import { mergeSnapshotBytes } from "./automerge-document.js";

export const AUTOMERGE_MEDIA_TYPE = "application/vnd.automerge";

function copyBytes(value) {
  return value == null ? null : new Uint8Array(value);
}

export function createMemoryDocumentStore(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, copyBytes(value)]));
  const tails = new Map();

  return {
    async get(key) {
      return copyBytes(values.get(key) || null);
    },

    async update(key, updater) {
      if (typeof updater !== "function") throw new Error("Document store update requires a function.");
      const previous = tails.get(key) || Promise.resolve();
      let finish;
      const tail = new Promise((resolve) => { finish = resolve; });
      tails.set(key, previous.catch(() => {}).then(() => tail));

      await previous.catch(() => {});
      try {
        const current = copyBytes(values.get(key) || null);
        const outcome = await updater(current);
        if (!outcome || !(outcome.value instanceof Uint8Array)) {
          throw new Error("Document store updater must return { value: Uint8Array, result }.");
        }
        values.set(key, copyBytes(outcome.value));
        return outcome.result;
      } finally {
        finish();
      }
    },
  };
}

function normalizeBasePath(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "/") return "";
  const prefixed = raw.startsWith("/") ? raw : `/${raw}`;
  return prefixed.replace(/\/+$/u, "");
}

function syncPath(basePath) {
  return `${normalizeBasePath(basePath)}/sync` || "/sync";
}

function mediaType(request) {
  return (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
}

export function createSyncHandler({
  authenticate,
  documentStore,
  documentKey = "calendar:primary",
  basePath = "",
}) {
  if (typeof authenticate !== "function") throw new Error("Sync requires an authenticate(request) function.");
  if (!documentStore?.update) throw new Error("Sync requires a document store with atomic update(key, fn).");
  const endpointPath = syncPath(basePath);

  return async function handleSync(request) {
    const url = new URL(request.url);
    if (url.pathname !== endpointPath) return new Response("Not found", { status: 404 });
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
    }

    const session = await authenticate(request);
    if (!session) return new Response("Unauthorized", { status: 401 });
    if (mediaType(request) !== AUTOMERGE_MEDIA_TYPE) {
      return new Response(`Content-Type must be ${AUTOMERGE_MEDIA_TYPE}`, { status: 415 });
    }

    const incoming = new Uint8Array(await request.arrayBuffer());
    if (!incoming.byteLength) return new Response("Sync document is empty", { status: 400 });

    try {
      const responseBytes = await documentStore.update(documentKey, async (storedBytes) => {
        const merged = mergeSnapshotBytes(storedBytes, incoming);
        return { value: merged.storedBytes, result: merged.responseBytes };
      });
      return new Response(responseBytes, {
        status: 200,
        headers: {
          "content-type": AUTOMERGE_MEDIA_TYPE,
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError || /Automerge|calendar sync schema|Incoming Automerge/u.test(String(error?.message))) {
        return new Response("Invalid sync document", { status: 400 });
      }
      console.error("Calendar sync failed", error);
      return new Response("Sync failed", { status: 500 });
    }
  };
}
