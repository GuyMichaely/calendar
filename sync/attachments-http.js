const DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function copyBytes(value) {
  return value == null ? null : new Uint8Array(value);
}

export function createMemoryBlobStore(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, {
    bytes: copyBytes(value.bytes),
    contentType: value.contentType || "application/octet-stream",
  }]));
  return {
    async get(key) {
      const value = values.get(key);
      return value ? { bytes: copyBytes(value.bytes), contentType: value.contentType } : null;
    },
    async putIfAbsent(key, value) {
      if (values.has(key)) return false;
      values.set(key, {
        bytes: copyBytes(value.bytes),
        contentType: value.contentType || "application/octet-stream",
      });
      return true;
    },
  };
}

function normalizeBasePath(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "/") return "";
  const prefixed = raw.startsWith("/") ? raw : `/${raw}`;
  return prefixed.replace(/\/+$/u, "");
}

function attachmentId(pathname, basePath) {
  const prefix = `${normalizeBasePath(basePath)}/attachments/`;
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length);
  if (!encoded || encoded.includes("/")) return null;
  let id;
  try {
    id = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/u.test(id)) return null;
  return id;
}

function contentLength(request) {
  const raw = request.headers.get("content-length");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readBytes(request, maxBytes) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += bytes.byteLength;
      if (total > maxBytes) {
        await reader.cancel("Attachment is too large").catch(() => {});
        return null;
      }
      chunks.push(bytes);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function createAttachmentHandler({
  authenticate,
  blobStore,
  maxAttachmentBytes = DEFAULT_MAX_ATTACHMENT_BYTES,
  basePath = "",
}) {
  if (typeof authenticate !== "function") throw new Error("Attachment service requires authenticate(request).");
  if (!blobStore?.get || !blobStore?.putIfAbsent) throw new Error("Attachment service requires get and putIfAbsent blob storage.");

  return async function handleAttachment(request) {
    const url = new URL(request.url);
    const id = attachmentId(url.pathname, basePath);
    if (!id) return new Response("Not found", { status: 404 });
    if (!["GET", "HEAD", "PUT"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD, PUT" } });
    }

    const session = await authenticate(request);
    if (!session) return new Response("Unauthorized", { status: 401 });

    if (request.method === "GET" || request.method === "HEAD") {
      const stored = await blobStore.get(id);
      if (!stored) return new Response("Not found", { status: 404 });
      const headers = {
        "content-type": stored.contentType || "application/octet-stream",
        "content-length": String(stored.bytes.byteLength),
        "cache-control": "private, max-age=31536000, immutable",
      };
      return new Response(request.method === "HEAD" ? null : stored.bytes, { status: 200, headers });
    }

    const declaredLength = contentLength(request);
    if (declaredLength != null && declaredLength > maxAttachmentBytes) {
      return new Response("Attachment is too large", { status: 413 });
    }
    const bytes = await readBytes(request, maxAttachmentBytes);
    if (bytes == null) return new Response("Attachment is too large", { status: 413 });
    if (!bytes.byteLength) return new Response("Attachment is empty", { status: 400 });
    await blobStore.putIfAbsent(id, {
      bytes,
      contentType: request.headers.get("content-type") || "application/octet-stream",
    });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  };
}
