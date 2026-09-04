import {
  addAttachmentMetadata,
  addTag,
  createCalendarDocument,
  getItemFieldConflicts,
  itemForSync,
  loadCalendarDocument,
  materializeItem,
  materializeItems,
  mergeCalendarDocuments,
  patchItem,
  putItem as putDocumentItem,
  removeTag,
  restoreItem,
  saveCalendarDocument,
  tombstoneItem,
  updateItemText,
} from "../sync/automerge-document.js";

export const CALENDAR_DATA_DB_NAME = "calendar-automerge";
export const CALENDAR_DATA_DB_VERSION = 1;
export const CALENDAR_DOCUMENT_STORE = "documents";
export const CALENDAR_ATTACHMENT_STORE = "attachments";
export const CALENDAR_DOCUMENT_ID = "primary";

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

function cloneValue(value) {
  return value == null ? value : structuredClone(value);
}

function attachmentsById(records) {
  return new Map((records || []).map((record) => [record.id, record.blob]));
}

function hydrateItem(item, localAttachments) {
  if (!item) return null;
  const copy = cloneValue(item);
  if (Array.isArray(copy.attachments)) {
    copy.attachments = copy.attachments.map((attachment) => {
      const blob = localAttachments.get(attachment.id);
      return blob ? { ...attachment, blob } : attachment;
    });
  }
  return copy;
}

function hydrateItems(items, localAttachments) {
  return items.map((item) => hydrateItem(item, localAttachments));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reconcileItem(doc, item) {
  const next = itemForSync(item);
  let current = materializeItem(doc, next.id, { includeDeleted: true });
  if (!current) return putDocumentItem(doc, next);

  if (current.deletedAt) {
    doc = restoreItem(doc, next.id);
    current = materializeItem(doc, next.id, { includeDeleted: true });
  }

  for (const field of ["title", "notes"]) {
    const nextValue = String(next[field] ?? "");
    if (String(current[field] ?? "") !== nextValue) {
      doc = updateItemText(doc, next.id, field, nextValue);
      current = materializeItem(doc, next.id, { includeDeleted: true });
    }
  }

  const currentTags = new Set(current.tags || []);
  const nextTags = new Set(next.tags || []);
  for (const tag of currentTags) {
    if (!nextTags.has(tag)) doc = removeTag(doc, next.id, tag);
  }
  for (const tag of nextTags) {
    if (!currentTags.has(tag)) doc = addTag(doc, next.id, tag);
  }
  current = materializeItem(doc, next.id, { includeDeleted: true });

  for (const attachment of next.attachments || []) {
    const existing = (current.attachments || []).find((candidate) => candidate.id === attachment.id);
    if (!existing || !sameValue(existing, attachment)) {
      doc = addAttachmentMetadata(doc, next.id, attachment);
    }
  }
  current = materializeItem(doc, next.id, { includeDeleted: true });

  const specialFields = new Set(["id", "title", "notes", "tags", "attachments", "deletedAt"]);
  for (const [field, value] of Object.entries(next)) {
    if (specialFields.has(field)) continue;
    if (!sameValue(current[field], value)) {
      doc = patchItem(doc, next.id, { [field]: value });
      current = materializeItem(doc, next.id, { includeDeleted: true });
    }
  }

  return doc;
}

function readState() {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction([CALENDAR_DOCUMENT_STORE, CALENDAR_ATTACHMENT_STORE], "readonly");
    const documentRequest = tx.objectStore(CALENDAR_DOCUMENT_STORE).get(CALENDAR_DOCUMENT_ID);
    const attachmentsRequest = tx.objectStore(CALENDAR_ATTACHMENT_STORE).getAll();
    let documentRecord = null;
    let attachmentRecords = [];

    documentRequest.onsuccess = () => { documentRecord = documentRequest.result || null; };
    documentRequest.onerror = () => reject(documentRequest.error);
    attachmentsRequest.onsuccess = () => { attachmentRecords = attachmentsRequest.result || []; };
    attachmentsRequest.onerror = () => reject(attachmentsRequest.error);
    tx.oncomplete = () => {
      db.close();
      const doc = documentRecord?.bytes
        ? loadCalendarDocument(documentRecord.bytes)
        : createCalendarDocument();
      resolve({ doc, localAttachments: attachmentsById(attachmentRecords) });
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction aborted"));
    };
  }));
}

