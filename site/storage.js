const DB_NAME = "calendar-app";
const DB_VERSION = 1;
const STORE = "items";

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

export async function listItems() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export function putItem(item) {
  return transaction("readwrite", (store) => store.put(item));
}

export function deleteItem(id) {
  return transaction("readwrite", (store) => store.delete(id));
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
  const items = await listItems();
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
  let imported = 0;
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
  return imported;
}
