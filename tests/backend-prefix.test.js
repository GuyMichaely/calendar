import assert from "node:assert/strict";
import test from "node:test";
import { createAuthHandler, createMemoryAuthStore } from "../auth/http.js";
import { createCalendarBackend } from "../backend/http.js";
import { createCalendarDocument, saveCalendarDocument } from "../sync/automerge-document.js";
import { AUTOMERGE_MEDIA_TYPE, createMemoryDocumentStore, createSyncHandler } from "../sync/http.js";

const provider = {
  id: "example",
  issuer: "https://identity.example",
  clientId: "calendar-client",
};

test("auth routes and OIDC callbacks preserve the configured backend path prefix", async () => {
  let redirectUri = "";
  const auth = createAuthHandler({
    providers: [provider],
    allowedIdentities: [{ issuer: provider.issuer, subject: "guy" }],
    store: createMemoryAuthStore(),
    appUrl: "https://app.example/calendar/",
    publicBaseUrl: "https://sync.example/calendar-api/",
    secureCookies: false,
    oidcClient: {
      async begin(currentProvider, currentRedirectUri) {
        assert.equal(currentProvider.id, provider.id);
        redirectUri = currentRedirectUri;
        return {
          authorizationUrl: new URL("https://identity.example/authorize"),
          transaction: {
            providerId: currentProvider.id,
            issuer: currentProvider.issuer,
            redirectUri: currentRedirectUri,
            state: "state-1",
            nonce: "nonce-1",
            codeVerifier: "verifier-1",
          },
        };
      },
      async finish() {
        return { issuer: provider.issuer, subject: "guy" };
      },
    },
  });

  const login = await auth(new Request("https://sync.example/calendar-api/auth/login/example"));
  assert.equal(login.status, 302);
  assert.equal(redirectUri, "https://sync.example/calendar-api/auth/callback/example");

  const prefixedMe = await auth(new Request("https://sync.example/calendar-api/auth/me"));
  assert.equal(prefixedMe.status, 401);
  const unprefixedMe = await auth(new Request("https://sync.example/auth/me"));
  assert.equal(unprefixedMe.status, 404);
});

test("composed backend routes the real sync handler and CORS under one optional path prefix", async () => {
  const basePath = "/calendar-api";
  const syncHandler = createSyncHandler({
    authenticate: async () => ({ identity: { issuer: provider.issuer, subject: "guy" } }),
    documentStore: createMemoryDocumentStore(),
    basePath,
  });
  const backend = createCalendarBackend({
    authHandler: async () => new Response("auth"),
    syncHandler,
    allowedOrigins: ["https://app.example"],
    basePath,
  });

  const auth = await backend(new Request("https://sync.example/calendar-api/auth/me"));
  assert.equal(auth.status, 200);
  assert.equal(await auth.text(), "auth");

  const bytes = saveCalendarDocument(createCalendarDocument([]));
  const sync = await backend(new Request("https://sync.example/calendar-api/sync", {
    method: "POST",
    headers: {
      origin: "https://app.example",
      "content-type": AUTOMERGE_MEDIA_TYPE,
    },
    body: bytes,
  }));
  assert.equal(sync.status, 200);
  assert.equal(sync.headers.get("access-control-allow-origin"), "https://app.example");
  assert.equal(sync.headers.get("content-type"), AUTOMERGE_MEDIA_TYPE);

  const outside = await backend(new Request("https://sync.example/sync", {
    method: "POST",
    headers: { "content-type": AUTOMERGE_MEDIA_TYPE },
    body: bytes,
  }));
  assert.equal(outside.status, 404);

  const preflight = await backend(new Request("https://sync.example/calendar-api/sync", {
    method: "OPTIONS",
    headers: { origin: "https://app.example" },
  }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://app.example");
});
