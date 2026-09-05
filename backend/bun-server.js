import { createCalendarBackendHandler } from "./app.js";
import { readBackendConfig } from "./config.js";
import { createFileBackendStores } from "./file-stores.js";

const config = readBackendConfig(Bun.env);
const dataDirectory = String(Bun.env.CALENDAR_DATA_DIR || "").trim();
if (!dataDirectory) throw new Error("CALENDAR_DATA_DIR is required for the persistent backend.");

const stores = createFileBackendStores({ directory: dataDirectory });
const handleRequest = createCalendarBackendHandler({
  config,
  ...stores,
});

const publicUrl = new URL(config.publicBaseUrl);
const port = Number(Bun.env.PORT || publicUrl.port || (publicUrl.protocol === "https:" ? 443 : 80));
const hostname = Bun.env.HOST || "127.0.0.1";

Bun.serve({
  hostname,
  port,
  fetch: handleRequest,
});

console.log(`Calendar backend listening at ${config.publicBaseUrl}`);
console.log(`Allowed app origin: ${config.allowedOrigins[0]}`);
console.log(`Persistent backend data: ${dataDirectory}`);
console.log("Filesystem document updates are serialized within this process. Do not run multiple backend processes against the same data directory.");
