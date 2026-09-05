import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryAuthStore } from "../auth/http.js";
import { createCalendarBackendHandler } from "../backend/app.js";
import { createMemoryBlobStore } from "../sync/attachments-http.js";
import { createMemoryDocumentStore } from "../sync/http.js";

const config = {
  appUrl: "https://app.example/calendar/",
  publicBaseUrl: "https://sync.example/calendar-api/",
  basePath: "/calendar-api",
  allowedOrigins: ["https://app.example"],
  providers: [{ id: "example", issuer: "https://identity.example", clientId: "client" }],
  allowedIdentities: [{ issuer: "https://identity.example", subject: "guy" }],
};

async function backendWithSession() {
  const authStore = createMemoryAuthStore();
  await authStore.set("auth:session:test-session", {
    identity: { issuer: "https://identity.example", subject: "guy" },
    createdAt: 1,
    expiresAt: Date.now() + 60_000,
  });
  return createCalendarBackendHandler({
    config,
    authStore,
    documentStore: createMemoryDocumentStore(),
    blobStore: createMemoryBlobStore(),
    secureCookies: false,
  });
}

test("composed backend serves attachment blobs only to an authenticated allowed-origin client", async () => {
  const backend = await backendWithSession();
  const url = "https://sync.example/calendar-api/attachments/attachment-1";
  const commonHeaders = {
    origin: "https://app.example",
    cookie: "calendar_session=test-session",
  };

  const upload = await backend(new Request(url, {
    method: "PUT",
    headers: { ...commonHeaders, "content-type": "text/plain" },
    body: new TextEncoder().encode("hello"),
  }));
  assert.equal(upload.status, 204);
  assert.equal(upload.headers.get("access-control-allow-origin"), "https://app.example");

  const download = await backend(new Request(url, { headers: commonHeaders }));
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "hello");

  const unauthenticated = await backend(new Request(url, { headers: { origin: "https://app.example" } }));
  assert.equal(unauthenticated.status, 401);

  const wrongOrigin = await backend(new Request(url, {
    headers: { ...commonHeaders, origin: "https://evil.example" },
  }));
  assert.equal(wrongOrigin.status, 403);
});