function writeState(mutator, attachments = []) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction([CALENDAR_DOCUMENT_STORE, CALENDAR_ATTACHMENT_STORE], "readwrite");
    const documentStore = tx.objectStore(CALENDAR_DOCUMENT_STORE);
    const attachmentStore = tx.objectStore(CALENDAR_ATTACHMENT_STORE);
    const documentRequest = documentStore.get(CALENDAR_DOCUMENT_ID);
    const attachmentsRequest = attachmentStore.getAll();
    let documentRecord = null;
    let attachmentRecords = [];
    let documentReady = false;
    let attachmentsReady = false;
    let result;
    let applied = false;

    const apply = () => {
      if (applied || !documentReady || !attachmentsReady) return;
      applied = true;
      try {
        const currentDoc = documentRecord?.bytes
          ? loadCalendarDocument(documentRecord.bytes)
          : createCalendarDocument();
        const localAttachments = attachmentsById(attachmentRecords);
        for (const attachment of attachments || []) {
          if (!attachment?.id || !(attachment.blob instanceof Blob)) continue;
          localAttachments.set(attachment.id, attachment.blob);
          attachmentStore.put({ id: attachment.id, blob: attachment.blob });
        }
        const outcome = mutator(currentDoc, localAttachments);
        if (!outcome?.doc) throw new Error("Automerge storage mutation must return a document.");
        documentStore.put({ id: CALENDAR_DOCUMENT_ID, bytes: saveCalendarDocument(outcome.doc) });
        result = outcome.result;
      } catch (error) {
        try { tx.abort(); } catch {}
        reject(error);
      }
    };

    documentRequest.onsuccess = () => {
      documentRecord = documentRequest.result || null;
      documentReady = true;
      apply();
    };
    documentRequest.onerror = () => reject(documentRequest.error);
    attachmentsRequest.onsuccess = () => {
      attachmentRecords = attachmentsRequest.result || [];
      attachmentsReady = true;
      apply();
    };
    attachmentsRequest.onerror = () => reject(attachmentsRequest.error);
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
  }));
}

export async function listLocalItems() {
  const { doc, localAttachments } = await readState();
  return hydrateItems(materializeItems(doc), localAttachments);
}

export async function getLocalItem(id) {
  const { doc, localAttachments } = await readState();
  return hydrateItem(materializeItem(doc, id), localAttachments);
}

export function putLocalItem(item) {
  const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
  return writeState((doc, localAttachments) => {
    const before = hydrateItem(materializeItem(doc, item.id), localAttachments);
    const nextDoc = reconcileItem(doc, item);
    const after = hydrateItem(materializeItem(nextDoc, item.id), localAttachments);
    return { doc: nextDoc, result: { before, after } };
  }, attachments);
}

export function deleteLocalItem(id, deletedAt = new Date().toISOString()) {
  return writeState((doc, localAttachments) => {
    const before = hydrateItem(materializeItem(doc, id), localAttachments);
    if (!before) return { doc, result: { before: null, after: null } };
    const nextDoc = tombstoneItem(doc, id, deletedAt);
    return { doc: nextDoc, result: { before, after: null } };
  });
}

export function applyLocalSnapshot(id, snapshot) {
  const attachments = Array.isArray(snapshot?.attachments) ? snapshot.attachments : [];
  return writeState((doc, localAttachments) => {
    const current = materializeItem(doc, id, { includeDeleted: true });
    let nextDoc = doc;
    if (snapshot == null) {
      if (current && !current.deletedAt) nextDoc = tombstoneItem(doc, id, new Date().toISOString());
    } else {
      if (current?.deletedAt) nextDoc = restoreItem(nextDoc, id);
      nextDoc = reconcileItem(nextDoc, snapshot);
    }
    const after = hydrateItem(materializeItem(nextDoc, id), localAttachments);
    return { doc: nextDoc, result: after };
  }, attachments);
}

export async function readLocalSyncSnapshot() {
  const { doc } = await readState();
  return saveCalendarDocument(doc);
}

export function mergeLocalSyncSnapshot(incomingBytes) {
  return writeState((doc, localAttachments) => {
    const remote = loadCalendarDocument(incomingBytes);
    const merged = mergeCalendarDocuments(doc, remote);
    const items = hydrateItems(materializeItems(merged), localAttachments);
    return { doc: merged, result: items };
  });
}

export async function getLocalItemFieldConflicts(id, field) {
  const { doc } = await readState();
  return getItemFieldConflicts(doc, id, field);
}
