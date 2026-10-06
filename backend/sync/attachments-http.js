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

function attachmentId(pathname) {
  const prefix = "/sync/attachments/";
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

/** /sync/attachments/:id: an attachment's bytes, written once (GET, HEAD, PUT). Access guards it. */
export function createAttachmentHandler({
  blobStore,
}) {
  if (!blobStore?.get || !blobStore?.putIfAbsent) throw new Error("Attachment service requires get and putIfAbsent blob storage.");

  return async function handleAttachment(request) {
    const url = new URL(request.url);
    const id = attachmentId(url.pathname);
    if (!id) return new Response("Not found", { status: 404 });
    if (!["GET", "HEAD", "PUT"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD, PUT" } });
    }

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

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.byteLength) return new Response("Attachment is empty", { status: 400 });
    await blobStore.putIfAbsent(id, {
      bytes,
      contentType: request.headers.get("content-type") || "application/octet-stream",
    });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  };
}
