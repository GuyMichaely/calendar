import { createAuthHandler, readAuthSession } from "../../auth/http.js";
import { createCalendarBackend } from "../http.js";
import { createChunkedDocumentStore, createDurableAuthStore } from "../durable-storage.js";
import { createSyncHandler } from "../../sync/http.js";

function requiredString(env, key) {
  const value = String(env?.[key] || "").trim();
  if (!value) throw new Error(`Cloudflare calendar backend requires ${key}.`);
  return value;
}

export function readCloudflareBackendConfig(env) {
  const appUrl = new URL(requiredString(env, "CALENDAR_APP_URL")).href;
  const publicBaseUrl = new URL(requiredString(env, "CALENDAR_PUBLIC_BASE_URL")).href;
  const googleClientId = requiredString(env, "GOOGLE_CLIENT_ID");
  const googleClientSecret = requiredString(env, "GOOGLE_CLIENT_SECRET");
  const allowedGoogleSubject = requiredString(env, "ALLOWED_GOOGLE_SUBJECT");

  return {
    appUrl,
    publicBaseUrl,
    allowedOrigins: [new URL(appUrl).origin],
    providers: [{
      id: "google",
      issuer: "https://accounts.google.com",
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      scopes: ["email", "profile"],
    }],
    allowedIdentities: [{
      issuer: "https://accounts.google.com",
      subject: allowedGoogleSubject,
    }],
  };
}

export function createCloudflareCalendarHandler({
  storage,
  env,
  secureCookies = true,
  oidcClient,
  fetch: fetchImpl,
  now = () => Date.now(),
}) {
  const config = readCloudflareBackendConfig(env);
  const authStore = createDurableAuthStore(storage, { now });
  const documentStore = createChunkedDocumentStore(storage);
  const authHandler = createAuthHandler({
    providers: config.providers,
    allowedIdentities: config.allowedIdentities,
    store: authStore,
    appUrl: config.appUrl,
    publicBaseUrl: config.publicBaseUrl,
    secureCookies,
    now,
    ...(oidcClient ? { oidcClient } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const syncHandler = createSyncHandler({
    authenticate: (request) => readAuthSession(request, { store: authStore, secureCookies, now }),
    documentStore,
  });
  return createCalendarBackend({
    authHandler,
    syncHandler,
    allowedOrigins: config.allowedOrigins,
  });
}
