# Authentication core

This directory implements the provider-agnostic authentication boundary for the future calendar backend. It uses standard OpenID Connect directly; Firebase, Supabase, Auth0, and other identity platforms are not part of the design.

Google can be the first configured provider, but none of the HTTP/session code is Google-specific. Each provider supplies an issuer, client ID, backend-only client secret when applicable, scopes, and optional authorization parameters. OIDC discovery supplies the provider endpoints and signing metadata.

## Flow

1. The browser opens `GET /auth/login/:provider` on the calendar backend.
2. The backend generates a random OAuth state, OIDC nonce, and PKCE verifier/challenge and stores the short-lived login transaction server-side.
3. The backend redirects to the provider's authorization endpoint.
4. The provider redirects to `GET /auth/callback/:provider`.
5. The backend exchanges the authorization code and validates PKCE, state, nonce, issuer, audience, token signature, and expiry through `openid-client`.
6. The resulting identity is reduced to an internal `{ issuer, subject, ...displayClaims }` shape.
7. Authorization checks the exact `(issuer, subject)` pair against the configured allowlist. Email is display information, not an authorization identifier.
8. The backend creates a new opaque random calendar session. The browser receives only a host-only `HttpOnly; Secure; SameSite=Lax` session cookie; provider tokens are not used as the calendar API session.

The same model supports additional OIDC providers later. If two provider identities should represent the same person, the application can map both `(issuer, subject)` pairs to the same internal account without changing the sync protocol.

## HTTP surface

- `GET /auth/login/:provider`
- `GET /auth/callback/:provider`
- `GET /auth/me`
- `POST /auth/logout`

`createAuthHandler()` uses only Fetch API `Request`/`Response`, Web Crypto, and an injected asynchronous key-value store, so it is not tied to Express, Cloudflare, or another host. `createMemoryAuthStore()` exists for tests/development only. A deployed backend should supply durable storage for short-lived login transactions and sessions.

The configured `publicBaseUrl` is used to construct registered callback URLs. The configured `appUrl` is the fixed post-login destination, so request parameters cannot introduce an open redirect.

## Provider configuration

A Google configuration would have the shape:

```js
{
  id: "google",
  issuer: "https://accounts.google.com",
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  scopes: ["email", "profile"]
}
```

The Google OAuth client must register the backend callback URL, for example `https://sync.example.com/auth/callback/google`. Client secrets and the allowed subject ID belong only in backend configuration/secrets and must not be committed to this repository or shipped in the browser bundle.

For the current single-user application, authorization can be configured as:

```js
allowedIdentities: [
  { issuer: "https://accounts.google.com", subject: env.ALLOWED_GOOGLE_SUBJECT }
]
```

## Relationship to sync

This PR deliberately does not implement `/sync`. Remote sync will consume `readAuthSession()` to authorize requests, while the Automerge transport remains independent of the identity provider. Authentication and synchronization therefore remain separately testable and separately replaceable.
