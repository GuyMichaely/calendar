import * as Automerge from "@automerge/automerge";

export const CALENDAR_SCHEMA_VERSION = 1;
const COLLABORATIVE_TEXT_FIELDS = new Set(["title", "notes"]);
const LOCAL_ATTACHMENT_FIELDS = new Set(["blob", "dataUrl", "file"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneForDocument(value, key = null) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof Blob !== "undefined" && value instanceof Blob) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => cloneForDocument(entry)).filter((entry) => entry !== undefined);
  }

  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (key === "attachments" && LOCAL_ATTACHMENT_FIELDS.has(childKey)) continue;
    const cloned = cloneForDocument(childValue, childKey);
    if (cloned !== undefined) result[childKey] = cloned;
  }
  return result;
}

export function itemForSync(item) {
  if (!item?.id || !item?.kind) throw new Error("Synced items require id and kind.");

  const copy = cloneForDocument(item);
  if (Array.isArray(copy.attachments)) {
    copy.attachments = copy.attachments.map((attachment) => {
      const metadata = {};
      for (const [key, value] of Object.entries(attachment || {})) {
        if (LOCAL_ATTACHMENT_FIELDS.has(key)) continue;
        metadata[key] = value;
      }
      return metadata;
    });
  }
  return copy;
}

function plainClone(value) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(plainClone);
  const result = {};
  for (const [key, child] of Object.entries(value)) result[key] = plainClone(child);
  return result;
}

function assertDocument(doc) {
  if (!doc || doc.schemaVersion !== CALENDAR_SCHEMA_VERSION || !doc.items || typeof doc.items !== "object") {
    throw new Error(`Expected calendar sync schema ${CALENDAR_SCHEMA_VERSION}.`);
  }
}

export function createCalendarDocument(items = []) {
  const initialItems = {};
  for (const item of items) {
    const copy = itemForSync(item);
    initialItems[copy.id] = copy;
  }
  return Automerge.from({ schemaVersion: CALENDAR_SCHEMA_VERSION, items: initialItems });
}

export function forkCalendarDocument(doc) {
  assertDocument(doc);
  return Automerge.clone(doc);
}

function pathUsesCollaborativeText(path, value, current) {
  return (
    path.length === 3 &&
    path[0] === "items" &&
    COLLABORATIVE_TEXT_FIELDS.has(path[2]) &&
    typeof value === "string" &&
    typeof current === "string"
  );
}

function applyPatchValue(root, path, current, value) {
  if (pathUsesCollaborativeText(path, value, current)) {
    Automerge.updateText(root, path, value);
    return;
  }

  const parentPath = path.slice(0, -1);
  const key = path.at(-1);
  let parent = root;
  for (const segment of parentPath) parent = parent[segment];

  if (isPlainObject(value) && current && typeof current === "object" && !Array.isArray(current)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      applyPatchValue(root, [...path, childKey], current[childKey], childValue);
    }
    return;
  }

  parent[key] = value;
}

export function patchItem(doc, id, patch, message = `Update item ${id}`) {
  assertDocument(doc);
  if (!doc.items[id]) throw new Error(`Unknown item ${id}.`);
  const cleanPatch = cloneForDocument(patch);
  return Automerge.change(doc, message, (draft) => {
    for (const [key, value] of Object.entries(cleanPatch)) {
      if (key === "id") continue;
      applyPatchValue(draft, ["items", id, key], draft.items[id][key], value);
    }
  });
}

export function deleteItemField(doc, id, field, message = `Clear ${field} for ${id}`) {
  assertDocument(doc);
  if (!doc.items[id]) throw new Error(`Unknown item ${id}.`);
  if (!(field in doc.items[id])) return doc;
  return Automerge.change(doc, message, (draft) => {
    delete draft.items[id][field];
  });
}

export function putItem(doc, item, message = `Put item ${item?.id || ""}`) {
  assertDocument(doc);
  const copy = itemForSync(item);
  if (!doc.items[copy.id]) {
    return Automerge.change(doc, message, (draft) => {
      draft.items[copy.id] = copy;
    });
  }
  return patchItem(doc, copy.id, copy, message);
}

export function updateItemText(doc, id, field, value, message = `Update ${field} for ${id}`) {
  if (!COLLABORATIVE_TEXT_FIELDS.has(field)) throw new Error(`${field} is not a collaborative text field.`);
  return patchItem(doc, id, { [field]: String(value ?? "") }, message);
}

export function addTag(doc, id, tag, message = `Add tag to ${id}`) {
  assertDocument(doc);
  const value = String(tag || "").trim();
  if (!value) return doc;
  if (!doc.items[id]) throw new Error(`Unknown item ${id}.`);
  if ((doc.items[id].tags || []).includes(value)) return doc;

  return Automerge.change(doc, message, (draft) => {
    if (!Array.isArray(draft.items[id].tags)) draft.items[id].tags = [];
    draft.items[id].tags.push(value);
  });
}

export function removeTag(doc, id, tag, message = `Remove tag from ${id}`) {
  assertDocument(doc);
  if (!doc.items[id]) throw new Error(`Unknown item ${id}.`);
  const index = (doc.items[id].tags || []).indexOf(tag);
  if (index < 0) return doc;

  return Automerge.change(doc, message, (draft) => {
    draft.items[id].tags.splice(index, 1);
  });
}

