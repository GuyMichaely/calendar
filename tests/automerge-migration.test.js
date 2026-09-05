import assert from "node:assert/strict";
import test from "node:test";
import * as Automerge from "@automerge/automerge";
import { indexedDB } from "fake-indexeddb";
import {
  DOCUMENT_ID,
  DOCUMENT_STORE,
  NEW_DB,
  OLD_DB,
  OLD_STORE,
  inspectAutomergeMigration,
  migrateLegacyCalendarData,
} from "../migrations/2026-09-automerge-storage.js";

globalThis.indexedDB = indexedDB;
globalThis.sessionStorage = {
  values: new Map(),
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
  setItem(key, value) { this.values.set(key, String(value)); },
  removeItem(key) { this.values.delete(key); },
  clear() { this.values.clear(); },
};

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Deleting ${name} was blocked.`));
  });
}

function createDatabase(name, version, onUpgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => onUpgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function seedLegacyItems(items) {
  const db = await createDatabase(OLD_DB, 1, (opened) => opened.createObjectStore(OLD_STORE, { keyPath: "id" }));
  await new Promise((resolve, reject) => {
    const tx = db.transaction(OLD_STORE, "readwrite");
    const store = tx.objectStore(OLD_STORE);
    for (const item of items) store.put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function readMigratedDocument() {
  const db = await createDatabase(NEW_DB, 1, () => {});
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(DOCUMENT_STORE, "readonly");
    const request = tx.objectStore(DOCUMENT_STORE).get(DOCUMENT_ID);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return Automerge.load(record.bytes);
}

test.beforeEach(async () => {
  await deleteDatabase(OLD_DB);
  await deleteDatabase(NEW_DB);
  sessionStorage.clear();
});

test("one-off migration copies tasks and events and folds deferred waiting into sleep", async () => {
  const now = new Date("2026-09-05T12:00:00.000Z");
  await seedLegacyItems([
    {
      id: "task-1",
      kind: "task",
      title: "Deferred task",
      notes: "",
      state: "waiting",
      tags: [],
      attachments: [],
      wakeAt: "2026-09-06T04:00:00.000Z",
      ignoredUntil: null,
      availableFrom: null,
      history: [{ at: "2026-09-05T10:00:00.000Z", type: "deferred" }],
    },
    {
      id: "event-1",
      kind: "event",
      title: "Dinner",
      notes: "",
      tags: [],
      attachments: [],
      start: "2026-09-07T22:00:00.000Z",
      end: "2026-09-07T23:00:00.000Z",
    },
  ]);

  assert.deepEqual(await inspectAutomergeMigration(), { oldItemCount: 2, existingItemCount: 0 });
  assert.deepEqual(await migrateLegacyCalendarData({ nowDate: now }), { migratedItemCount: 2 });

  const document = await readMigratedDocument();
  assert.equal(document.items["task-1"].state, "open");
  assert.deepEqual(document.items["task-1"].sleep, {
    until: "2026-09-06T04:00:00.000Z",
    startedAt: now.toISOString(),
  });
  assert.equal(Object.hasOwn(document.items["task-1"], "wakeAt"), false);
  assert.equal(Object.hasOwn(document.items["task-1"], "ignoredUntil"), false);
  assert.equal(document.items["event-1"].title.toString(), "Dinner");
});

test("migration refuses to overwrite a non-empty Automerge store", async () => {
  await seedLegacyItems([{ id: "task-old", kind: "task", title: "Old", state: "open", tags: [], attachments: [] }]);
  const db = await createDatabase(NEW_DB, 1, (opened) => opened.createObjectStore(DOCUMENT_STORE, { keyPath: "id" }));
  const existing = Automerge.from({ schemaVersion: 1, items: { "task-new": { id: "task-new", kind: "task", title: "New" } } });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DOCUMENT_STORE, "readwrite");
    tx.objectStore(DOCUMENT_STORE).put({ id: DOCUMENT_ID, bytes: Automerge.save(existing) });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  assert.deepEqual(await inspectAutomergeMigration(), { oldItemCount: 1, existingItemCount: 1 });
  await assert.rejects(() => migrateLegacyCalendarData(), /already contains calendar data/u);
});

test("migration refuses legacy attachment bytes rather than discarding them", async () => {
  await seedLegacyItems([{
    id: "task-attachment",
    kind: "task",
    title: "Has bytes",
    state: "open",
    tags: [],
    attachments: [{ id: "attachment-1", name: "x.txt", blob: new Blob(["x"]) }],
  }]);

  await assert.rejects(() => migrateLegacyCalendarData(), /contains legacy attachment bytes/u);
});
