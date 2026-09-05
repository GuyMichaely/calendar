function requiredUrl(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name} is required.`);
  return new URL(text).href;
}

function parseJsonArray(value, name) {
  const text = String(value || "").trim();
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array.`);
  return parsed;
}

function normalizeProvider(provider, index) {
  if (!provider || typeof provider !== "object") throw new Error(`OIDC provider ${index + 1} must be an object.`);
  const id = String(provider.id || "").trim();
  const issuer = String(provider.issuer || "").trim();
  const clientId = String(provider.clientId || "").trim();
  if (!id || !issuer || !clientId) throw new Error(`OIDC provider ${index + 1} requires id, issuer, and clientId.`);
  const normalized = {
    ...provider,
    id,
    issuer: new URL(issuer).href.replace(/\/$/u, ""),
    clientId,
  };
  if (provider.clientSecret != null) normalized.clientSecret = String(provider.clientSecret);
  if (provider.scopes != null) {
    if (!Array.isArray(provider.scopes) || provider.scopes.some((scope) => typeof scope !== "string" || !scope.trim())) {
      throw new Error(`OIDC provider ${id} scopes must be an array of non-empty strings.`);
    }
    normalized.scopes = provider.scopes.map((scope) => scope.trim());
  }
  return normalized;
}

function normalizeIdentity(identity, index) {
  if (!identity || typeof identity !== "object") throw new Error(`Allowed identity ${index + 1} must be an object.`);
  const issuer = String(identity.issuer || "").trim();
  const subject = String(identity.subject || "").trim();
  if (!issuer || !subject) throw new Error(`Allowed identity ${index + 1} requires issuer and subject.`);
  return { issuer: new URL(issuer).href.replace(/\/$/u, ""), subject };
}

function googleProviderFromEnv(env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || "").trim();
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together.");
  return {
    id: "google",
    issuer: "https://accounts.google.com",
    clientId,
    clientSecret,
    scopes: ["email", "profile"],
  };
}

function googleIdentityFromEnv(env) {
  const subject = String(env.ALLOWED_GOOGLE_SUBJECT || "").trim();
  if (!subject) return null;
  return { issuer: "https://accounts.google.com", subject };
}

export function readBackendConfig(env = process.env) {
  const appUrl = requiredUrl(env.CALENDAR_APP_URL, "CALENDAR_APP_URL");
  const publicBaseUrl = requiredUrl(env.CALENDAR_PUBLIC_BASE_URL, "CALENDAR_PUBLIC_BASE_URL");

  const configuredProviders = parseJsonArray(env.CALENDAR_OIDC_PROVIDERS_JSON, "CALENDAR_OIDC_PROVIDERS_JSON");
  const googleProvider = googleProviderFromEnv(env);
  const providers = [
    ...configuredProviders,
    ...(googleProvider && !configuredProviders.some((provider) => provider?.id === "google") ? [googleProvider] : []),
  ].map(normalizeProvider);
  if (!providers.length) {
    throw new Error("Configure at least one OIDC provider with CALENDAR_OIDC_PROVIDERS_JSON or Google client variables.");
  }

  const configuredIdentities = parseJsonArray(env.CALENDAR_ALLOWED_IDENTITIES_JSON, "CALENDAR_ALLOWED_IDENTITIES_JSON");
  const googleIdentity = googleIdentityFromEnv(env);
  const allowedIdentities = [
    ...configuredIdentities,
    ...(googleIdentity && !configuredIdentities.some((identity) => identity?.issuer === googleIdentity.issuer && identity?.subject === googleIdentity.subject)
      ? [googleIdentity]
      : []),
  ].map(normalizeIdentity);
  if (!allowedIdentities.length) {
    throw new Error("Configure at least one exact allowed OIDC issuer and subject.");
  }

  const baseUrl = new URL(publicBaseUrl);
  const basePath = baseUrl.pathname === "/" ? "" : baseUrl.pathname.replace(/\/+$/u, "");
  return {
    appUrl,
    publicBaseUrl,
    basePath,
    allowedOrigins: [new URL(appUrl).origin],
    providers,
    allowedIdentities,
  };
}
