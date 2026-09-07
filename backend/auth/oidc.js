import * as oidc from "openid-client";

function requireProvider(provider) {
  if (!provider?.id) throw new Error("OIDC provider requires an id.");
  if (!provider?.issuer) throw new Error(`OIDC provider ${provider.id} requires an issuer.`);
  if (!provider?.clientId) throw new Error(`OIDC provider ${provider.id} requires a clientId.`);
  return provider;
}

function clientAuthentication(provider) {
  const method = provider.clientAuthMethod || (provider.clientSecret ? "client_secret_post" : "none");
  if (method === "client_secret_basic") return oidc.ClientSecretBasic(provider.clientSecret);
  if (method === "client_secret_post") return oidc.ClientSecretPost(provider.clientSecret);
  if (method === "none") return oidc.None();
  throw new Error(`Unsupported OIDC client authentication method: ${method}`);
}

function discoveryOptions(fetchImpl) {
  return fetchImpl ? { [oidc.customFetch]: fetchImpl } : undefined;
}

async function discover(provider, fetchImpl) {
  requireProvider(provider);
  return oidc.discovery(
    new URL(provider.issuer),
    provider.clientId,
    undefined,
    clientAuthentication(provider),
    discoveryOptions(fetchImpl),
  );
}

function scopesFor(provider) {
  return [...new Set(["openid", ...(provider.scopes || ["email", "profile"])])].join(" ");
}

function stringParams(value = {}) {
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry != null) result[key] = String(entry);
  }
  return result;
}

export async function beginOidcLogin(provider, redirectUri, { fetch: fetchImpl } = {}) {
  requireProvider(provider);
  const redirect = new URL(redirectUri).href;
  const config = await discover(provider, fetchImpl);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const authorizationUrl = oidc.buildAuthorizationUrl(config, {
    ...stringParams(provider.authorizationParams),
    redirect_uri: redirect,
    scope: scopesFor(provider),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });

  return {
    authorizationUrl,
    transaction: {
      providerId: provider.id,
      issuer: config.serverMetadata().issuer,
      redirectUri: redirect,
      state,
      nonce,
      codeVerifier,
      createdAt: new Date().toISOString(),
    },
  };
}

export async function finishOidcLogin(provider, callbackUrl, transaction, { fetch: fetchImpl } = {}) {
  requireProvider(provider);
  if (!transaction) throw new Error("Missing OIDC login transaction.");
  if (transaction.providerId !== provider.id) throw new Error("OIDC provider does not match the login transaction.");
  if (!transaction.codeVerifier || !transaction.state || !transaction.nonce || !transaction.redirectUri) {
    throw new Error("OIDC login transaction is incomplete.");
  }

  const config = await discover(provider, fetchImpl);
  const discoveredIssuer = config.serverMetadata().issuer;
  if (transaction.issuer !== discoveredIssuer) throw new Error("OIDC issuer changed during login.");

  const callback = new URL(callbackUrl);
  const expectedRedirect = new URL(transaction.redirectUri);
  if (callback.origin !== expectedRedirect.origin || callback.pathname !== expectedRedirect.pathname) {
    throw new Error("OIDC callback URL does not match the login transaction.");
  }

  const tokens = await oidc.authorizationCodeGrant(
    config,
    callback,
    {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    },
    undefined,
    fetchImpl ? { [oidc.customFetch]: fetchImpl } : undefined,
  );
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error("OIDC ID token is missing a subject.");

  return {
    issuer: discoveredIssuer,
    subject: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : null,
    emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : null,
    name: typeof claims.name === "string" ? claims.name : null,
    picture: typeof claims.picture === "string" ? claims.picture : null,
  };
}

export function identityKey(identity) {
  if (!identity?.issuer || !identity?.subject) return "";
  return `${identity.issuer}\u0000${identity.subject}`;
}

export function isAllowedIdentity(identity, allowedIdentities = []) {
  const key = identityKey(identity);
  return !!key && allowedIdentities.some((candidate) => identityKey(candidate) === key);
}
