import assert from "node:assert/strict";
import test from "node:test";
import { createAuthHandler, createMemoryAuthStore } from "../auth/http.js";
import { beginOidcLogin } from "../auth/oidc.js";

const google = {
  id: "google",
  issuer: "https://accounts.example/google",
  clientId: "google-client",
  clientSecret: "google-secret",
};

const microsoft = {
  id: "microsoft",
  issuer: "https://login.example/tenant/v2.0",
  clientId: "microsoft-client",
  clientSecret: "microsoft-secret",
};

function fakeOidc(identityByProvider = {}) {
  return {
    async begin(provider, redirectUri) {
      const state = `state-${provider.id}`;
      return {
        authorizationUrl: new URL(`https://identity.example/authorize?provider=${provider.id}&state=${state}`),
        transaction: {
          providerId: provider.id,
          issuer: provider.issuer,
          redirectUri,
          state,
          nonce: `nonce-${provider.id}`,
          codeVerifier: `verifier-${provider.id}`,
        },
      };
    },
    async finish(provider, callbackUrl, transaction) {
      const callback = new URL(callbackUrl);
      if (callback.searchParams.get("state") !== transaction.state) throw new Error("bad state");
      return identityByProvider[provider.id] || {
        issuer: provider.issuer,
        subject: "guy",
        email: "guy@example.com",
        emailVerified: true,
        name: "Guy",
        picture: null,
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

function handlerOptions(overrides = {}) {
  return {
    providers: [google],
    allowedIdentities: [{ issuer: google.issuer, subject: "guy" }],
    store: createMemoryAuthStore(),
    appUrl: "https://app.example/calendar/",
    publicBaseUrl: "https://sync.example/",
    secureCookies: false,
    oidcClient: fakeOidc(),
    ...overrides,
  };
}

async function login(handler, provider = "google") {
  const response = await handler(new Request(`https://sync.example/auth/login/${provider}`));
  assert.equal(response.status, 302);
  const flowCookie = cookieFrom(response, "calendar_auth_flow");
  assert.ok(flowCookie, "login should set an auth-flow cookie");
  return { response, flowCookie };
}

async function callback(handler, flowCookie, provider = "google", state = `state-${provider}`) {
  return handler(
    new Request(`https://sync.example/auth/callback/${provider}?code=code&state=${encodeURIComponent(state)}`, {
      headers: { cookie: flowCookie },
    }),
  );
}

test("login redirects to the provider and uses the configured backend callback", async () => {
  let capturedRedirect = null;
  const oidcClient = fakeOidc();
  const originalBegin = oidcClient.begin;
  oidcClient.begin = async (provider, redirectUri, options) => {
    capturedRedirect = redirectUri;
    return originalBegin(provider, redirectUri, options);
  };
  const handler = createAuthHandler(handlerOptions({ oidcClient }));

  const { response } = await login(handler);
  assert.match(response.headers.get("location"), /^https:\/\/identity\.example\/authorize/u);
  assert.equal(capturedRedirect, "https://sync.example/auth/callback/google");
});

test("allowed callback creates an opaque session that /auth/me can read", async () => {
  const store = createMemoryAuthStore();
  const handler = createAuthHandler(handlerOptions({ store }));
  const { flowCookie } = await login(handler);
  const response = await callback(handler, flowCookie);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://app.example/calendar/");
  const sessionCookie = cookieFrom(response, "calendar_session");
  assert.ok(sessionCookie, "callback should set a session cookie");

  const me = await handler(new Request("https://sync.example/auth/me", { headers: { cookie: sessionCookie } }));
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), {
    authenticated: true,
    identity: {
      issuer: google.issuer,
      subject: "guy",
      email: "guy@example.com",
      emailVerified: true,
      name: "Guy",
      picture: null,
    },
  });
});

test("a valid identity from the provider is still forbidden unless issuer and subject are allowed", async () => {
  const oidcClient = fakeOidc({
    google: { issuer: google.issuer, subject: "someone-else", email: "other@example.com" },
  });
  const handler = createAuthHandler(handlerOptions({ oidcClient }));
  const { flowCookie } = await login(handler);
  const response = await callback(handler, flowCookie);

  assert.equal(response.status, 403);
  assert.match(await response.text(), /not authorized/u);
  assert.equal(cookieFrom(response, "calendar_session"), "");
});

test("state validation failures do not create a session", async () => {
  const handler = createAuthHandler(handlerOptions());
  const { flowCookie } = await login(handler);
  const response = await callback(handler, flowCookie, "google", "wrong-state");
  assert.equal(response.status, 400);
  assert.equal(cookieFrom(response, "calendar_session"), "");
});

test("login transactions expire", async () => {
  let clock = 1_000;
  const now = () => clock;
  const store = createMemoryAuthStore({ now });
  const handler = createAuthHandler(handlerOptions({ store, now, flowTtlMs: 1_000 }));
  const { flowCookie } = await login(handler);
  clock += 1_001;
  const response = await callback(handler, flowCookie);
  assert.equal(response.status, 400);
});

test("sessions expire even when the backing store does not enforce TTL itself", async () => {
  let clock = 1_000;
  const now = () => clock;
  const storeValues = new Map();
  const store = {
    async get(key) { return structuredClone(storeValues.get(key) || null); },
    async set(key, value) { storeValues.set(key, structuredClone(value)); },
    async delete(key) { storeValues.delete(key); },
  };
  const handler = createAuthHandler(handlerOptions({ store, now, sessionTtlMs: 1_000 }));
  const { flowCookie } = await login(handler);
  const response = await callback(handler, flowCookie);
  const sessionCookie = cookieFrom(response, "calendar_session");
  clock += 1_001;

  const me = await handler(new Request("https://sync.example/auth/me", { headers: { cookie: sessionCookie } }));
  assert.equal(me.status, 401);
});

test("logout deletes the server session and clears the cookie", async () => {
  const handler = createAuthHandler(handlerOptions());
  const { flowCookie } = await login(handler);
  const response = await callback(handler, flowCookie);
  const sessionCookie = cookieFrom(response, "calendar_session");

  const logout = await handler(new Request("https://sync.example/auth/logout", {
    method: "POST",
    headers: { cookie: sessionCookie },
  }));
  assert.equal(logout.status, 204);
  assert.match(setCookies(logout).join("\n"), /Max-Age=0/u);

  const me = await handler(new Request("https://sync.example/auth/me", { headers: { cookie: sessionCookie } }));
  assert.equal(me.status, 401);
});

test("the same handler is provider-agnostic", async () => {
  const store = createMemoryAuthStore();
  const oidcClient = fakeOidc({
    google: { issuer: google.issuer, subject: "google-guy", email: "g@example.com" },
    microsoft: { issuer: microsoft.issuer, subject: "microsoft-guy", email: "m@example.com" },
  });
  const handler = createAuthHandler(handlerOptions({
    providers: [google, microsoft],
    allowedIdentities: [
      { issuer: google.issuer, subject: "google-guy" },
      { issuer: microsoft.issuer, subject: "microsoft-guy" },
    ],
    store,
    oidcClient,
  }));

  for (const [provider, issuer, subject] of [
    ["google", google.issuer, "google-guy"],
    ["microsoft", microsoft.issuer, "microsoft-guy"],
  ]) {
    const { flowCookie } = await login(handler, provider);
    const response = await callback(handler, flowCookie, provider);
    const sessionCookie = cookieFrom(response, "calendar_session");
    const me = await handler(new Request("https://sync.example/auth/me", { headers: { cookie: sessionCookie } }));
    const body = await me.json();
    assert.equal(body.identity.issuer, issuer);
    assert.equal(body.identity.subject, subject);
  }
});

test("production flow cookies stay Lax while session cookies allow credentialed cross-site requests", async () => {
  const handler = createAuthHandler(handlerOptions({ secureCookies: true }));
  const loginResponse = await handler(new Request("https://sync.example/auth/login/google"));
  const loginCookies = setCookies(loginResponse);
  const flowHeader = loginCookies.find((header) => header.startsWith("__Host-calendar_auth_flow="));
  assert.ok(flowHeader);
  assert.match(flowHeader, /Secure/u);
  assert.match(flowHeader, /HttpOnly/u);
  assert.match(flowHeader, /SameSite=Lax/u);
  assert.match(flowHeader, /Path=\//u);
  assert.doesNotMatch(flowHeader, /Domain=/u);

  const flowCookie = cookieFrom(loginResponse, "__Host-calendar_auth_flow");
  const callbackResponse = await handler(new Request("https://sync.example/auth/callback/google?code=code&state=state-google", {
    headers: { cookie: flowCookie },
  }));
  assert.equal(callbackResponse.status, 302);
  const sessionHeader = setCookies(callbackResponse).find((header) => header.startsWith("__Host-calendar_session="));
  assert.ok(sessionHeader);
  assert.match(sessionHeader, /Secure/u);
  assert.match(sessionHeader, /HttpOnly/u);
  assert.match(sessionHeader, /SameSite=None/u);
  assert.match(sessionHeader, /Path=\//u);
  assert.doesNotMatch(sessionHeader, /Domain=/u);

  const sessionCookie = cookieFrom(callbackResponse, "__Host-calendar_session");
  const logoutResponse = await handler(new Request("https://sync.example/auth/logout", {
    method: "POST",
    headers: { cookie: sessionCookie },
  }));
  const clearHeader = setCookies(logoutResponse).find((header) => header.startsWith("__Host-calendar_session="));
  assert.ok(clearHeader);
  assert.match(clearHeader, /SameSite=None/u);
  assert.match(clearHeader, /Secure/u);
  assert.match(clearHeader, /Max-Age=0/u);
});

test("real openid-client discovery builds an OIDC code-flow URL with PKCE, state, and nonce", async () => {
  const provider = {
    id: "example",
    issuer: "https://idp.example",
    clientId: "calendar-client",
    scopes: ["email", "profile"],
    clientAuthMethod: "none",
  };
  const fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url || input.href;
    assert.equal(url, "https://idp.example/.well-known/openid-configuration");
    return new Response(JSON.stringify({
      issuer: provider.issuer,
      authorization_endpoint: "https://idp.example/authorize",
      token_endpoint: "https://idp.example/token",
      jwks_uri: "https://idp.example/jwks",
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const { authorizationUrl, transaction } = await beginOidcLogin(
    provider,
    "https://sync.example/auth/callback/example",
    { fetch },
  );

  assert.equal(authorizationUrl.origin, "https://idp.example");
  assert.equal(authorizationUrl.pathname, "/authorize");
  assert.equal(authorizationUrl.searchParams.get("client_id"), provider.clientId);
  assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), "https://sync.example/auth/callback/example");
  assert.equal(authorizationUrl.searchParams.get("scope"), "openid email profile");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizationUrl.searchParams.get("code_challenge"));
  assert.equal(authorizationUrl.searchParams.get("state"), transaction.state);
  assert.equal(authorizationUrl.searchParams.get("nonce"), transaction.nonce);
  assert.equal(transaction.issuer, provider.issuer);
  assert.ok(transaction.codeVerifier);
});
