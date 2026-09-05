import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB } from "fake-indexeddb";
import {
  addTag,
  loadCalendarDocument,
  patchItem,
  saveCalendarDocument,
} from "../sync/automerge-document.js";
import { syncCalendarStorage } from "../sync/client.js";
import { createMemoryDocumentStore, createSyncHandler } from "../sync/http.js";

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
    id: "task-solid-network-sync",
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

function handlerFetch(handler, hook = null) {
  return async (url, init) => {
    const response = await handler(new Request(url, init));
    if (hook) await hook();
    return response;
  };
}

function storageAdapter() {
  return {
    readSnapshot: storage.readSyncSnapshot,
    mergeSnapshot: storage.mergeSyncSnapshot,
  };
}

test("Solid IndexedDB storage preserves local edits made while authenticated snapshot sync is in flight", async () => {
  await storage.putItem(task());

  const documentStore = createMemoryDocumentStore();
  const handler = createSyncHandler({
    authenticate: async () => ({ identity: { issuer: "issuer", subject: "guy" } }),
    documentStore,
  });
  const endpoint = "https://sync.example/sync";

  await syncCalendarStorage(storageAdapter(), {
    endpoint,
    fetch: handlerFetch(handler),
  });

  const serverBytes = await documentStore.get("calendar:primary");
  let remote = loadCalendarDocument(serverBytes);
  remote = patchItem(remote, "task-solid-network-sync", { deadline: "2026-09-12T17:00:00.000Z" });
  remote = addTag(remote, "task-solid-network-sync", "remote");
  await documentStore.update("calendar:primary", async () => ({
    value: saveCalendarDocument(remote),
    result: null,
  }));

  let releaseResponse;
  let responseReady;
  const responseGate = new Promise((resolve) => { releaseResponse = resolve; });
  const reachedGate = new Promise((resolve) => { responseReady = resolve; });
  const syncing = syncCalendarStorage(storageAdapter(), {
    endpoint,
    fetch: handlerFetch(handler, async () => {
      responseReady();
      await responseGate;
    }),
  });

  await reachedGate;
  const [baseline] = await storage.listItems();
  await storage.putItem({
    ...baseline,
    title: "Plan local swim",
    tags: [...baseline.tags, "local"],
    updatedAt: "2026-09-04T13:00:00.000Z",
  }, baseline);
  releaseResponse();
  await syncing;

  const [merged] = await storage.listItems();
  assert.equal(merged.title, "Plan local swim");
  assert.equal(merged.deadline, "2026-09-12T17:00:00.000Z");
  assert.deepEqual(new Set(merged.tags), new Set(["planning", "local", "remote"]));
});
