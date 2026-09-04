const DB_NAME = "calendar-app";
const DB_VERSION = 1;
const STORE = "items";

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

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("kind", "kind", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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

function transaction(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        try {
          result = fn(store);
        } catch (error) {
          reject(error);
          return;
        }
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error || new Error("IndexedDB transaction aborted"));
        };
      }),
  );
}

function cloneValue(value) {
  return value == null ? null : structuredClone(value);
}

function syncLiveItem(id, snapshot) {
  if (!liveItems) return;
  const index = liveItems.findIndex((item) => item.id === id);
  if (snapshot == null) {
    if (index >= 0) liveItems.splice(index, 1);
    return;
  }
  const copy = cloneValue(snapshot);
  if (index >= 0) liveItems[index] = copy;
  else liveItems.push(copy);
}

async function getItem(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

function rawPut(item) {
  return transaction("readwrite", (store) => store.put(item));
}

function rawDelete(id) {
  return transaction("readwrite", (store) => store.delete(id));
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
    undoStack.push(...(saved.undoStack || []));
    redoStack.push(...(saved.redoStack || []));
  }
  emitHistoryState();
})().catch((error) => console.error("Could not load undo history", error));

async function pushHistory(entry) {
  await historyReady;
  if (!entry?.changes?.length) return;

  if (activeBatch) {
    for (const change of entry.changes) {
      const existing = activeBatch.changes.find((candidate) => candidate.id === change.id);
      if (existing) existing.after = cloneValue(change.after);
      else activeBatch.changes.push(cloneValue(change));
    }
    return;
  }

  undoStack.push(entry);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  await persistHistorySafely();
  emitHistoryState();
}

async function recordMutation(id, after, operation) {
  const before = await getItem(id);
  await operation();
  syncLiveItem(id, after);
  if (applyingHistory) return;
  await pushHistory({
    label: actionLabel(before, after),
    changes: [{ id, before: cloneValue(before), after: cloneValue(after) }],
  });
}

async function readAllItems() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function listItems() {
  liveItems = await readAllItems();
  return liveItems;
}

export function listItemsSnapshot() {
  return readAllItems();
}

export function putItem(item) {
  return recordMutation(item.id, item, () => rawPut(item));
}

export async function deleteItem(id) {
  const before = await getItem(id);
  await rawDelete(id);
  syncLiveItem(id, null);
  if (applyingHistory || !before) return;
  await pushHistory({
    label: actionLabel(before, null),
    changes: [{ id, before: cloneValue(before), after: null }],
  });
}

export function canUndo() {
  return undoStack.length > 0;
}

export function canRedo() {
  return redoStack.length > 0;
}

export function undoLabel() {
  return undoStack.at(-1)?.label || "";
}

export function redoLabel() {
  return redoStack.at(-1)?.label || "";
}

async function applySnapshot(change, side) {
  const snapshot = change[side];
  if (snapshot == null) await rawDelete(change.id);
  else await rawPut(cloneValue(snapshot));
  syncLiveItem(change.id, snapshot);
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = dataUrl.split(",", 2);
  const mime = header.match(/^data:(.*?);base64$/)?.[1] || "application/octet-stream";
  const binary = atob(encoded || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportData() {
  const items = await readAllItems();
  const portable = [];
  for (const item of items) {
    const copy = { ...item };
    if (Array.isArray(item.attachments)) {
      copy.attachments = [];
      for (const attachment of item.attachments) {
        copy.attachments.push({
          ...attachment,
          blob: undefined,
          dataUrl: attachment.blob ? await blobToDataUrl(attachment.blob) : attachment.dataUrl,
        });
      }
    }
    portable.push(copy);
  }
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items: portable }, null, 2);
}

export async function importData(text) {
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(items)) throw new Error("Import file does not contain an items array.");

  await beginBatch("Import backup");
  let imported = 0;
  try {
    for (const raw of items) {
      if (!raw?.id || !raw?.kind) continue;
      const item = { ...raw };
      if (Array.isArray(raw.attachments)) {
        item.attachments = raw.attachments.map((attachment) => ({
          ...attachment,
          blob: attachment.dataUrl ? dataUrlToBlob(attachment.dataUrl) : attachment.blob,
          dataUrl: undefined,
        }));
      }
      await putItem(item);
      imported += 1;
    }
  } finally {
    await endBatch();
  }
  return imported;
}
