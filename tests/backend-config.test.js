import assert from "node:assert/strict";
import test from "node:test";
import { readBackendConfig } from "../backend/config.js";

function baseEnv(overrides = {}) {
  return {
    CALENDAR_APP_URL: "http://localhost:5173/calendar/",
    CALENDAR_PUBLIC_BASE_URL: "http://localhost:8787/calendar-api/",
    CALENDAR_OIDC_PROVIDERS_JSON: JSON.stringify([{
      id: "example",
      issuer: "https://identity.example/",
      clientId: "client-id",
      scopes: ["email", "profile"],
    }]),
    CALENDAR_ALLOWED_IDENTITIES_JSON: JSON.stringify([{
      issuer: "https://identity.example/",
      subject: "user-123",
    }]),
    ...overrides,
  };
}

test("backend config derives origin and path prefix from deployment URLs", () => {
  const config = readBackendConfig(baseEnv());
  assert.equal(config.appUrl, "http://localhost:5173/calendar/");
  assert.equal(config.publicBaseUrl, "http://localhost:8787/calendar-api/");
  assert.equal(config.basePath, "/calendar-api");
  assert.deepEqual(config.allowedOrigins, ["http://localhost:5173"]);
  assert.deepEqual(config.providers, [{
    id: "example",
    issuer: "https://identity.example",
    clientId: "client-id",
    scopes: ["email", "profile"],
  }]);
  assert.deepEqual(config.allowedIdentities, [{
    issuer: "https://identity.example",
    subject: "user-123",
  }]);
});

test("Google convenience variables remain deployment configuration rather than auth-core behavior", () => {
  const config = readBackendConfig({
    CALENDAR_APP_URL: "http://localhost:5173/calendar/",
    CALENDAR_PUBLIC_BASE_URL: "http://localhost:8787/",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    ALLOWED_GOOGLE_SUBJECT: "google-subject",
  });
  assert.deepEqual(config.providers, [{
    id: "google",
    issuer: "https://accounts.google.com",
    clientId: "google-client",
    clientSecret: "google-secret",
    scopes: ["email", "profile"],
  }]);
  assert.deepEqual(config.allowedIdentities, [{
    issuer: "https://accounts.google.com",
    subject: "google-subject",
  }]);
});

test("backend config refuses missing providers, identities, and malformed JSON", () => {
  assert.throws(
    () => readBackendConfig({
      CALENDAR_APP_URL: "http://localhost:5173/calendar/",
      CALENDAR_PUBLIC_BASE_URL: "http://localhost:8787/",
    }),
    /OIDC provider/u,
  );
  assert.throws(
    () => readBackendConfig(baseEnv({ CALENDAR_ALLOWED_IDENTITIES_JSON: "[]" })),
    /allowed OIDC issuer and subject/u,
  );
  assert.throws(
    () => readBackendConfig(baseEnv({ CALENDAR_OIDC_PROVIDERS_JSON: "not-json" })),
    /valid JSON/u,
  );
});
