// Takes out of the synced calendar whatever this version of the app no longer uses: fields an
// older version stored on items (a task's own Deadline lead, say) that nothing reads any more.
// It syncs like a device (through Cloudflare Access), lists what it would remove, and with
// --apply removes it and syncs that back; every device then gets the change as usual.
//
//   cloudflared access login https://calendar.guymichaely.com/sync
//   ./scripts/bun scripts/clean-live-data.js            # list what would go
//   ./scripts/bun scripts/clean-live-data.js --apply    # remove it
//
// --endpoint <url> syncs with another server (a local one: http://localhost:8787/sync, no sign-in).
// Before removing anything it saves the calendar as it was under .local/.
import * as Automerge from "@automerge/automerge";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createCalendarDocument, deleteItemField, materializeItems, mergeCalendarDocuments, loadCalendarDocument, saveCalendarDocument } from "../sync/automerge-document.js";
import { createCalendarSyncClient } from "../sync/client.js";
import { allowedFieldsForKind } from "../site/automerge-storage.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const endpoint = args.includes("--endpoint") ? args[args.indexOf("--endpoint") + 1] : "https://calendar.guymichaely.com/sync";
const local = new URL(endpoint).hostname === "localhost";

// Cloudflare Access lets the script in with the token `cloudflared access login` saved.
let token = "";
if (!local) {
  // Access guards the sync path, so that's the application cloudflared signs in to.
  const app = endpoint;
  const result = spawnSync("cloudflared", ["access", "token", `-app=${app}`], { encoding: "utf8" });
  token = (result.stdout || "").trim();
  if (result.status !== 0 || !token) {
    console.error(`No Cloudflare Access sign-in for ${app}. Run: cloudflared access login ${app}`);
    process.exit(1);
  }
}

let doc = createCalendarDocument();
const client = createCalendarSyncClient({
  readSnapshot: async () => saveCalendarDocument(doc),
  mergeSnapshot: async (bytes) => { doc = mergeCalendarDocuments(doc, loadCalendarDocument(bytes)); },
  readDocument: async () => doc,
  receiveMessage: async (syncState, message) => {
    const [next, state] = Automerge.receiveSyncMessage(doc, syncState, message);
    doc = next;
    return { result: null, syncState: state };
  },
}, {
  endpoint,
  credentials: "omit",
  fetch: (url, init) => fetch(url, { ...init, headers: { ...init.headers, ...(token ? { "cf-access-token": token } : {}) } }),
});

await client.sync();
const items = materializeItems(doc, { includeDeleted: true });
console.log(`${items.length} items synced.`);

const unused = [];
for (const item of items) {
  let allowed;
  try { allowed = allowedFieldsForKind(item.kind); }
  catch { console.log(`  ${item.id}: a kind this version doesn't know (${item.kind}); left as it is`); continue; }
  for (const field of Object.keys(item)) if (!allowed.has(field)) unused.push({ item, field });
}
if (!unused.length) { console.log("Nothing to remove."); process.exit(0); }

const byField = Object.groupBy(unused, entry => `${entry.item.kind}.${entry.field}`);
for (const [field, entries] of Object.entries(byField)) console.log(`  ${field}: on ${entries.length} item${entries.length === 1 ? "" : "s"}`);
if (!apply) { console.log("Run again with --apply to remove them."); process.exit(0); }

// The calendar as it was, first, in case anything needs undoing (loadable with Automerge).
mkdirSync(".local", { recursive: true });
const saved = `.local/calendar-before-clean-${new Date().toISOString().replaceAll(":", "-")}.automerge`;
writeFileSync(saved, saveCalendarDocument(doc));
console.log(`Saved the calendar as it was to ${saved}.`);
for (const { item, field } of unused) doc = deleteItemField(doc, item.id, field, `Remove ${field}, which this version doesn't use`);
await client.sync();
console.log(`Removed ${unused.length} unused field${unused.length === 1 ? "" : "s"} and synced.`);
