import assert from "node:assert/strict";
import test from "node:test";
import { createAuthHandler, createMemoryAuthStore, readAuthSession } from "../auth/http.js";
import { createCalendarBackend } from "../backend/http.js";
import {
  createCalendarDocument,
  loadCalendarDocument,
  materializeItem,
  saveCalendarDocument,
} from "../sync/automerge-document.js";
import { AUTOMERGE_MEDIA_TYPE, createMemoryDocumentStore, createSyncHandler } from "../sync/http.js";

function setCookies(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const raw = response.headers.get("set-cookie");
  return raw ? [raw] : [];
}

function cookieFrom(response, name) {
  for (const header of setCookies(response)) {
    const match = new RegExp(`(?:^|,\\s*)${name}=([^;]*)`, "u").exec(header);
    if (match && match[1]) return `${name}=${match[1]}`;
  }
  return "";
}

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

test("an authenticated OIDC session can drive the composed sync endpoint end to end", async () => {
  const provider = {
    id: "example",
    issuer: "https://identity.example",
    clientId: "calendar-client",
    clientSecret: "secret",
  };
  const authStore = createMemoryAuthStore();
  const oidcClient = {
    async begin(currentProvider, redirectUri) {
      return {
        authorizationUrl: new URL("https://identity.example/authorize?state=state-1"),
        transaction: {
          providerId: currentProvider.id,
          issuer: currentProvider.issuer,
          redirectUri,
          state: "state-1",
          nonce: "nonce-1",
          codeVerifier: "verifier-1",
        },
      };
    },
    async finish(currentProvider, callbackUrl, transaction) {
      const callback = new URL(callbackUrl);
      assert.equal(callback.searchParams.get("state"), transaction.state);
      return {
        issuer: currentProvider.issuer,
        subject: "guy",
        email: "guy@example.com",
      };
    },
  };
  const authHandler = createAuthHandler({
    providers: [provider],
    allowedIdentities: [{ issuer: provider.issuer, subject: "guy" }],
    store: authStore,
    appUrl: "https://app.example/calendar/",
    publicBaseUrl: "https://sync.example/",
    secureCookies: false,
    oidcClient,
  });
  const documentStore = createMemoryDocumentStore();
  const syncHandler = createSyncHandler({
    authenticate: (request) => readAuthSession(request, { store: authStore, secureCookies: false }),
    documentStore,
  });
  const backend = createCalendarBackend({
    authHandler,
    syncHandler,
    allowedOrigins: ["https://app.example"],
  });

  const login = await backend(new Request("https://sync.example/auth/login/example"));
  const flowCookie = cookieFrom(login, "calendar_auth_flow");
  assert.ok(flowCookie);

  const callback = await backend(new Request("https://sync.example/auth/callback/example?code=abc&state=state-1", {
    headers: { cookie: flowCookie },
  }));
  assert.equal(callback.status, 302);
  const sessionCookie = cookieFrom(callback, "calendar_session");
  assert.ok(sessionCookie);

  const doc = createCalendarDocument([{
    id: "task-1",
    kind: "task",
    title: "Synced task",
    notes: "",
    state: "open",
    tags: [],
    attachments: [],
  }]);
  const sync = await backend(new Request("https://sync.example/sync", {
    method: "POST",
    headers: {
      origin: "https://app.example",
      cookie: sessionCookie,
      "content-type": AUTOMERGE_MEDIA_TYPE,
    },
    body: saveCalendarDocument(doc),
  }));

  assert.equal(sync.status, 200);
  assert.equal(sync.headers.get("access-control-allow-origin"), "https://app.example");
  assert.equal(sync.headers.get("access-control-allow-credentials"), "true");
  const merged = loadCalendarDocument(new Uint8Array(await sync.arrayBuffer()));
  assert.equal(materializeItem(merged, "task-1").title, "Synced task");
});
