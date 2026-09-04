import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB } from "fake-indexeddb";
import {
  addTag,
  forkCalendarDocument,
  loadCalendarDocument,
  materializeItem,
  saveCalendarDocument,
} from "../sync/automerge-document.js";

globalThis.indexedDB = indexedDB;

globalThis.sessionStorage = {
  values: new Map(),
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
  setItem(key, value) { this.values.set(key, String(value)); },
  removeItem(key) { this.values.delete(key); },
  clear() { this.values.clear(); },
};

globalThis.window = new EventTarget();
if (typeof globalThis.CustomEvent === "undefined") {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, init = {}) {
      super(type);
      this.detail = init.detail;
    }
  };
}

const storage = await import("../site/storage.js");

function task(overrides = {}) {
  return {
    id: "task-storage-1",
    kind: "task",
    title: "Plan swim",
    notes: "hello world",
    state: "open",
    tags: ["planning"],
    attachments: [],
    availableFrom: null,
    deadline: null,
    latestStart: null,
    sleep: null,
    availabilitySchedule: null,
    createdAt: "2026-09-04T12:00:00.000Z",
    updatedAt: "2026-09-04T12:00:00.000Z",
    history: [{ at: "2026-09-04T12:00:00.000Z", type: "created" }],
    ...overrides,
  };
}

test("Solid persistence uses Automerge while keeping blobs and undo history local", async () => {
  const localBlob = new Blob(["local attachment"], { type: "text/plain" });
  const initial = task({
    attachments: [{ id: "attachment-1", name: "plan.txt", type: "text/plain", size: 16, blob: localBlob }],
  });

  await storage.putItem(initial);
  let items = await storage.listItems();
  assert.equal(items.length, 1);
  assert.equal(await items[0].attachments[0].blob.text(), "local attachment");

  const baseBytes = await storage.readSyncSnapshot();
  const baseDocument = loadCalendarDocument(baseBytes);
  assert.equal("blob" in materializeItem(baseDocument, initial.id).attachments[0], false);

  const remoteDocument = addTag(forkCalendarDocument(baseDocument), initial.id, "remote");

  await storage.putItem({
    ...items[0],
    title: "Plan pool swim",
    tags: [...items[0].tags, "local"],
    updatedAt: "2026-09-04T13:00:00.000Z",
  });

  await storage.mergeSyncSnapshot(saveCalendarDocument(remoteDocument));
  items = await storage.listItems();
  assert.equal(items[0].title, "Plan pool swim");
  assert.deepEqual(new Set(items[0].tags), new Set(["planning", "local", "remote"]));
  assert.equal(await items[0].attachments[0].blob.text(), "local attachment");

  assert.equal(storage.canUndo(), true);
  assert.equal(await storage.undo(), true);
  items = await storage.listItems();
  assert.equal(items[0].title, "Plan swim");
  assert.equal(items[0].tags.includes("remote"), true);
  assert.equal(await items[0].attachments[0].blob.text(), "local attachment");

  assert.equal(await storage.redo(), true);
  items = await storage.listItems();
  assert.equal(items[0].title, "Plan pool swim");
  assert.equal(items[0].tags.includes("remote"), true);

  await storage.deleteItem(initial.id);
  assert.equal((await storage.listItems()).length, 0);
  const deletedDocument = loadCalendarDocument(await storage.readSyncSnapshot());
  assert.equal(materializeItem(deletedDocument, initial.id), null);
  assert.ok(materializeItem(deletedDocument, initial.id, { includeDeleted: true }).deletedAt);

  assert.equal(await storage.undo(), true);
  items = await storage.listItems();
  assert.equal(items.length, 1);
  assert.equal(await items[0].attachments[0].blob.text(), "local attachment");
});
