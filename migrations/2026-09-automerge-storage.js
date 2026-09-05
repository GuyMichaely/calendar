import * as Automerge from "@automerge/automerge";

export const OLD_DB = "calendar-app";
export const OLD_STORE = "items";
export const NEW_DB = "calendar-automerge";
export const NEW_VERSION = 1;
export const DOCUMENT_STORE = "documents";
export const DOCUMENT_ID = "primary";

function openOldDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OLD_DB);
    let didNotExist = false;
    request.onupgradeneeded = (event) => {
      didNotExist = event.oldVersion === 0;
      request.transaction.abort();
    };
    request.onsuccess = () => {
      if (!request.result.objectStoreNames.contains(OLD_STORE)) {
        request.result.close();
        reject(new Error(`Old store ${OLD_DB}/${OLD_STORE} was not found.`));
        return;
      }
      resolve(request.result);
    };
    request.onerror = () => reject(new Error(didNotExist
      ? `Old database ${OLD_DB} was not found.`
      : `Could not open ${OLD_DB}: ${request.error?.message || request.error}`));
  });
}

function readOldItems(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OLD_STORE, "readonly");
    const request = tx.objectStore(OLD_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

function openNewDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NEW_DB, NEW_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        db.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readExistingDocument(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCUMENT_STORE, "readonly");
    const request = tx.objectStore(DOCUMENT_STORE).get(DOCUMENT_ID);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function migrateTaskSchema(item, nowDate = new Date(), now = nowDate.toISOString()) {
  if (item.kind !== "task") return item;
  const updated = { ...item };
  const history = [...(updated.history || [])];

  if (updated.state === "waiting") {
    const wake = validDate(updated.wakeAt);
    const available = validDate(updated.availableFrom);
    const wasOldTomorrow = history.some((entry) => entry?.type === "deferred");
    updated.state = "open";
    if (wake && wasOldTomorrow) {
      updated.sleep = { until: wake.toISOString(), startedAt: now };
    } else if (wake && (!available || wake > available)) {
      updated.availableFrom = wake.toISOString();
    }
  }

  if (Object.hasOwn(updated, "ignoredUntil")) {
    const ignoredUntil = validDate(updated.ignoredUntil);
    if (!updated.sleep && ignoredUntil && ignoredUntil > nowDate) {
      updated.sleep = { until: ignoredUntil.toISOString(), startedAt: now };
    }
    delete updated.ignoredUntil;
  }

  delete updated.wakeAt;
  return updated;
}

export function cleanMigratedItem(item, nowDate = new Date(), now = nowDate.toISOString()) {
  const copy = migrateTaskSchema(structuredClone(item), nowDate, now);
  if (Array.isArray(copy.attachments)) {
    for (const attachment of copy.attachments) {
      if (attachment?.blob instanceof Blob || attachment?.dataUrl || attachment?.file instanceof Blob) {
        throw new Error(
          `Item ${copy.id} contains legacy attachment bytes. This migration intentionally does not discard them.`,
        );
      }
    }
    copy.attachments = copy.attachments.map((attachment) => {
      const metadata = { ...attachment };
      delete metadata.blob;
      delete metadata.dataUrl;
      delete metadata.file;
      delete metadata.url;
      return metadata;
    });
  }
  return copy;
}

function itemCountFromRecord(record) {
  if (!record?.bytes) return 0;
  const document = Automerge.load(record.bytes);
  return Object.keys(document.items || {}).length;
}

export async function inspectAutomergeMigration() {
  const oldDb = await openOldDb();
  const oldItems = await readOldItems(oldDb);
  const newDb = await openNewDb();
  const existing = await readExistingDocument(newDb);
  const existingItemCount = itemCountFromRecord(existing);
  newDb.close();
  return {
    oldItemCount: oldItems.filter((item) => item?.id && item?.kind).length,
    existingItemCount,
  };
}

function writeNewDocument(db, bytes) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCUMENT_STORE, "readwrite");
    tx.objectStore(DOCUMENT_STORE).put({ id: DOCUMENT_ID, bytes });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("Migration transaction aborted."));
    };
  });
}

export async function migrateLegacyCalendarData({ force = false, nowDate = new Date() } = {}) {
  const oldDb = await openOldDb();
  const oldItems = await readOldItems(oldDb);
  const now = nowDate.toISOString();
  const initialItems = Object.fromEntries(
    oldItems
      .filter((item) => item?.id && item?.kind)
      .map((item) => [item.id, cleanMigratedItem(item, nowDate, now)]),
  );
  const document = Automerge.from({ schemaVersion: 1, items: initialItems });
  const bytes = Automerge.save(document);

  const newDb = await openNewDb();
  const existing = await readExistingDocument(newDb);
  if (itemCountFromRecord(existing) > 0 && !force) {
    newDb.close();
    throw new Error(
      `${NEW_DB} already contains calendar data. Migration stopped without changing either database.`,
    );
  }

  await writeNewDocument(newDb, bytes);
  sessionStorage.removeItem("calendar.historySessionId");
  return { migratedItemCount: Object.keys(initialItems).length };
}
