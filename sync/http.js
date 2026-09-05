import { mergeSnapshotBytes } from "./automerge-document.js";

export const AUTOMERGE_MEDIA_TYPE = "application/vnd.automerge";
const DEFAULT_MAX_SYNC_BYTES = 5 * 1024 * 1024;

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

function contentLength(request) {
  const raw = request.headers.get("content-length");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function mediaType(request) {
  return (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
}

async function readRequestBytes(request, maxBytes) {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel("Sync document is too large").catch(() => {});
        return null;
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createSyncHandler({
  authenticate,
  documentStore,
  documentKey = "calendar:primary",
  maxSyncBytes = DEFAULT_MAX_SYNC_BYTES,
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

    const declaredLength = contentLength(request);
    if (declaredLength != null && declaredLength > maxSyncBytes) {
      return new Response("Sync document is too large", { status: 413 });
    }

    const incoming = await readRequestBytes(request, maxSyncBytes);
    if (incoming == null) return new Response("Sync document is too large", { status: 413 });
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
