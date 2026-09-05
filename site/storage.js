import {
  applyLocalHistoryChange,
  deleteLocalItem,
  getLocalItem,
  listLocalItems,
  mergeLocalSyncSnapshot,
  putLocalItem,
  readLocalSyncSnapshot,
} from "./automerge-storage.js";
import { uploadAttachmentsBeforePersist } from "./attachment-remote.js";

const HISTORY_DB_NAME = "calendar-history";
const HISTORY_DB_VERSION = 1;
const HISTORY_STORE = "sessions";
const HISTORY_SESSION_KEY = "calendar.historySessionId";
const HISTORY_LIMIT = 100;

const undoStack = [];
const redoStack = [];
let activeBatch = null;
let applyingHistory = false;
let liveItems = null;

let historySessionId = sessionStorage.getItem(HISTORY_SESSION_KEY);
if (!historySessionId) {
  historySessionId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  sessionStorage.setItem(HISTORY_SESSION_KEY, historySessionId);
}

function openHistoryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        db.createObjectStore(HISTORY_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function cloneValue(value) {
  return value == null ? null : structuredClone(value);
}

function attachmentMetadata(attachment) {
  const { blob: _blob, dataUrl: _dataUrl, url: _url, ...metadata } = attachment || {};
  return metadata;
}

function preserveHiddenMetadata(source, target) {
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor || (typeof key !== "symbol" && descriptor.enumerable)) continue;
    const copied = { ...descriptor };
    if (Object.hasOwn(copied, "value")) copied.value = cloneValue(copied.value);
    Object.defineProperty(target, key, copied);
  }
  return target;
}

function withoutAttachmentBytes(item) {
  if (item == null) return item;
  const copy = preserveHiddenMetadata(item, cloneValue(item));
  if (Array.isArray(copy.attachments)) copy.attachments = copy.attachments.map(attachmentMetadata);
  return copy;
}

function uploadableAttachments(item) {
  return (item?.attachments || []).filter((attachment) => attachment?.blob instanceof Blob);
}

function cleanHistoryEntry(entry) {
  if (!entry) return entry;
  return {
    ...entry,
    changes: (entry.changes || []).map((change) => ({
      ...change,
      before: withoutAttachmentBytes(change.before),
      after: withoutAttachmentBytes(change.after),
    })),
  };
}

function syncLiveItem(id, snapshot) {
  if (!liveItems) return;
  const index = liveItems.findIndex((item) => item.id === id);
  if (snapshot == null) {
    if (index >= 0) liveItems.splice(index, 1);
    return;
  }
  const copy = withoutAttachmentBytes(snapshot);
  if (index >= 0) liveItems[index] = copy;
  else liveItems.push(copy);
}

function replaceLiveItems(items) {
  if (!liveItems) return;
  liveItems.splice(0, liveItems.length, ...items.map(withoutAttachmentBytes));
}

function actionLabel(before, after) {
  const item = after || before;
  const title = item?.title ? `“${item.title}”` : "item";
  if (!before && after) return `Create ${title}`;
  if (before && !after) return `Delete ${title}`;

  const oldHistoryLength = Array.isArray(before?.history) ? before.history.length : 0;
  const newHistory = Array.isArray(after?.history) ? after.history : [];
  const event = newHistory.length > oldHistoryLength ? newHistory[newHistory.length - 1]?.type : null;
  const labels = {
    completed: "Complete",
    woke: "Wake",
    slept: "Sleep",
    "sleep-updated": "Change sleep for",
    "sleep-converted-to-wait": "Convert sleep to waiting for",
    "wait-converted-to-sleep": "Convert waiting to sleep for",
  };
  return `${labels[event] || "Edit"} ${title}`;
}

function emitHistoryState() {
  window.dispatchEvent(
    new CustomEvent("calendar:history-state", {
      detail: {
        canUndo: canUndo(),
        canRedo: canRedo(),
        undoLabel: undoLabel(),
        redoLabel: redoLabel(),
      },
    }),
  );
}

