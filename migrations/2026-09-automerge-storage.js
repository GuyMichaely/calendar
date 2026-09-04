// One-off migration from the old `calendar-app/items` IndexedDB store to the
// Solid app's Automerge-backed `calendar-automerge` database.
//
// This file is never loaded by the application. Back up first, then paste it
// into DevTools on guymichaely.com/calendar/ (or /calendar/old/) and run once.
// The old database is left untouched so /calendar/old/ remains a rollback path.

(async () => {
  const OLD_DB = "calendar-app";
  const OLD_STORE = "items";
  const NEW_DB = "calendar-automerge";
  const NEW_VERSION = 1;
  const DOCUMENT_STORE = "documents";
  const ATTACHMENT_STORE = "attachments";
  const DOCUMENT_ID = "primary";
  const FORCE = false;

  const Automerge = await import("https://esm.sh/@automerge/automerge@3.4.1?bundle");

  function openOldDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(OLD_DB);
      let didNotExist = false;
      request.onupgradeneeded = () => {
        didNotExist = request.oldVersion === 0;
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
        if (!db.objectStoreNames.contains(ATTACHMENT_STORE)) {
          db.createObjectStore(ATTACHMENT_STORE, { keyPath: "id" });
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

  function cleanItem(item) {
    const copy = structuredClone(item);
    if (Array.isArray(copy.attachments)) {
      copy.attachments = copy.attachments.map((attachment) => {
        const metadata = { ...attachment };
        delete metadata.blob;
        delete metadata.dataUrl;
        delete metadata.file;
        return metadata;
      });
    }
    return copy;
  }

  function writeNewState(db, bytes, items) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([DOCUMENT_STORE, ATTACHMENT_STORE], "readwrite");
      tx.objectStore(DOCUMENT_STORE).put({ id: DOCUMENT_ID, bytes });
      const attachments = tx.objectStore(ATTACHMENT_STORE);
      for (const item of items) {
        for (const attachment of item.attachments || []) {
          if (attachment?.id && attachment.blob instanceof Blob) {
            attachments.put({ id: attachment.id, blob: attachment.blob });
          }
        }
      }
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

  const oldDb = await openOldDb();
  const oldItems = await readOldItems(oldDb);
  const initialItems = Object.fromEntries(
    oldItems
      .filter((item) => item?.id && item?.kind)
      .map((item) => [item.id, cleanItem(item)]),
  );
  const document = Automerge.from({ schemaVersion: 1, items: initialItems });
  const bytes = Automerge.save(document);

  const newDb = await openNewDb();
  const existing = await readExistingDocument(newDb);
  if (existing?.bytes && !FORCE) {
    const existingDocument = Automerge.load(existing.bytes);
    if (Object.keys(existingDocument.items || {}).length > 0) {
      newDb.close();
      throw new Error(
        `${NEW_DB} already contains calendar data. Migration stopped without changing either database. ` +
        "Set FORCE = true only if you intentionally want to replace the new Automerge document.",
      );
    }
  }

  await writeNewState(newDb, bytes, oldItems);
  console.log(`Migrated ${Object.keys(initialItems).length} items to ${NEW_DB}. The old ${OLD_DB} database was left unchanged.`);
})();
