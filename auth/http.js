import { beginOidcLogin, finishOidcLogin, isAllowedIdentity } from "./oidc.js";

const DEFAULT_FLOW_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function createMemoryAuthStore({ now = () => Date.now() } = {}) {
  const values = new Map();
  return {
    async get(key) {
      const entry = values.get(key);
      if (!entry) return null;
      if (entry.expiresAt != null && entry.expiresAt <= now()) {
        values.delete(key);
        return null;
      }
      return clone(entry.value);
    },
    async set(key, value, { expiresAt = null } = {}) {
      values.set(key, { value: clone(value), expiresAt });
    },
    async delete(key) {
      values.delete(key);
    },
  };
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function parseCookies(request) {
  const result = {};
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

export function authCookieNames({ secureCookies = true } = {}) {
  return secureCookies
    ? { flow: "__Host-calendar_auth_flow", session: "__Host-calendar_session" }
    : { flow: "calendar_auth_flow", session: "calendar_session" };
}

function cookie(name, value, { secure, maxAge }) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

function clearCookie(name, secure) {
  return cookie(name, "", { secure, maxAge: 0 });
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function normalizeProviders(providers) {
  const entries = Array.isArray(providers)
    ? providers.map((provider) => [provider.id, provider])
    : Object.entries(providers || {}).map(([id, provider]) => [id, { id, ...provider }]);
  const map = new Map();
  for (const [id, provider] of entries) {
    if (!id || !provider?.issuer || !provider?.clientId) throw new Error("Each OIDC provider requires id, issuer, and clientId.");
    if (map.has(id)) throw new Error(`Duplicate OIDC provider id: ${id}`);
    map.set(id, { ...provider, id });
  }
  if (!map.size) throw new Error("At least one OIDC provider must be configured.");
  return map;
}

function sessionStoreKey(id) {
  return `auth:session:${id}`;
}

function flowStoreKey(id) {
  return `auth:flow:${id}`;
}

export async function readAuthSession(request, { store, secureCookies = true, now = () => Date.now() }) {
  if (!store) throw new Error("Auth session lookup requires a store.");
  const names = authCookieNames({ secureCookies });
  const sessionId = parseCookies(request)[names.session];
  if (!sessionId) return null;
  const session = await store.get(sessionStoreKey(sessionId));
  if (!session) return null;
  if (session.expiresAt <= now()) {
    await store.delete(sessionStoreKey(sessionId));
    return null;
  }
  return { id: sessionId, ...session };
}

function callbackUrl(publicBaseUrl, providerId) {
  return new URL(`/auth/callback/${encodeURIComponent(providerId)}`, publicBaseUrl).href;
}

function redirect(location, cookies = []) {
  const headers = new Headers({ location });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status: 302, headers });
}

export function createAuthHandler({
  providers,
  allowedIdentities,
  store,
  appUrl,
  publicBaseUrl,
  secureCookies = true,
  flowTtlMs = DEFAULT_FLOW_TTL_MS,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  now = () => Date.now(),
  oidcClient = { begin: beginOidcLogin, finish: finishOidcLogin },
  fetch: fetchImpl,
}) {
  const providerMap = normalizeProviders(providers);
  if (!Array.isArray(allowedIdentities) || !allowedIdentities.length) {
    throw new Error("At least one allowed OIDC identity must be configured.");
  }
  if (!store?.get || !store?.set || !store?.delete) throw new Error("Auth requires a get/set/delete store.");
  const applicationUrl = new URL(appUrl).href;
  const authBaseUrl = new URL(publicBaseUrl).href;
  const names = authCookieNames({ secureCookies });

  return async function handleAuth(request) {
    const url = new URL(request.url);
    const loginMatch = /^\/auth\/login\/([^/]+)$/u.exec(url.pathname);
    const callbackMatch = /^\/auth\/callback\/([^/]+)$/u.exec(url.pathname);

    if (request.method === "GET" && loginMatch) {
      const providerId = decodeURIComponent(loginMatch[1]);
      const provider = providerMap.get(providerId);
      if (!provider) return new Response("Unknown identity provider", { status: 404 });

      try {
        const flowId = randomToken();
        const redirectUri = callbackUrl(authBaseUrl, providerId);
        const { authorizationUrl, transaction } = await oidcClient.begin(provider, redirectUri, { fetch: fetchImpl });
        const expiresAt = now() + flowTtlMs;
        await store.set(
          flowStoreKey(flowId),
          { ...transaction, providerId, expiresAt },
          { expiresAt },
        );
        return redirect(authorizationUrl.href || String(authorizationUrl), [
          cookie(names.flow, flowId, { secure: secureCookies, maxAge: flowTtlMs / 1000 }),
        ]);
      } catch (error) {
        console.error("OIDC login start failed", error);
        return new Response("Could not start authentication", { status: 502 });
      }
    }

    if (request.method === "GET" && callbackMatch) {
      const providerId = decodeURIComponent(callbackMatch[1]);
      const provider = providerMap.get(providerId);
      if (!provider) return new Response("Unknown identity provider", { status: 404 });

      const flowId = parseCookies(request)[names.flow];
      if (!flowId) return new Response("Authentication transaction is missing or expired", { status: 400 });
      const key = flowStoreKey(flowId);
      const transaction = await store.get(key);
      await store.delete(key);
      if (!transaction || transaction.expiresAt <= now() || transaction.providerId !== providerId) {
        return new Response("Authentication transaction is missing or expired", {
          status: 400,
          headers: { "set-cookie": clearCookie(names.flow, secureCookies) },
        });
      }

      try {
        const identity = await oidcClient.finish(provider, url, transaction, { fetch: fetchImpl });
        if (!isAllowedIdentity(identity, allowedIdentities)) {
          return new Response("This identity is not authorized to use this calendar", {
            status: 403,
            headers: { "set-cookie": clearCookie(names.flow, secureCookies) },
          });
        }

        const sessionId = randomToken();
        const expiresAt = now() + sessionTtlMs;
        await store.set(
          sessionStoreKey(sessionId),
          { identity, createdAt: now(), expiresAt },
          { expiresAt },
        );
        return redirect(applicationUrl, [
          clearCookie(names.flow, secureCookies),
          cookie(names.session, sessionId, { secure: secureCookies, maxAge: sessionTtlMs / 1000 }),
        ]);
      } catch (error) {
        console.error("OIDC callback failed", error);
        return new Response("Authentication failed", {
          status: 400,
          headers: { "set-cookie": clearCookie(names.flow, secureCookies) },
        });
      }
    }

    if (request.method === "GET" && url.pathname === "/auth/me") {
      const session = await readAuthSession(request, { store, secureCookies, now });
      return session ? json({ authenticated: true, identity: session.identity }) : json({ authenticated: false }, 401);
    }

    if (request.method === "POST" && url.pathname === "/auth/logout") {
      const sessionId = parseCookies(request)[names.session];
      if (sessionId) await store.delete(sessionStoreKey(sessionId));
      return new Response(null, {
        status: 204,
        headers: { "set-cookie": clearCookie(names.session, secureCookies) },
      });
    }

    return new Response("Not found", { status: 404 });
  };
}
