import {
  loadCalendarDocument,
  mergeCalendarDocuments,
  saveCalendarDocument,
} from "./automerge-document.js";
import { AUTOMERGE_MEDIA_TYPE } from "./http.js";

export class CalendarSyncError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = "CalendarSyncError";
    this.status = status;
  }
}

export async function exchangeCalendarSnapshot(document, {
  endpoint,
  fetch: fetchImpl = globalThis.fetch,
  credentials = "include",
  signal,
} = {}) {
  if (!endpoint) throw new Error("Calendar sync requires an endpoint.");
  if (typeof fetchImpl !== "function") throw new Error("Calendar sync requires Fetch API support.");

  const response = await fetchImpl(endpoint, {
    method: "POST",
    credentials,
    signal,
    headers: { "content-type": AUTOMERGE_MEDIA_TYPE },
    body: saveCalendarDocument(document),
  });

  if (!response.ok) {
    let message = `Calendar sync failed (${response.status})`;
    try {
      const detail = (await response.text()).trim();
      if (detail) message = detail;
    } catch {
      // Keep the status-based message if the response body cannot be read.
    }
    throw new CalendarSyncError(message, { status: response.status });
  }

  const responseType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (responseType !== AUTOMERGE_MEDIA_TYPE) {
    throw new CalendarSyncError(`Sync response Content-Type must be ${AUTOMERGE_MEDIA_TYPE}`, { status: response.status });
  }
  return loadCalendarDocument(new Uint8Array(await response.arrayBuffer()));
}

// The response must be merged into the *latest* local document, not used as a
// replacement for the snapshot that was sent. getCurrentDocument() is called
// again after the network request so edits made while the request was in flight
// are retained by Automerge.
export async function syncLatestCalendarDocument(getCurrentDocument, options) {
  if (typeof getCurrentDocument !== "function") throw new Error("Calendar sync requires getCurrentDocument().");
  const sent = getCurrentDocument();
  const remote = await exchangeCalendarSnapshot(sent, options);
  return mergeCalendarDocuments(getCurrentDocument(), remote);
}
