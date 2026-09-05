import { createMemoryAuthStore } from "../auth/http.js";
import { createMemoryBlobStore } from "../sync/attachments-http.js";
import { createMemoryDocumentStore } from "../sync/http.js";
import { createCalendarBackendHandler } from "./app.js";
import { readBackendConfig } from "./config.js";

const env = {
  ...Bun.env,
  CALENDAR_APP_URL: Bun.env.CALENDAR_APP_URL || "http://localhost:5173/calendar/",
  CALENDAR_PUBLIC_BASE_URL: Bun.env.CALENDAR_PUBLIC_BASE_URL || "http://localhost:8787/",
};
const config = readBackendConfig(env);
const handleRequest = createCalendarBackendHandler({
  config,
  authStore: createMemoryAuthStore(),
  documentStore: createMemoryDocumentStore(),
  blobStore: createMemoryBlobStore(),
});
const publicUrl = new URL(config.publicBaseUrl);
const port = Number(Bun.env.PORT || publicUrl.port || (publicUrl.protocol === "https:" ? 443 : 80));
const hostname = Bun.env.HOST || "127.0.0.1";

Bun.serve({
  hostname,
  port,
  fetch: handleRequest,
});

console.log(`Calendar development backend listening at ${config.publicBaseUrl}`);
console.log(`Allowed app origin: ${config.allowedOrigins[0]}`);
console.log("Auth sessions, calendar documents, and attachment blobs are stored only in memory and reset when this process exits.");