export function addAttachmentMetadata(doc, id, attachment, message = `Attach file to ${id}`) {
  assertDocument(doc);
  if (!doc.items[id]) throw new Error(`Unknown item ${id}.`);
  const clean = cloneForDocument(attachment);
  for (const field of LOCAL_ATTACHMENT_FIELDS) delete clean[field];
  if (!clean.id) throw new Error("Attachment metadata requires an id.");

  const currentIndex = (doc.items[id].attachments || []).findIndex((candidate) => candidate.id === clean.id);
  if (currentIndex >= 0) {
    return Automerge.change(doc, message, (draft) => {
      const current = draft.items[id].attachments[currentIndex];
      for (const [key, value] of Object.entries(clean)) current[key] = value;
    });
  }

  return Automerge.change(doc, message, (draft) => {
    if (!Array.isArray(draft.items[id].attachments)) draft.items[id].attachments = [];
    draft.items[id].attachments.push(clean);
  });
}

export function removeAttachmentMetadata(doc, id, attachmentId, message = `Remove attachment from ${id}`) {
  assertDocument(doc);
  if (!doc.items[id]) throw new Error(`Unknown item ${id}.`);
  const index = (doc.items[id].attachments || []).findIndex((candidate) => candidate.id === attachmentId);
  if (index < 0) return doc;
  return Automerge.change(doc, message, (draft) => {
    draft.items[id].attachments.splice(index, 1);
  });
}

function valueFingerprint(value) {
  return JSON.stringify(plainClone(value));
}

export function addHistoryEntry(doc, id, entry, message = `Append history for ${id}`) {
  assertDocument(doc);
  if (!doc.items[id]) throw new Error(`Unknown item ${id}.`);
  const clean = cloneForDocument(entry);
  const fingerprint = valueFingerprint(clean);
  if ((doc.items[id].history || []).some((candidate) => valueFingerprint(candidate) === fingerprint)) return doc;
  return Automerge.change(doc, message, (draft) => {
    if (!Array.isArray(draft.items[id].history)) draft.items[id].history = [];
    draft.items[id].history.push(clean);
  });
}

export function removeHistoryEntry(doc, id, entry, message = `Remove history for ${id}`) {
  assertDocument(doc);
  if (!doc.items[id]) throw new Error(`Unknown item ${id}.`);
  const fingerprint = valueFingerprint(entry);
  const index = (doc.items[id].history || []).findIndex((candidate) => valueFingerprint(candidate) === fingerprint);
  if (index < 0) return doc;
  return Automerge.change(doc, message, (draft) => {
    draft.items[id].history.splice(index, 1);
  });
}

export function tombstoneItem(doc, id, deletedAt, message = `Delete item ${id}`) {
  assertDocument(doc);
  if (!doc.items[id]) throw new Error(`Unknown item ${id}.`);
  const when = deletedAt instanceof Date ? deletedAt.toISOString() : String(deletedAt || "");
  if (!when) throw new Error("Tombstones require an explicit deletion time.");
  return patchItem(doc, id, { deletedAt: when }, message);
}

export function restoreItem(doc, id, message = `Restore item ${id}`) {
  assertDocument(doc);
  if (!doc.items[id]) throw new Error(`Unknown item ${id}.`);
  if (!("deletedAt" in doc.items[id])) return doc;
  return Automerge.change(doc, message, (draft) => {
    delete draft.items[id].deletedAt;
  });
}

export function materializeItems(doc, { includeDeleted = false } = {}) {
  assertDocument(doc);
  return Object.values(doc.items)
    .filter((item) => includeDeleted || !item.deletedAt)
    .map(plainClone);
}

export function materializeItem(doc, id, { includeDeleted = false } = {}) {
  assertDocument(doc);
  const item = doc.items[id];
  if (!item || (!includeDeleted && item.deletedAt)) return null;
  return plainClone(item);
}

export function mergeCalendarDocuments(local, remote) {
  assertDocument(local);
  assertDocument(remote);
  return Automerge.merge(Automerge.clone(local), Automerge.clone(remote));
}

export function saveCalendarDocument(doc) {
  assertDocument(doc);
  return Automerge.save(doc);
}

export function loadCalendarDocument(bytes) {
  const doc = Automerge.load(bytes);
  assertDocument(doc);
  return doc;
}

export function mergeSnapshotBytes(storedBytes, incomingBytes) {
  if (!incomingBytes) throw new Error("Incoming Automerge bytes are required.");
  const incoming = loadCalendarDocument(incomingBytes);
  const merged = storedBytes
    ? mergeCalendarDocuments(loadCalendarDocument(storedBytes), incoming)
    : Automerge.clone(incoming);
  const bytes = saveCalendarDocument(merged);
  return { storedBytes: bytes, responseBytes: bytes };
}

export function getItemFieldConflicts(doc, id, field) {
  assertDocument(doc);
  const item = doc.items[id];
  if (!item) return [];
  const conflicts = Automerge.getConflicts(item, field);
  return conflicts ? Object.values(conflicts).map(plainClone) : [];
}
