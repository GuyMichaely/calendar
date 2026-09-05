import assert from "node:assert/strict";
import test from "node:test";
import {
  createCalendarDocument,
  loadCalendarDocument,
  materializeItem,
  saveCalendarDocument,
} from "../../sync/automerge-document.js";
import { AUTOMERGE_MEDIA_TYPE } from "../../sync/http.js";
import { configuredBackendUrl, createRemoteCalendarClient } from "../src/remote-sync";

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
