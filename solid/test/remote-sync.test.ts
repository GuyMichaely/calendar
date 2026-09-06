import assert from "node:assert/strict";
import test from "node:test";
import { downloadAttachmentOnDemand, uploadAttachmentsBeforePersist } from "../../site/attachment-remote.js";
import {
  createCalendarDocument,
  loadCalendarDocument,
  materializeItem,
  saveCalendarDocument,
} from "../../sync/automerge-document.js";
import { AUTOMERGE_MEDIA_TYPE } from "../../sync/http.js";
import { configuredBackendUrl, createRemoteCalendarClient, createRemoteSyncQueue } from "../src/remote-sync.ts";

function task() {
  return {
    id: "task-remote-client",
    kind: "task",
    title: "Remote client",
    notes: "",
    state: "open",
    tags: [],
    attachments: [],
  };
}

test("remote client preserves a configured backend path prefix", () => {
  const backendUrl = configuredBackendUrl("https://example.com/calendar-api");
  const client = createRemoteCalendarClient({
    backendUrl,
    storage: {
      readSnapshot: async () => new Uint8Array([1]),
      mergeSnapshot: async () => null,
    },
    fetch: async () => new Response(null, { status: 500 }),
  });

  assert.equal(backendUrl, "https://example.com/calendar-api/");
  assert.equal(client.loginUrl(), "https://example.com/calendar-api/auth/login/google");
});

test("remote session treats 401 as signed out and validates authenticated identity", async () => {
  let response = new Response(JSON.stringify({ authenticated: false }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
  const client = createRemoteCalendarClient({
    backendUrl: "https://sync.example/",
    storage: {
      readSnapshot: async () => new Uint8Array([1]),
      mergeSnapshot: async () => null,
    },
    fetch: async (_input, init) => {
      assert.equal(init?.credentials, "include");
      return response;
    },
  });

  assert.deepEqual(await client.session(), { authenticated: false, identity: null });

  response = new Response(JSON.stringify({
    authenticated: true,
    identity: { issuer: "https://accounts.google.com", subject: "guy", email: "guy@example.com" },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  assert.deepEqual(await client.session(), {
    authenticated: true,
    identity: { issuer: "https://accounts.google.com", subject: "guy", email: "guy@example.com" },
  });
});

test("remote sync sends current serialized storage and delegates the response to the storage merge", async () => {
  const document = createCalendarDocument([task()]);
  const bytes = saveCalendarDocument(document);
  let mergedBytes: Uint8Array | null = null;
  const client = createRemoteCalendarClient({
    backendUrl: "https://sync.example/",
    storage: {
      readSnapshot: async () => bytes,
      mergeSnapshot: async (incoming) => {
        mergedBytes = incoming;
        return [materializeItem(loadCalendarDocument(incoming), "task-remote-client")];
      },
    },
    fetch: async (input, init) => {
      assert.equal(String(input), "https://sync.example/sync");
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "include");
      assert.deepEqual(new Uint8Array(init?.body as Uint8Array), bytes);
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": AUTOMERGE_MEDIA_TYPE },
      });
    },
  });

  const items = await client.sync();
  assert.ok(mergedBytes);
  assert.deepEqual(items, [materializeItem(document, "task-remote-client")]);
});

test("new attachment bytes are uploaded before local metadata persistence", async () => {
  const localBlob = new Blob(["hello"], { type: "text/plain" });
  let uploaded = "";
  createRemoteCalendarClient({
    backendUrl: "https://sync.example/calendar-api/",
    storage: {
      readSnapshot: async () => new Uint8Array([1]),
      mergeSnapshot: async () => null,
    },
    fetch: async (input, init) => {
      assert.equal(String(input), "https://sync.example/calendar-api/attachments/attachment-local");
      assert.equal(init?.credentials, "include");
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      assert.equal(init?.method, "PUT");
      uploaded = await new Response(init?.body as BodyInit).text();
      return new Response(null, { status: 204 });
    },
  });

  await uploadAttachmentsBeforePersist([{
    id: "attachment-local",
    name: "note.txt",
    type: "text/plain",
    size: 5,
    blob: localBlob,
  }]);
  assert.equal(uploaded, "hello");
});

test("attachment download fetches bytes on demand without a browser persistence callback", async () => {
  let calls = 0;
  createRemoteCalendarClient({
    backendUrl: "https://sync.example/",
    storage: {
      readSnapshot: async () => new Uint8Array([1]),
      mergeSnapshot: async () => null,
    },
    fetch: async (input, init) => {
      calls += 1;
      assert.equal(String(input), "https://sync.example/attachments/attachment-remote");
      assert.equal(init?.credentials, "include");
      return new Response("remote", { status: 200, headers: { "content-type": "text/plain" } });
    },
  });

  const blob = await downloadAttachmentOnDemand({ id: "attachment-remote", name: "remote.txt", type: "text/plain" });
  assert.equal(await blob.text(), "remote");
  // Bun adds a charset parameter to text Blobs; browsers may omit it.
  assert.equal(blob.type.split(";")[0], "text/plain");
  assert.equal(calls, 1);
});

test("remote logout is credentialed and requires a successful response", async () => {
  let status = 204;
  const client = createRemoteCalendarClient({
    backendUrl: "https://sync.example/",
    storage: {
      readSnapshot: async () => new Uint8Array([1]),
      mergeSnapshot: async () => null,
    },
    fetch: async (input, init) => {
      assert.equal(String(input), "https://sync.example/auth/logout");
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "include");
      return new Response(null, { status });
    },
  });

  await client.logout();
  status = 500;
  await assert.rejects(client.logout(), /Could not sign out/u);
});

test("remote sync queue serializes requests and performs a follow-up sync for edits queued in flight", async () => {
  let calls = 0;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const busy: boolean[] = [];
  let synced = 0;
  const queue = createRemoteSyncQueue({
    sync: async () => {
      calls += 1;
      if (calls === 1) await firstGate;
    },
    onBusyChange: (value) => busy.push(value),
    onSynced: () => { synced += 1; },
  });

  const first = queue.request();
  assert.equal(queue.running, true);
  const second = queue.request();
  assert.equal(first, second);
  assert.equal(calls, 1);

  releaseFirst();
  await first;

  assert.equal(calls, 2);
  assert.equal(synced, 2);
  assert.deepEqual(busy, [true, false]);
  assert.equal(queue.running, false);
});

test("remote sync queue reports failures and accepts a later retry", async () => {
  let calls = 0;
  const errors: unknown[] = [];
  const queue = createRemoteSyncQueue({
    sync: async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
    },
    onError: (error) => errors.push(error),
  });

  await assert.rejects(queue.request(), /offline/u);
  assert.equal(queue.running, false);
  assert.equal(errors.length, 1);
  await queue.request();
  assert.equal(calls, 2);
});
