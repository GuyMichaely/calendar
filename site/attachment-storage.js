import {
  CALENDAR_ATTACHMENT_STORE,
  CALENDAR_DATA_DB_NAME,
  CALENDAR_DATA_DB_VERSION,
  CALENDAR_DOCUMENT_STORE,
} from "./automerge-storage.js";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CALENDAR_DATA_DB_NAME, CALENDAR_DATA_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CALENDAR_DOCUMENT_STORE)) {
        db.createObjectStore(CALENDAR_DOCUMENT_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CALENDAR_ATTACHMENT_STORE)) {
        db.createObjectStore(CALENDAR_ATTACHMENT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getLocalAttachmentBlob(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CALENDAR_ATTACHMENT_STORE, "readonly");
    const request = tx.objectStore(CALENDAR_ATTACHMENT_STORE).get(id);
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function putLocalAttachmentBlob(id, blob) {
  if (!id) throw new Error("Attachment blob requires an id.");
  if (!(blob instanceof Blob)) throw new Error("Attachment blob storage requires a Blob value.");
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CALENDAR_ATTACHMENT_STORE, "readwrite");
    tx.objectStore(CALENDAR_ATTACHMENT_STORE).put({ id, blob });
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
      reject(tx.error || new Error("Attachment storage transaction aborted"));
    };
  });
}
