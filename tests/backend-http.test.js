import assert from "node:assert/strict";
import test from "node:test";
import { createCalendarBackend } from "../backend/http.js";
import { createCalendarDocument, saveCalendarDocument } from "../sync/automerge-document.js";
import { AUTOMERGE_MEDIA_TYPE, createMemoryDocumentStore, createSyncHandler } from "../sync/http.js";

test("backend answers credentialed CORS preflight only for configured origins", async () => {
  const backend = createCalendarBackend({
    authHandler: async () => new Response("auth"),
    syncHandler: async () => new Response("sync"),
    allowedOrigins: ["https://app.example"],
  });

  const allowed = await backend(new Request("https://sync.example/sync", {
    method: "OPTIONS",
    headers: {
      origin: "https://app.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  }));
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example");
  assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
  assert.match(allowed.headers.get("access-control-allow-methods"), /POST/u);
  assert.match(allowed.headers.get("access-control-allow-headers"), /Content-Type/u);

  const denied = await backend(new Request("https://sync.example/sync", {
    method: "OPTIONS",
    headers: { origin: "https://evil.example" },
  }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("backend routes auth and sync while applying CORS to allowed browser requests", async () => {
  const backend = createCalendarBackend({
    authHandler: async () => new Response("auth response", { status: 200 }),
    syncHandler: async () => new Response("sync response", { status: 200 }),
    allowedOrigins: ["https://app.example"],
  });
  const headers = { origin: "https://app.example" };

  const auth = await backend(new Request("https://sync.example/auth/me", { headers }));
  assert.equal(await auth.text(), "auth response");
  assert.equal(auth.headers.get("access-control-allow-origin"), "https://app.example");
  assert.equal(auth.headers.get("access-control-allow-credentials"), "true");

  const sync = await backend(new Request("https://sync.example/sync", { method: "POST", headers }));
  assert.equal(await sync.text(), "sync response");
  assert.equal(sync.headers.get("access-control-allow-origin"), "https://app.example");
});

test("requests without an allowed Origin never receive credentialed CORS headers", async () => {
  const backend = createCalendarBackend({
    authHandler: async () => new Response("ok"),
    syncHandler: async () => new Response("ok"),
    allowedOrigins: ["https://app.example"],
  });

  for (const request of [
    new Request("https://sync.example/auth/me"),
    new Request("https://sync.example/auth/me", { headers: { origin: "https://evil.example" } }),
  ]) {
    const response = await backend(request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
  }
});

test("sync requires the Automerge media type after authentication", async () => {
  const handler = createSyncHandler({
    authenticate: async () => ({ identity: { issuer: "issuer", subject: "guy" } }),
    documentStore: createMemoryDocumentStore(),
  });
  const bytes = saveCalendarDocument(createCalendarDocument([]));
  const response = await handler(new Request("https://sync.example/sync", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: bytes,
  }));
  assert.equal(response.status, 415);
  assert.match(await response.text(), new RegExp(AUTOMERGE_MEDIA_TYPE, "u"));
});
