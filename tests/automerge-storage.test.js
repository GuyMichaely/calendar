import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB } from "fake-indexeddb";
import {
  addHistoryEntry,
  addTag,
  forkCalendarDocument,
  loadCalendarDocument,
  materializeItem,
  patchItem,
  saveCalendarDocument,
  updateItemText,
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
  }, items[0]);

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

test("a stale Solid item save applies only the user's delta to the latest merged document", async () => {
  const id = "task-storage-stale";
  const initial = task({ id, deadline: "2026-09-10T17:00:00.000Z" });
  await storage.putItem(initial);

  const baseline = (await storage.listItems()).find((item) => item.id === id);
  const baseDocument = loadCalendarDocument(await storage.readSyncSnapshot());
  let remoteDocument = forkCalendarDocument(baseDocument);
  remoteDocument = patchItem(remoteDocument, id, {
    deadline: "2026-10-02T17:00:00.000Z",
    notes: "remote notes",
  });
  remoteDocument = addTag(remoteDocument, id, "remote");
  remoteDocument = addHistoryEntry(remoteDocument, id, {
    at: "2026-09-04T12:30:00.000Z",
    type: "remote-edit",
  });
  await storage.mergeSyncSnapshot(saveCalendarDocument(remoteDocument));

  await storage.putItem({
    ...baseline,
    tags: [...baseline.tags, "local"],
    updatedAt: "2026-09-04T13:00:00.000Z",
  }, baseline);

  let current = (await storage.listItems()).find((item) => item.id === id);
  assert.equal(current.deadline, "2026-10-02T17:00:00.000Z");
  assert.equal(current.notes, "remote notes");
  assert.deepEqual(new Set(current.tags), new Set(["planning", "remote", "local"]));
  assert.equal(current.history.some((entry) => entry.type === "remote-edit"), true);

  assert.equal(await storage.undo(), true);
  current = (await storage.listItems()).find((item) => item.id === id);
  assert.equal(current.deadline, "2026-10-02T17:00:00.000Z");
  assert.equal(current.notes, "remote notes");
  assert.equal(current.tags.includes("remote"), true);
  assert.equal(current.tags.includes("local"), false);
  assert.equal(current.history.some((entry) => entry.type === "remote-edit"), true);
});

test("a stale editor text change is made at its captured heads so concurrent remote text survives", async () => {
  const id = "task-storage-text";
  await storage.putItem(task({ id, notes: "hello world" }));

  const baseline = (await storage.listItems()).find((item) => item.id === id);
  const baseDocument = loadCalendarDocument(await storage.readSyncSnapshot());
  const remoteDocument = updateItemText(
    forkCalendarDocument(baseDocument),
    id,
    "notes",
    "hello world!",
  );
  await storage.mergeSyncSnapshot(saveCalendarDocument(remoteDocument));

  await storage.putItem({
    ...baseline,
    notes: "hello brave world",
    updatedAt: "2026-09-04T13:30:00.000Z",
  }, baseline);

  const current = (await storage.listItems()).find((item) => item.id === id);
  assert.equal(current.notes, "hello brave world!");
});

test("kind conversion removes obsolete source-kind fields without overwriting untouched shared remote edits", async () => {
  const id = "task-storage-convert";
  const initial = task({
    id,
    deadline: "2026-09-10T17:00:00.000Z",
    sleep: { until: "2026-09-08T12:00:00.000Z", startedAt: "2026-09-04T12:00:00.000Z" },
  });
  await storage.putItem(initial);

  const baseline = (await storage.listItems()).find((item) => item.id === id);
  const baseDocument = loadCalendarDocument(await storage.readSyncSnapshot());
  let remoteDocument = patchItem(forkCalendarDocument(baseDocument), id, {
    deadline: "2026-10-05T17:00:00.000Z",
  });
  remoteDocument = addTag(remoteDocument, id, "remote");
  await storage.mergeSyncSnapshot(saveCalendarDocument(remoteDocument));

  await storage.putItem({
    id,
    kind: "event",
    title: baseline.title,
    notes: baseline.notes,
    tags: baseline.tags,
    attachments: baseline.attachments,
    start: "2026-09-20T13:00:00.000Z",
    end: "2026-09-20T14:00:00.000Z",
    createdAt: baseline.createdAt,
    updatedAt: "2026-09-04T14:00:00.000Z",
  }, baseline);

  const current = (await storage.listItems()).find((item) => item.id === id);
  assert.equal(current.kind, "event");
  assert.equal(current.tags.includes("remote"), true);
  assert.equal(current.start, "2026-09-20T13:00:00.000Z");
  assert.equal("state" in current, false);
  assert.equal("deadline" in current, false);
  assert.equal("sleep" in current, false);
  assert.equal("history" in current, false);
});
