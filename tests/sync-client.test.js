import assert from "node:assert/strict";
import test from "node:test";
import {
  addTag,
  createCalendarDocument,
  loadCalendarDocument,
  materializeItem,
  mergeCalendarDocuments,
  patchItem,
  saveCalendarDocument,
} from "../sync/automerge-document.js";
import { CalendarSyncError, exchangeCalendarSnapshotBytes, syncCalendarStorage } from "../sync/client.js";
import { createMemoryDocumentStore, createSyncHandler } from "../sync/http.js";

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
  };
}

function handlerFetch(handler, hook = null) {
  return async (url, init) => {
    assert.equal(init.credentials, "include");
    const response = await handler(new Request(url, init));
    if (hook) await hook();
    return response;
  };
}

test("sync client exchanges serialized Solid Automerge snapshots through ordinary fetch", async () => {
  const handler = createSyncHandler({
    authenticate: async () => ({ identity: { issuer: "issuer", subject: "guy" } }),
    documentStore: createMemoryDocumentStore(),
  });
  const local = createCalendarDocument([task()]);
  const responseBytes = await exchangeCalendarSnapshotBytes(saveCalendarDocument(local), {
    endpoint: "https://sync.example/sync",
    fetch: handlerFetch(handler),
  });
  const remote = loadCalendarDocument(responseBytes);
  assert.deepEqual(materializeItem(remote, "task-1"), materializeItem(local, "task-1"));
});

test("sync client exposes HTTP authentication failures", async () => {
  const handler = createSyncHandler({
    authenticate: async () => null,
    documentStore: createMemoryDocumentStore(),
  });
  const local = createCalendarDocument([task()]);

  await assert.rejects(
    exchangeCalendarSnapshotBytes(saveCalendarDocument(local), {
      endpoint: "https://sync.example/sync",
      fetch: handlerFetch(handler),
    }),
    (error) => error instanceof CalendarSyncError && error.status === 401,
  );
});

test("storage adapter merges the response into the latest local document so in-flight edits survive", async () => {
  const store = createMemoryDocumentStore();
  const handler = createSyncHandler({
    authenticate: async () => ({ identity: { issuer: "issuer", subject: "guy" } }),
    documentStore: store,
  });
  let current = patchItem(createCalendarDocument([task()]), "task-1", {
    deadline: "2026-10-02T17:00:00.000Z",
  });

  let releaseResponse;
  let responseReady;
  const responseGate = new Promise((resolve) => { releaseResponse = resolve; });
  const reachedGate = new Promise((resolve) => { responseReady = resolve; });
  const fetch = handlerFetch(handler, async () => {
    responseReady();
    await responseGate;
  });

  const syncing = syncCalendarStorage({
    readSnapshot: async () => saveCalendarDocument(current),
    mergeSnapshot: async (bytes) => {
      current = mergeCalendarDocuments(current, loadCalendarDocument(bytes));
      return current;
    },
  }, {
    endpoint: "https://sync.example/sync",
    fetch,
  });

  await reachedGate;
  current = addTag(current, "task-1", "edited-while-syncing");
  releaseResponse();
  await syncing;

  const item = materializeItem(current, "task-1");
  assert.equal(item.deadline, "2026-10-02T17:00:00.000Z");
  assert.ok(item.tags.includes("edited-while-syncing"));
});

test("sync client rejects a successful response with the wrong media type", async () => {
  const local = createCalendarDocument([task()]);
  await assert.rejects(
    exchangeCalendarSnapshotBytes(saveCalendarDocument(local), {
      endpoint: "https://sync.example/sync",
      fetch: async () => new Response("not automerge", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    }),
    (error) => error instanceof CalendarSyncError && error.status === 200,
  );
});
