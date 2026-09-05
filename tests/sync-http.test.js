import assert from "node:assert/strict";
import test from "node:test";
import {
  addTag,
  createCalendarDocument,
  forkCalendarDocument,
  loadCalendarDocument,
  materializeItem,
  patchItem,
  saveCalendarDocument,
} from "../sync/automerge-document.js";
import { AUTOMERGE_MEDIA_TYPE, createMemoryDocumentStore, createSyncHandler } from "../sync/http.js";

function task() {
  return {
    id: "task-1",
    kind: "task",
    title: "Buy goggles",
    notes: "",
    state: "open",
    tags: [],
    attachments: [],
    deadline: null,
    sleep: null,
  };
}

function request(bytes, headers = {}) {
  return new Request("https://sync.example/sync", {
    method: "POST",
    headers: { "content-type": AUTOMERGE_MEDIA_TYPE, ...headers },
    body: bytes,
  });
}

async function responseDocument(response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), AUTOMERGE_MEDIA_TYPE);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return loadCalendarDocument(new Uint8Array(await response.arrayBuffer()));
}

function authorizedHandler(documentStore, overrides = {}) {
  return createSyncHandler({
    authenticate: async () => ({ identity: { issuer: "https://accounts.example", subject: "guy" } }),
    documentStore,
    ...overrides,
  });
}

test("sync rejects unauthenticated requests before touching storage", async () => {
  let updates = 0;
  const handler = createSyncHandler({
    authenticate: async () => null,
    documentStore: {
      async update() {
        updates += 1;
        throw new Error("must not run");
      },
    },
  });

  const response = await handler(request(saveCalendarDocument(createCalendarDocument([task()]))));
  assert.equal(response.status, 401);
  assert.equal(updates, 0);
});

test("first sync stores and returns the incoming Automerge document", async () => {
  const store = createMemoryDocumentStore();
  const handler = authorizedHandler(store);
  const local = createCalendarDocument([task()]);

  const response = await handler(request(saveCalendarDocument(local)));
  const returned = await responseDocument(response);
  assert.deepEqual(materializeItem(returned, "task-1"), materializeItem(local, "task-1"));

  const stored = loadCalendarDocument(await store.get("calendar:primary"));
  assert.deepEqual(materializeItem(stored, "task-1"), materializeItem(local, "task-1"));
});

test("concurrent sync requests are serialized so neither replica is lost", async () => {
  const base = createCalendarDocument([task()]);
  const laptop = patchItem(forkCalendarDocument(base), "task-1", { deadline: "2026-10-02T17:00:00.000Z" });
  const phone = addTag(forkCalendarDocument(base), "task-1", "pool");
  const store = createMemoryDocumentStore({ "calendar:primary": saveCalendarDocument(base) });
  const handler = authorizedHandler(store);

  await Promise.all([
    handler(request(saveCalendarDocument(laptop))),
    handler(request(saveCalendarDocument(phone))),
  ]);

  const stored = loadCalendarDocument(await store.get("calendar:primary"));
  const item = materializeItem(stored, "task-1");
  assert.equal(item.deadline, "2026-10-02T17:00:00.000Z");
  assert.ok(item.tags.includes("pool"));
});

test("a later client receives all previously merged replica changes", async () => {
  const base = createCalendarDocument([task()]);
  const laptop = patchItem(forkCalendarDocument(base), "task-1", { deadline: "2026-10-02T17:00:00.000Z" });
  const phone = addTag(forkCalendarDocument(base), "task-1", "pool");
  const store = createMemoryDocumentStore();
  const handler = authorizedHandler(store);

  await handler(request(saveCalendarDocument(laptop)));
  const response = await handler(request(saveCalendarDocument(phone)));
  const returned = await responseDocument(response);
  const item = materializeItem(returned, "task-1");
  assert.equal(item.deadline, "2026-10-02T17:00:00.000Z");
  assert.ok(item.tags.includes("pool"));
});

test("replaying the same snapshot is safe", async () => {
  const store = createMemoryDocumentStore();
  const handler = authorizedHandler(store);
  const doc = addTag(createCalendarDocument([task()]), "task-1", "pool");
  const bytes = saveCalendarDocument(doc);

  await handler(request(bytes));
  await handler(request(bytes));
  const stored = loadCalendarDocument(await store.get("calendar:primary"));
  assert.deepEqual(materializeItem(stored, "task-1").tags, ["pool"]);
});

test("invalid Automerge bytes are rejected without replacing stored state", async () => {
  const base = createCalendarDocument([task()]);
  const store = createMemoryDocumentStore({ "calendar:primary": saveCalendarDocument(base) });
  const handler = authorizedHandler(store);

  const response = await handler(request(new Uint8Array([1, 2, 3, 4])));
  assert.equal(response.status, 400);
  const stored = loadCalendarDocument(await store.get("calendar:primary"));
  assert.deepEqual(materializeItem(stored, "task-1"), materializeItem(base, "task-1"));
});

test("empty and oversized sync bodies are rejected", async () => {
  const store = createMemoryDocumentStore();
  const handler = authorizedHandler(store, { maxSyncBytes: 32 });

  const empty = await handler(request(new Uint8Array()));
  assert.equal(empty.status, 400);

  const oversized = await handler(request(new Uint8Array(33)));
  assert.equal(oversized.status, 413);
});

test("streamed sync bodies are stopped once the size limit is exceeded", async () => {
  const store = createMemoryDocumentStore();
  const handler = authorizedHandler(store, { maxSyncBytes: 32 });
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(20));
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const streamed = new Request("https://sync.example/sync", {
    method: "POST",
    headers: { "content-type": AUTOMERGE_MEDIA_TYPE },
    body,
    duplex: "half",
  });

  const response = await handler(streamed);
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(await store.get("calendar:primary"), null);
});

test("only POST /sync is accepted", async () => {
  const store = createMemoryDocumentStore();
  const handler = authorizedHandler(store);

  const get = await handler(new Request("https://sync.example/sync"));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");

  const other = await handler(new Request("https://sync.example/other"));
  assert.equal(other.status, 404);
});
