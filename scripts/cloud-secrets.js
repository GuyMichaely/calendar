// Generate a local file for Wrangler; never print credentials.
import { chmod } from "node:fs/promises";
const values = {};
for (const line of (await Bun.file(".local/backend.env").text()).split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator < 0 || line.trimStart().startsWith("#")) continue;
  const key = line.slice(0, separator).trim();
  if (["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ALLOWED_GOOGLE_SUBJECT"].includes(key)) {
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
}
for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ALLOWED_GOOGLE_SUBJECT"]) {
  if (!values[key]) throw new Error(key + " is missing from .local/backend.env");
}
await Bun.write(".local/worker-secrets.json", JSON.stringify(values), { mode: 0o600 });
await chmod(".local/worker-secrets.json", 0o600);
console.log("Created .local/worker-secrets.json with restrictive permissions.");
