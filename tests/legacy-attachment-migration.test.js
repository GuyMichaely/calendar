import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB } from "fake-indexeddb";
import { configureRemoteAttachments } from "../site/attachment-remote.js";

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

function task(id, attachmentId) {
  return {
    id,
    kind: "task",
    title: "Legacy attachment",
    notes: "",
    state: "open",
    tags: [],
    attachments: [{ id: attachmentId, name: "legacy.txt", type: "text/plain", size: 6 }],
    availableFrom: null,
    deadline: null,
    latestStart: null,
    sleep: null,
    availabilitySchedule: null,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    history: [],
  };
}

async function writeLegacyRecords(records) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("calendar-automerge", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction("attachments", "readwrite");
    const store = tx.objectStore("attachments");
    for (const record of records) store.put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function legacyRecordCount() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("calendar-automerge", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const count = await new Promise((resolve, reject) => {
    const tx = db.transaction("attachments", "readonly");
    const request = tx.objectStore("attachments").count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return count;
}

test("legacy local blobs upload referenced attachments then clear the legacy store", async () => {
  const referencedId = "legacy-referenced";
  const orphanId = "legacy-orphan";
  await storage.putItem(task("legacy-task", referencedId));
  await writeLegacyRecords([
    { id: referencedId, blob: new Blob(["legacy"], { type: "text/plain" }) },
    { id: orphanId, blob: new Blob(["orphan"], { type: "text/plain" }) },
  ]);

  const uploaded = [];
  configureRemoteAttachments({
    upload: async (attachments) => uploaded.push(...attachments),
    download: async () => new Blob(),
  });

  const result = await storage.migrateLegacyAttachmentBlobs();
  assert.deepEqual(result, { uploaded: 1, removed: 2 });
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].id, referencedId);
  assert.equal(await uploaded[0].blob.text(), "legacy");
  assert.equal(await legacyRecordCount(), 0);

  const item = (await storage.listItems()).find((candidate) => candidate.id === "legacy-task");
  assert.equal(item.attachments[0].id, referencedId);
  assert.equal("blob" in item.attachments[0], false);
});

test("legacy local blobs are retained when remote upload fails", async () => {
  const referencedId = "legacy-failure";
  await storage.putItem(task("legacy-failure-task", referencedId));
  await writeLegacyRecords([
    { id: referencedId, blob: new Blob(["keep me"], { type: "text/plain" }) },
  ]);

  configureRemoteAttachments({
    upload: async () => { throw new Error("remote unavailable"); },
    download: async () => new Blob(),
  });

  await assert.rejects(() => storage.migrateLegacyAttachmentBlobs(), /remote unavailable/);
  assert.equal(await legacyRecordCount(), 1);
});
