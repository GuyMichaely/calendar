import * as Automerge from "@automerge/automerge";
import { SyncController, liveUrl, syncFetch, takeSignInCallback, type SyncSettings } from "@guymichaely/app-sync";
import { createSignal } from "solid-js";
import { configureRemoteAttachments } from "../../site/attachment-remote.js";
import { mergeSyncSnapshot, readSyncDocument, readSyncSnapshot, receiveSyncMessage } from "../../site/storage.js";
import { createCalendarSyncClient } from "../../sync/client.js";

// This device's sync settings and when it last synced, kept in this browser.
const SETTINGS_KEY = "calendar.sync";
const SYNCED_AT_KEY = "calendar.syncedAt";

type Attachment = { id: string; type?: string; blob?: Blob };

function readSettings(): SyncSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (stored && typeof stored.enabled === "boolean" && ["automatic", "on-edit", "manual"].includes(stored.mode)) return stored;
  } catch { /* Unreadable settings read as never set. */ }
  return { enabled: false, mode: "automatic" };
}

function requestError(message: string, status: number) {
  return Object.assign(new Error(`${message} (${status}).`), { status });
}

// The sync server sits beside the app: /calendar/sync.
const SYNC = `${import.meta.env.BASE_URL}sync`;

/**
 * Sync with the calendar's server at /calendar/sync, on this origin and behind Cloudflare Access.
 * @guymichaely/app-sync decides when (after edits, on opening and coming back, as the live
 * connection hears other devices' changes, and when asked); one sync is Automerge's sync protocol
 * (sync/client.js). Call it before anything reads the address: it takes the sign-in return off it.
 */
export function createCloudSync({ onSynced }: { onSynced: () => Promise<void> }) {
  const attachmentUrl = (id: string) => `${SYNC}/attachments/${encodeURIComponent(id)}`;
  configureRemoteAttachments({
    async upload(attachments: Attachment[]) {
      for (const attachment of attachments) {
        if (!(attachment.blob instanceof Blob)) continue;
        const existing = await syncFetch(attachmentUrl(attachment.id), { method: "HEAD" });
        if (existing.ok) continue;
        if (existing.status !== 404) throw requestError("Could not check the attachment", existing.status);
        const upload = await syncFetch(attachmentUrl(attachment.id), { method: "PUT", headers: { "content-type": attachment.blob.type || attachment.type || "application/octet-stream" }, body: attachment.blob });
        if (!upload.ok) throw requestError("Could not upload the attachment", upload.status);
      }
    },
    async download(attachment: Attachment) {
      const response = await syncFetch(attachmentUrl(attachment.id));
      if (!response.ok) throw requestError("Could not download the attachment", response.status);
      return new Blob([await response.arrayBuffer()], { type: response.headers.get("content-type") || attachment.type || "application/octet-stream" });
    },
  });

  const client = createCalendarSyncClient(
    { readSnapshot: readSyncSnapshot, mergeSnapshot: mergeSyncSnapshot, readDocument: readSyncDocument, receiveMessage: receiveSyncMessage },
    { endpoint: SYNC, fetch: ((input, init) => syncFetch(input as string, init)) as typeof fetch, credentials: "same-origin" },
  );
  // The calendar's heads as of the last sync. The live connection's heads are news when they
  // differ (at worst, one sync more than needed: one that finds nothing).
  const headsKey = (heads: readonly string[]) => [...heads].sort().join();
  let syncedHeads = "";
  const remember = async () => { syncedHeads = headsKey(Automerge.getHeads(await readSyncDocument() as Automerge.Doc<unknown>)); };

  const controller = new SyncController({
    engine: {
      async sync({ signal }) {
        await client.sync(signal);
        await onSynced();
        localStorage.setItem(SYNCED_AT_KEY, new Date().toISOString());
        await remember();
      },
      lastSyncedAt: () => localStorage.getItem(SYNCED_AT_KEY),
    },
    save(settings) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      if (!settings.enabled) localStorage.removeItem(SYNCED_AT_KEY);
    },
    signInUrl: `${SYNC}/signin`,
    live: {
      url: liveUrl(`${SYNC}/live`),
      onMessage(message) {
        const heads = (message as { heads?: unknown })?.heads;
        if (!Array.isArray(heads) || !heads.every(head => typeof head === "string")) return false;
        return headsKey(heads) !== syncedHeads;
      },
    },
    lock: "calendar-sync",
  });

  // Back from signing in: sync is on, from a fresh first merge.
  if (takeSignInCallback()) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readSettings(), enabled: true }));
    localStorage.removeItem(SYNCED_AT_KEY);
  }
  controller.configure(readSettings());
  // Another window changed them.
  window.addEventListener("storage", event => { if (event.key === SETTINGS_KEY) controller.configure(readSettings()); });

  const [snapshot, setSnapshot] = createSignal(controller.getSnapshot());
  controller.subscribe(() => setSnapshot(controller.getSnapshot()));
  return { controller, snapshot };
}
