import * as Automerge from "@automerge/automerge";
import {
  addAttachmentMetadata,
  addHistoryEntry,
  addTag,
  createCalendarDocument,
  deleteItemField,
  getItemFieldConflicts,
  itemForSync,
  loadCalendarDocument,
  materializeItem,
  materializeItems,
  mergeCalendarDocuments,
  patchItem,
  putItem as putDocumentItem,
  removeAttachmentMetadata,
  removeHistoryEntry,
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

const ITEM_HEADS = Symbol("calendar.automergeHeads");
const COMMON_ITEM_FIELDS = new Set([
  "id",
  "kind",
  "title",
  "notes",
  "tags",
  "attachments",
  "createdAt",
  "updatedAt",
  "deletedAt",
]);
const TASK_ITEM_FIELDS = new Set([
  ...COMMON_ITEM_FIELDS,
  "state",
  "availableFrom",
  "deadline",
  "latestStart",
  "sleep",
  "availabilitySchedule",
  "completedAt",
  "history",
]);
const EVENT_ITEM_FIELDS = new Set([
  ...COMMON_ITEM_FIELDS,
  "start",
  "end",
]);
const SPECIAL_DELTA_FIELDS = new Set([
  "id",
  "title",
  "notes",
  "tags",
  "attachments",
  "history",
  "deletedAt",
]);

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

function hydrateItem(item, localAttachments, heads = null) {
  if (!item) return null;
  const copy = cloneValue(item);
  if (Array.isArray(copy.attachments)) {
    copy.attachments = copy.attachments.map((attachment) => {
      const blob = localAttachments.get(attachment.id);
      return blob ? { ...attachment, blob } : attachment;
    });
  }
  if (heads) {
    Object.defineProperty(copy, ITEM_HEADS, {
      value: [...heads],
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return copy;
}

function hydrateItems(items, localAttachments, heads = null) {
  return items.map((item) => hydrateItem(item, localAttachments, heads));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fingerprint(value) {
  return JSON.stringify(value);
}

function listDifference(left = [], right = []) {
  const remaining = new Map();
  for (const value of right) {
    const key = fingerprint(value);
    remaining.set(key, (remaining.get(key) || 0) + 1);
  }
  const result = [];
  for (const value of left) {
    const key = fingerprint(value);
    const count = remaining.get(key) || 0;
    if (count > 0) remaining.set(key, count - 1);
    else result.push(value);
  }
  return result;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function allowedFieldsForKind(kind) {
  if (kind === "task") return TASK_ITEM_FIELDS;
  if (kind === "event") return EVENT_ITEM_FIELDS;
  throw new Error(`Unknown item kind ${kind}.`);
}

function getPathParent(root, path) {
  let parent = root;
  for (const segment of path.slice(0, -1)) parent = parent[segment];
  return { parent, key: path.at(-1) };
}

function pathUsesCollaborativeText(path, before, after) {
  return (
    path.length === 3 &&
    path[0] === "items" &&
    ["title", "notes"].includes(path[2]) &&
    typeof before === "string" &&
    typeof after === "string"
  );
}

function applyDraftValue(root, path, before, after, afterPresent = true) {
  if (afterPresent && sameValue(before, after)) return;
  const { parent, key } = getPathParent(root, path);
  if (!afterPresent) {
    if (parent && Object.hasOwn(parent, key)) delete parent[key];
    return;
  }

  if (pathUsesCollaborativeText(path, before, after)) {
    Automerge.updateText(root, path, after);
    return;
  }

  if (isPlainObject(before) && isPlainObject(after) && parent?.[key] && typeof parent[key] === "object") {
    const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const field of fields) {
      applyDraftValue(
        root,
        [...path, field],
        before[field],
        after[field],
        Object.hasOwn(after, field),
      );
    }
    return;
  }

  parent[key] = after;
}

function mutateDraftFromIntent(draft, baseline, next) {
  const item = draft.items[next.id];
  if (!item) return;

  for (const field of ["title", "notes"]) {
    if (sameValue(baseline[field], next[field])) continue;
    applyDraftValue(
      draft,
      ["items", next.id, field],
      baseline[field],
      next[field],
      Object.hasOwn(next, field),
    );
  }

  if (!sameValue(baseline.tags || [], next.tags || [])) {
    if (!Array.isArray(item.tags)) item.tags = [];
    for (const tag of listDifference(baseline.tags || [], next.tags || [])) {
      const index = item.tags.indexOf(tag);
      if (index >= 0) item.tags.splice(index, 1);
    }
    for (const tag of listDifference(next.tags || [], baseline.tags || [])) {
      if (!item.tags.includes(tag)) item.tags.push(tag);
    }
  }

  const baselineAttachments = new Map((baseline.attachments || []).map((attachment) => [attachment.id, attachment]));
  const nextAttachments = new Map((next.attachments || []).map((attachment) => [attachment.id, attachment]));
  if (!Array.isArray(item.attachments)) item.attachments = [];
  for (const [attachmentId] of baselineAttachments) {
    if (nextAttachments.has(attachmentId)) continue;
    const index = item.attachments.findIndex((candidate) => candidate.id === attachmentId);
    if (index >= 0) item.attachments.splice(index, 1);
  }
  for (const [attachmentId, attachment] of nextAttachments) {
    const beforeAttachment = baselineAttachments.get(attachmentId);
    if (beforeAttachment && sameValue(beforeAttachment, attachment)) continue;
    const index = item.attachments.findIndex((candidate) => candidate.id === attachmentId);
    if (index < 0) item.attachments.push(attachment);
    else {
      const fields = new Set([...Object.keys(beforeAttachment || {}), ...Object.keys(attachment)]);
      for (const field of fields) {
        applyDraftValue(
          draft,
          ["items", next.id, "attachments", index, field],
          beforeAttachment?.[field],
          attachment[field],
          Object.hasOwn(attachment, field),
        );
      }
    }
  }

  if (!Array.isArray(item.history) && ((baseline.history || []).length || (next.history || []).length)) item.history = [];
  for (const entry of listDifference(baseline.history || [], next.history || [])) {
    const entryFingerprint = fingerprint(entry);
    const index = (item.history || []).findIndex((candidate) => fingerprint(candidate) === entryFingerprint);
    if (index >= 0) item.history.splice(index, 1);
  }
  for (const entry of listDifference(next.history || [], baseline.history || [])) {
    const entryFingerprint = fingerprint(entry);
    if (!(item.history || []).some((candidate) => fingerprint(candidate) === entryFingerprint)) item.history.push(entry);
  }

  const fields = new Set([...Object.keys(baseline), ...Object.keys(next)]);
  for (const field of fields) {
    if (SPECIAL_DELTA_FIELDS.has(field) || sameValue(baseline[field], next[field])) continue;
    applyDraftValue(
      draft,
      ["items", next.id, field],
      baseline[field],
      next[field],
      Object.hasOwn(next, field),
    );
  }

  if (baseline.kind !== next.kind) {
    const allowed = allowedFieldsForKind(next.kind);
    for (const field of Object.keys(item)) {
      if (!allowed.has(field)) delete item[field];
    }
  }
}

function applyItemIntentAtHeads(doc, heads, baselineItem, nextItem) {
  const baseline = itemForSync(baselineItem);
  const next = itemForSync(nextItem);
  if (baseline.id !== next.id) throw new Error("Item edit baseline must use the same id as the submitted item.");
  if (!Automerge.hasHeads(doc, heads)) return null;

  const { newDoc } = Automerge.changeAt(doc, heads, `Edit item ${next.id}`, (draft) => {
    mutateDraftFromIntent(draft, baseline, next);
  });
  return newDoc;
}

function applyItemIntent(doc, baselineItem, nextItem, { restoreDeleted = false } = {}) {
  const next = itemForSync(nextItem);
  let current = materializeItem(doc, next.id, { includeDeleted: true });
  if (!current) return putDocumentItem(doc, next);

  if (restoreDeleted && current.deletedAt) {
    doc = restoreItem(doc, next.id);
    current = materializeItem(doc, next.id, { includeDeleted: true });
  }

  const baseline = baselineItem ? itemForSync(baselineItem) : itemForSync(current);
  if (baseline.id !== next.id) throw new Error("Item edit baseline must use the same id as the submitted item.");

  for (const field of ["title", "notes"]) {
    if (sameValue(baseline[field], next[field])) continue;
    if (!Object.hasOwn(next, field)) {
      doc = deleteItemField(doc, next.id, field, `Clear ${field} for ${next.id}`);
    } else {
      doc = updateItemText(doc, next.id, field, String(next[field] ?? ""));
    }
  }

  for (const tag of listDifference(baseline.tags || [], next.tags || [])) {
    doc = removeTag(doc, next.id, tag);
  }
  for (const tag of listDifference(next.tags || [], baseline.tags || [])) {
    doc = addTag(doc, next.id, tag);
  }

  const baselineAttachments = new Map((baseline.attachments || []).map((attachment) => [attachment.id, attachment]));
  const nextAttachments = new Map((next.attachments || []).map((attachment) => [attachment.id, attachment]));
  for (const [attachmentId] of baselineAttachments) {
    if (!nextAttachments.has(attachmentId)) {
      doc = removeAttachmentMetadata(doc, next.id, attachmentId);
    }
  }
  for (const [attachmentId, attachment] of nextAttachments) {
    const beforeAttachment = baselineAttachments.get(attachmentId);
    if (!beforeAttachment || !sameValue(beforeAttachment, attachment)) {
      doc = addAttachmentMetadata(doc, next.id, attachment);
    }
  }

  for (const entry of listDifference(baseline.history || [], next.history || [])) {
    doc = removeHistoryEntry(doc, next.id, entry);
  }
  for (const entry of listDifference(next.history || [], baseline.history || [])) {
    doc = addHistoryEntry(doc, next.id, entry);
  }

  const fields = new Set([...Object.keys(baseline), ...Object.keys(next)]);
  for (const field of fields) {
    if (SPECIAL_DELTA_FIELDS.has(field) || sameValue(baseline[field], next[field])) continue;
    if (!Object.hasOwn(next, field)) {
      doc = deleteItemField(doc, next.id, field);
    } else {
      doc = patchItem(doc, next.id, { [field]: next[field] });
    }
  }

  if (baseline.kind !== next.kind) {
    const allowed = allowedFieldsForKind(next.kind);
    current = materializeItem(doc, next.id, { includeDeleted: true });
    for (const field of Object.keys(current)) {
      if (!allowed.has(field)) doc = deleteItemField(doc, next.id, field, `Remove ${field} after kind conversion for ${next.id}`);
    }
  }

  return doc;
}

function applyHistoryDelta(doc, before, after, side) {
  const source = side === "before" ? after : before;
  const target = side === "before" ? before : after;
  const id = target?.id || source?.id;
  let current = materializeItem(doc, id, { includeDeleted: true });

  if (!source && target) {
    if (!current) return putDocumentItem(doc, target, `Redo create ${id}`);
    if (current.deletedAt) return restoreItem(doc, id, `Restore ${id}`);
    return doc;
  }
  if (source && !target) {
    if (!current || current.deletedAt) return doc;
    return tombstoneItem(doc, id, new Date().toISOString(), `Undo create/delete ${id}`);
  }
  if (!source || !target || !current) return doc;

  for (const field of ["title", "notes"]) {
    if (sameValue(source[field], target[field])) continue;
    current = materializeItem(doc, id, { includeDeleted: true });
    if (sameValue(current?.[field], source[field])) {
      if (!Object.hasOwn(target, field)) doc = deleteItemField(doc, id, field, `History clear ${field} for ${id}`);
      else doc = updateItemText(doc, id, field, String(target[field] ?? ""), `History ${field} for ${id}`);
    }
  }

  for (const tag of listDifference(source.tags || [], target.tags || [])) {
    doc = removeTag(doc, id, tag, `History remove tag for ${id}`);
  }
  for (const tag of listDifference(target.tags || [], source.tags || [])) {
    doc = addTag(doc, id, tag, `History add tag for ${id}`);
  }

  const sourceAttachments = new Map((source.attachments || []).map((attachment) => [attachment.id, attachment]));
  const targetAttachments = new Map((target.attachments || []).map((attachment) => [attachment.id, attachment]));
  for (const [attachmentId] of sourceAttachments) {
    if (!targetAttachments.has(attachmentId)) {
      doc = removeAttachmentMetadata(doc, id, attachmentId, `History remove attachment for ${id}`);
    }
  }
  for (const [attachmentId, attachment] of targetAttachments) {
    const sourceAttachment = sourceAttachments.get(attachmentId);
    current = materializeItem(doc, id, { includeDeleted: true });
    const currentAttachment = (current?.attachments || []).find((candidate) => candidate.id === attachmentId);
    if (!sourceAttachment || (sameValue(currentAttachment, sourceAttachment) && !sameValue(sourceAttachment, attachment))) {
      doc = addAttachmentMetadata(doc, id, attachment, `History attachment for ${id}`);
    }
  }

  for (const entry of listDifference(source.history || [], target.history || [])) {
    doc = removeHistoryEntry(doc, id, entry, `History remove audit entry for ${id}`);
  }
  for (const entry of listDifference(target.history || [], source.history || [])) {
    doc = addHistoryEntry(doc, id, entry, `History add audit entry for ${id}`);
  }

  const fields = new Set([...Object.keys(source), ...Object.keys(target)]);
  for (const field of fields) {
    if (SPECIAL_DELTA_FIELDS.has(field) || sameValue(source[field], target[field])) continue;
    current = materializeItem(doc, id, { includeDeleted: true });
    if (!sameValue(current?.[field], source[field])) continue;
    if (!Object.hasOwn(target, field)) doc = deleteItemField(doc, id, field, `History clear ${field} for ${id}`);
    else doc = patchItem(doc, id, { [field]: target[field] }, `History ${field} for ${id}`);
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
  return hydrateItems(materializeItems(doc), localAttachments, Automerge.getHeads(doc));
}

export async function getLocalItem(id) {
  const { doc, localAttachments } = await readState();
  return hydrateItem(materializeItem(doc, id), localAttachments, Automerge.getHeads(doc));
}

export function putLocalItem(item, baseline = null) {
  const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
  const baselineHeads = baseline?.[ITEM_HEADS] || null;
  return writeState((doc, localAttachments) => {
    const currentHeads = Automerge.getHeads(doc);
    const before = hydrateItem(materializeItem(doc, item.id), localAttachments, currentHeads);
    const current = materializeItem(doc, item.id, { includeDeleted: true });
    const historicalEdit = baseline && baselineHeads
      ? applyItemIntentAtHeads(doc, baselineHeads, baseline, item)
      : null;
    const nextDoc = historicalEdit || applyItemIntent(
      doc,
      baseline || current,
      item,
      { restoreDeleted: baseline == null },
    );
    const after = hydrateItem(
      materializeItem(nextDoc, item.id),
      localAttachments,
      Automerge.getHeads(nextDoc),
    );
    return { doc: nextDoc, result: { before, after } };
  }, attachments);
}

export function deleteLocalItem(id, deletedAt = new Date().toISOString()) {
  return writeState((doc, localAttachments) => {
    const before = hydrateItem(materializeItem(doc, id), localAttachments, Automerge.getHeads(doc));
    if (!before) return { doc, result: { before: null, after: null } };
    const nextDoc = tombstoneItem(doc, id, deletedAt);
    return { doc: nextDoc, result: { before, after: null } };
  });
}

export function applyLocalHistoryChange(change, side) {
  const target = side === "before" ? change.before : change.after;
  const attachments = Array.isArray(target?.attachments) ? target.attachments : [];
  return writeState((doc, localAttachments) => {
    const nextDoc = applyHistoryDelta(doc, change.before, change.after, side);
    const after = hydrateItem(
      materializeItem(nextDoc, change.id),
      localAttachments,
      Automerge.getHeads(nextDoc),
    );
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
    const items = hydrateItems(materializeItems(merged), localAttachments, Automerge.getHeads(merged));
    return { doc: merged, result: items };
  });
}

export async function getLocalItemFieldConflicts(id, field) {
  const { doc } = await readState();
  return getItemFieldConflicts(doc, id, field);
}
