# Authentication core

This directory implements the provider-agnostic authentication boundary for the calendar backend. It uses standard OpenID Connect directly. Firebase, Supabase, Auth0, and other identity platforms are not required by the design.

Google is the first intended provider, but the HTTP and session code is not Google-specific. Each provider supplies an issuer, client ID, backend-only client secret when applicable, scopes, and optional authorization parameters. OIDC discovery supplies provider endpoints and signing metadata.

## Flow

1. The browser opens `GET /auth/login/:provider` on the calendar backend.
2. The backend generates random OAuth state, OIDC nonce, and a PKCE verifier/challenge and stores the short-lived login transaction server-side.
3. The backend redirects to the provider authorization endpoint.
4. The provider redirects to `GET /auth/callback/:provider`.
5. The backend exchanges the authorization code and validates PKCE, state, nonce, issuer, audience, token signature, and expiry through `openid-client`.
6. The resulting identity is reduced to `{ issuer, subject, ...displayClaims }`.
7. Authorization checks the exact `(issuer, subject)` pair against the configured allowlist. Email is display information, not an authorization identifier.
8. The backend creates a new opaque random calendar session. The browser receives only a host-only `HttpOnly; Secure; SameSite=Lax` session cookie. Provider tokens are not used as the calendar API session.

The same model can support additional OIDC providers later. If two provider identities should represent the same person, backend configuration can map both `(issuer, subject)` pairs to the same account without changing the sync protocol.

## HTTP surface

- `GET /auth/login/:provider`
- `GET /auth/callback/:provider`
- `GET /auth/me`
- `POST /auth/logout`

`createAuthHandler()` uses Fetch API `Request` and `Response`, Web Crypto, and an injected asynchronous key-value store. It is not tied to Express, Cloudflare, or another host. `createMemoryAuthStore()` exists only for tests and local development. Production must supply durable storage for login transactions and sessions.

The configured `publicBaseUrl` constructs registered callback URLs. The configured `appUrl` is the fixed post-login destination, so request parameters cannot introduce an open redirect.

## Google configuration

A Google provider has this shape:

```js
{
  id: "google",
  issuer: "https://accounts.google.com",
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  scopes: ["email", "profile"]
}
```

The Google OAuth client must register the backend callback URL, for example `https://sync.example.com/auth/callback/google`. Client secrets and the allowed subject ID belong only in backend configuration or secrets. They must not be committed to this repository or shipped in the browser bundle.

For the current single-user application, authorization can be configured as:

```js
allowedIdentities: [
  { issuer: "https://accounts.google.com", subject: env.ALLOWED_GOOGLE_SUBJECT }
]
```

## Relationship to sync

`readAuthSession()` is the authentication boundary consumed by the remote sync handler. The Automerge transport remains independent of Google, OIDC, and provider tokens. Authentication and synchronization therefore remain separately testable and replaceable.
