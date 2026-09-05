import assert from "node:assert/strict";
import test from "node:test";
import { createCloudflareCalendarHandler, readCloudflareBackendConfig } from "../backend/cloudflare/handler.js";
import {
  createCalendarDocument,
  loadCalendarDocument,
  materializeItem,
  saveCalendarDocument,
} from "../sync/automerge-document.js";
import { AUTOMERGE_MEDIA_TYPE } from "../sync/http.js";

function memoryDurableStorage() {
  const values = new Map();
  const clone = (value) => value == null ? value : structuredClone(value);
  let tail = Promise.resolve();
  const base = {
    async get(key) { return clone(values.get(key)); },
    async put(key, value) { values.set(key, clone(value)); },
    async delete(key) { values.delete(key); },
  };
  return {
    ...base,
    async transaction(callback) {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      const snapshot = new Map([...values].map(([key, value]) => [key, clone(value)]));
      const transaction = {
        async get(key) { return clone(snapshot.get(key)); },
        async put(key, value) { snapshot.set(key, clone(value)); },
        async delete(key) { snapshot.delete(key); },
      };
      try {
        const result = await callback(transaction);
        values.clear();
        for (const [key, value] of snapshot) values.set(key, value);
        return result;
      } finally {
        release();
      }
    },
  };
}

const env = {
  CALENDAR_APP_URL: "https://app.example/calendar/",
  CALENDAR_PUBLIC_BASE_URL: "https://sync.example/",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  ALLOWED_GOOGLE_SUBJECT: "guy",
};

function fakeOidc() {
  return {
    async begin(provider, redirectUri) {
      assert.equal(provider.issuer, "https://accounts.google.com");
      return {
        authorizationUrl: new URL("https://accounts.google.com/o/oauth2/v2/auth?state=state-1"),
        transaction: {
          providerId: provider.id,
          issuer: provider.issuer,
          redirectUri,
          state: "state-1",
          nonce: "nonce-1",
          codeVerifier: "verifier-1",
        },
      };
    },
    async finish(provider, callbackUrl, transaction) {
      assert.equal(new URL(callbackUrl).searchParams.get("state"), transaction.state);
      return {
        issuer: provider.issuer,
        subject: "guy",
        email: "guy@example.com",
      };
    },
  };
}

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

test("Cloudflare backend config keeps Google in deployment configuration rather than the auth core", () => {
  const config = readCloudflareBackendConfig(env);
  assert.equal(config.providers[0].id, "google");
  assert.equal(config.providers[0].issuer, "https://accounts.google.com");
  assert.deepEqual(config.allowedIdentities, [{ issuer: "https://accounts.google.com", subject: "guy" }]);
  assert.deepEqual(config.allowedOrigins, ["https://app.example"]);
});

test("Cloudflare deployment handler persists login state and serves authenticated sync through one durable store", async () => {
  const storage = memoryDurableStorage();
  const backend = createCloudflareCalendarHandler({
    storage,
    env,
    secureCookies: false,
    oidcClient: fakeOidc(),
  });

  const login = await backend(new Request("https://sync.example/auth/login/google"));
  assert.equal(login.status, 302);
  const flowCookie = cookieFrom(login, "calendar_auth_flow");
  assert.ok(flowCookie);

  const callback = await backend(new Request("https://sync.example/auth/callback/google?code=abc&state=state-1", {
    headers: { cookie: flowCookie },
  }));
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), env.CALENDAR_APP_URL);
  const sessionCookie = cookieFrom(callback, "calendar_session");
  assert.ok(sessionCookie);

  const document = createCalendarDocument([{
    id: "task-cloudflare-1",
    kind: "task",
    title: "Cloud sync",
    notes: "",
    state: "open",
    tags: [],
    attachments: [],
  }]);
  const response = await backend(new Request("https://sync.example/sync", {
    method: "POST",
    headers: {
      origin: "https://app.example",
      cookie: sessionCookie,
      "content-type": AUTOMERGE_MEDIA_TYPE,
    },
    body: saveCalendarDocument(document),
  }));

  assert.equal(response.status, 200);
  const merged = loadCalendarDocument(new Uint8Array(await response.arrayBuffer()));
  assert.equal(materializeItem(merged, "task-cloudflare-1").title, "Cloud sync");
});

test("Cloudflare deployment config fails closed when required identity or URL settings are absent", () => {
  for (const key of Object.keys(env)) {
    const incomplete = { ...env };
    delete incomplete[key];
    assert.throws(() => readCloudflareBackendConfig(incomplete), new RegExp(key, "u"));
  }
});
