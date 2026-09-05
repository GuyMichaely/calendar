import { createAuthHandler, readAuthSession } from "../auth/http.js";
import { createCalendarBackend } from "./http.js";
import { createSyncHandler } from "../sync/http.js";

export function createCalendarBackendHandler({
  config,
  authStore,
  documentStore,
  secureCookies = new URL(config?.publicBaseUrl || "http://localhost").protocol === "https:",
  oidcClient,
  fetch: fetchImpl,
  now = () => Date.now(),
}) {
  if (!config?.appUrl || !config?.publicBaseUrl) throw new Error("Backend handler requires appUrl and publicBaseUrl configuration.");
  if (!Array.isArray(config.providers) || !config.providers.length) throw new Error("Backend handler requires OIDC providers.");
  if (!Array.isArray(config.allowedIdentities) || !config.allowedIdentities.length) throw new Error("Backend handler requires allowed OIDC identities.");
  if (!authStore) throw new Error("Backend handler requires an auth store.");
  if (!documentStore) throw new Error("Backend handler requires a document store.");

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
    basePath: config.basePath || "",
  });
  return createCalendarBackend({
    authHandler,
    syncHandler,
    allowedOrigins: config.allowedOrigins || [new URL(config.appUrl).origin],
    basePath: config.basePath || "",
  });
}
