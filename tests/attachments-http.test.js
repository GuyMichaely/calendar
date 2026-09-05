import assert from "node:assert/strict";
import test from "node:test";
import { createAttachmentHandler, createMemoryBlobStore } from "../sync/attachments-http.js";

const authenticated = async () => ({ identity: { issuer: "issuer", subject: "guy" } });

function request(path, init = {}) {
  return new Request(`https://sync.example${path}`, init);
}

test("attachment service requires authentication before reading or writing blobs", async () => {
  const handler = createAttachmentHandler({
    authenticate: async () => null,
    blobStore: createMemoryBlobStore(),
  });
  assert.equal((await handler(request("/attachments/file-1"))).status, 401);
  assert.equal((await handler(request("/attachments/file-1", { method: "PUT", body: new Uint8Array([1]) }))).status, 401);
});

test("attachment service stores, probes, and downloads immutable blobs under a path prefix", async () => {
  const handler = createAttachmentHandler({
    authenticate: authenticated,
    blobStore: createMemoryBlobStore(),
    basePath: "/calendar-api",
  });
  const path = "/calendar-api/attachments/file%201";

  const upload = await handler(request(path, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: new TextEncoder().encode("first"),
  }));
  assert.equal(upload.status, 204);

  const head = await handler(request(path, { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "text/plain");
  assert.equal(head.headers.get("content-length"), "5");

  const secondUpload = await handler(request(path, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: new TextEncoder().encode("second"),
  }));
  assert.equal(secondUpload.status, 204);

  const download = await handler(request(path));
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "first");
  assert.equal((await handler(request("/attachments/file%201"))).status, 404);
});

test("attachment service rejects an empty upload but has no application-defined size ceiling", async () => {
  const handler = createAttachmentHandler({
    authenticate: authenticated,
    blobStore: createMemoryBlobStore(),
  });
  assert.equal((await handler(request("/attachments/empty", { method: "PUT" }))).status, 400);

  const bytes = new Uint8Array(1024 * 1024 + 3);
  bytes[0] = 7;
  bytes[bytes.length - 1] = 11;
  const upload = await handler(request("/attachments/large", { method: "PUT", body: bytes }));
  assert.equal(upload.status, 204);
  const download = await handler(request("/attachments/large"));
  const returned = new Uint8Array(await download.arrayBuffer());
  assert.equal(returned.byteLength, bytes.byteLength);
  assert.equal(returned[0], 7);
  assert.equal(returned.at(-1), 11);
});