async function readPersistedHistory() {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, "readonly");
    const req = tx.objectStore(HISTORY_STORE).get(historySessionId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function persistHistory() {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, "readwrite");
    tx.objectStore(HISTORY_STORE).put({
      id: historySessionId,
      undoStack,
      redoStack,
      updatedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function persistHistorySafely() {
  try {
    await persistHistory();
  } catch (error) {
    console.error("Could not save undo history", error);
  }
}

const historyReady = (async () => {
  const saved = await readPersistedHistory();
  if (saved) {
    undoStack.push(...(saved.undoStack || []).map(cleanHistoryEntry));
    redoStack.push(...(saved.redoStack || []).map(cleanHistoryEntry));
  }
  emitHistoryState();
})().catch((error) => console.error("Could not load undo history", error));

async function pushHistory(entry) {
  await historyReady;
  const cleanEntry = cleanHistoryEntry(entry);
  if (!cleanEntry?.changes?.length) return;

  if (activeBatch) {
    for (const change of cleanEntry.changes) {
      const existing = activeBatch.changes.find((candidate) => candidate.id === change.id);
      if (existing) existing.after = cloneValue(change.after);
      else activeBatch.changes.push(cloneValue(change));
    }
    return;
  }

  undoStack.push(cleanEntry);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  await persistHistorySafely();
  emitHistoryState();
}

export async function listItems() {
  liveItems = (await listLocalItems()).map(withoutAttachmentBytes);
  return liveItems;
}

export async function listItemsSnapshot() {
  return (await listLocalItems()).map(withoutAttachmentBytes);
}

export async function putItem(item, baseline = null) {
  const uploads = uploadableAttachments(item);
  await uploadAttachmentsBeforePersist(uploads);
  const cleanItem = withoutAttachmentBytes(item);
  const cleanBaseline = withoutAttachmentBytes(baseline);
  const { before, after } = await putLocalItem(cleanItem, cleanBaseline);
  const cleanBefore = withoutAttachmentBytes(before);
  const cleanAfter = withoutAttachmentBytes(after);
  syncLiveItem(item.id, cleanAfter);
  if (applyingHistory) return;

  const historyBefore = cleanBaseline == null ? cleanBefore : cleanBaseline;
  const historyAfter = cleanBaseline == null ? cleanAfter : cleanItem;
  await pushHistory({
    label: actionLabel(cleanBefore, cleanAfter),
    changes: [{ id: item.id, before: historyBefore, after: historyAfter }],
  });
}

export async function deleteItem(id) {
  const { before } = await deleteLocalItem(id);
  const cleanBefore = withoutAttachmentBytes(before);
  syncLiveItem(id, null);
  if (applyingHistory || !cleanBefore) return;
  await pushHistory({
    label: actionLabel(cleanBefore, null),
    changes: [{ id, before: cleanBefore, after: null }],
  });
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
export function undoLabel() { return undoStack.at(-1)?.label || ""; }
export function redoLabel() { return redoStack.at(-1)?.label || ""; }

async function applySnapshot(change, side) {
  const cleanChange = {
    ...change,
    before: withoutAttachmentBytes(change.before),
    after: withoutAttachmentBytes(change.after),
  };
  const after = await applyLocalHistoryChange(cleanChange, side);
  syncLiveItem(change.id, after);
}

export async function undo() {
  await historyReady;
  const entry = undoStack.pop();
  if (!entry) return false;
  applyingHistory = true;
  try {
    for (const change of [...entry.changes].reverse()) await applySnapshot(change, "before");
  } finally {
    applyingHistory = false;
  }
  redoStack.push(entry);
  await persistHistorySafely();
  emitHistoryState();
  return true;
}

export async function redo() {
  await historyReady;
  const entry = redoStack.pop();
  if (!entry) return false;
  applyingHistory = true;
  try {
    for (const change of entry.changes) await applySnapshot(change, "after");
  } finally {
    applyingHistory = false;
  }
  undoStack.push(entry);
  await persistHistorySafely();
  emitHistoryState();
  return true;
}

async function beginBatch(label) {
  await historyReady;
  if (activeBatch) throw new Error("Nested history batches are not supported.");
  activeBatch = { label, changes: [] };
}

async function endBatch() {
  const batch = activeBatch;
  activeBatch = null;
  if (!batch?.changes.length) return;
  undoStack.push(batch);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  await persistHistorySafely();
  emitHistoryState();
}

export async function exportData() {
  const items = (await listLocalItems()).map(withoutAttachmentBytes);
  return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), items }, null, 2);
}

export async function importData(text) {
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(items)) throw new Error("Import file does not contain an items array.");
  if (items.some((item) => (item?.attachments || []).some((attachment) => attachment?.dataUrl || attachment?.blob))) {
    throw new Error("This backup contains browser-stored attachment bytes and must be migrated to server attachment storage before import.");
  }
  await beginBatch("Import backup");
  let imported = 0;
  try {
    for (const raw of items) {
      if (!raw?.id || !raw?.kind) continue;
      await putItem(withoutAttachmentBytes(raw));
      imported += 1;
    }
  } finally {
    await endBatch();
  }
  return imported;
}

export function readSyncSnapshot() { return readLocalSyncSnapshot(); }

export async function mergeSyncSnapshot(bytes) {
  const items = (await mergeLocalSyncSnapshot(bytes)).map(withoutAttachmentBytes);
  replaceLiveItems(items);
  return items;
}

export async function getItem(id) {
  return withoutAttachmentBytes(await getLocalItem(id));
}
