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
8. The backend creates a new opaque random calendar session. Provider tokens are not used as the calendar API session.

For HTTPS production, flow and session cookies are host-only, `HttpOnly`, and `Secure`. The flow cookie uses `SameSite=Lax`. The session cookie uses `SameSite=None` because the frontend and backend may be on different sites.

The same model can support additional OIDC providers later. If two provider identities should represent the same person, backend configuration can allow both `(issuer, subject)` pairs without changing the sync protocol.

## HTTP surface

- `GET /auth/login/:provider`
- `GET /auth/callback/:provider`
- `GET /auth/me`
- `POST /auth/logout`

`createAuthHandler()` uses Fetch API `Request` and `Response`, Web Crypto, and an injected asynchronous key-value store. It is not tied to Express or another host runtime. `createMemoryAuthStore()` exists only for tests and local development. Production must supply durable storage for login transactions and sessions.

The configured `publicBaseUrl` constructs registered callback URLs and may include a path prefix. For example, a public base of `https://sync.example.com/calendar-api/` produces `https://sync.example.com/calendar-api/auth/callback/google`. Requests outside that configured prefix are not treated as auth routes.

The configured `appUrl` is the fixed post-login destination, so request parameters cannot introduce an open redirect.

The local Node development backend uses non-`Secure` cookies when its public URL is HTTP, such as `http://localhost:8787/`.

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

The Google OAuth client must register the exact backend callback URL. For the current Azure deployment that is:

```text
https://guymichaely-calendar-sync.azurewebsites.net/auth/callback/google
```

Client secrets and the allowed subject ID belong only in backend configuration or secrets. They must not be committed to this repository or shipped in the browser bundle.

For the current single-user application, authorization can be configured as:

```js
allowedIdentities: [
  { issuer: "https://accounts.google.com", subject: env.ALLOWED_GOOGLE_SUBJECT }
]
```

`backend/config.js` provides those Google convenience variables while also accepting arbitrary providers through `CALENDAR_OIDC_PROVIDERS_JSON` and exact identities through `CALENDAR_ALLOWED_IDENTITIES_JSON`.

## Relationship to sync

`readAuthSession()` is the authentication boundary consumed by both remote document sync and attachment blob sync. The transports remain independent of Google, OIDC, and provider tokens. Authentication and synchronization therefore remain separately testable and replaceable.
