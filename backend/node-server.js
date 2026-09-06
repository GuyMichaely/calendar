import { createCalendarBackendHandler } from "./app.js";
import { readBackendConfig } from "./config.js";
import { createFileBackendStores } from "./file-stores.js";
import { createNodeHttpServer } from "./node-http.js";

const env = process.env;
const config = readBackendConfig(env);
const dataDirectory = String(env.CALENDAR_DATA_DIR || "").trim();
if (!dataDirectory) throw new Error("CALENDAR_DATA_DIR is required for the persistent backend.");

const stores = createFileBackendStores({ directory: dataDirectory });
const handleRequest = createCalendarBackendHandler({
  config,
  ...stores,
});

const port = Number(env.PORT || 8080);
const hostname = env.HOST || "0.0.0.0";
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 through 65535.");

const server = createNodeHttpServer({
  handleRequest,
  publicBaseUrl: config.publicBaseUrl,
});

server.listen(port, hostname, () => {
  console.log(`Calendar backend listening on http://${hostname}:${port}`);
  console.log(`Public backend URL: ${config.publicBaseUrl}`);
  console.log(`Allowed app origin: ${config.allowedOrigins[0]}`);
  console.log(`Persistent backend data: ${dataDirectory}`);
  console.log("Filesystem document updates are serialized within this process. Keep the App Service app at one instance unless the storage implementation changes.");
});
