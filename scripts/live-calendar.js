// The synced calendar, for scripts that change it the way a device would: it syncs through
// Cloudflare Access (with the token `cloudflared access login <endpoint>` saved) into memory,
// and back. --endpoint <url> syncs with another server (a local one: http://localhost:8787/sync,
// no sign-in); --apply is the scripts' go-ahead to write.
import * as Automerge from "@automerge/automerge";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createCalendarDocument, mergeCalendarDocuments, loadCalendarDocument, saveCalendarDocument } from "../sync/automerge-document.js";
import { createCalendarSyncClient } from "../sync/client.js";

const args = process.argv.slice(2);
export const apply = args.includes("--apply");
const endpoint = args.includes("--endpoint") ? args[args.indexOf("--endpoint") + 1] : "https://calendar.guymichaely.com/sync";

/** Syncs the calendar in; `doc` is it, `change` replaces it, `sync` sends the changes, `keep` saves it as it is under .local/. */
export async function openLiveCalendar() {
  let token = "";
  if (new URL(endpoint).hostname !== "localhost") {
    // Access guards the sync path, so that's the application cloudflared signs in to.
    const result = spawnSync("cloudflared", ["access", "token", `-app=${endpoint}`], { encoding: "utf8" });
    token = (result.stdout || "").trim();
    if (result.status !== 0 || !token) {
      console.error(`No Cloudflare Access sign-in for ${endpoint}. Run: cloudflared access login ${endpoint}`);
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
  return {
    get doc() { return doc; },
    change(next) { doc = next; },
    sync: () => client.sync(),
    // The calendar as it is, before a script changes it (loadable with Automerge).
    keep(label) {
      mkdirSync(".local", { recursive: true });
      const path = `.local/calendar-before-${label}-${new Date().toISOString().replaceAll(":", "-")}.automerge`;
      writeFileSync(path, saveCalendarDocument(doc));
      return path;
    },
  };
}
