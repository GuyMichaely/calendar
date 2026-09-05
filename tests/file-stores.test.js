import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileAuthStore,
  createFileBlobStore,
  createFileDocumentStore,
} from "../backend/file-stores.js";

async function withTempDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "calendar-file-stores-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("file auth store persists values, deletes them, and expires records", async () => {
  await withTempDirectory(async (directory) => {
    let clock = 1000;
    const first = createFileAuthStore({ directory, now: () => clock });
    await first.set("auth:session/a", { subject: "user-1" }, { expiresAt: 2000 });

    const second = createFileAuthStore({ directory, now: () => clock });
    assert.deepEqual(await second.get("auth:session/a"), { subject: "user-1" });

    clock = 2000;
    assert.equal(await second.get("auth:session/a"), null);

    await first.set("auth:session/b", { subject: "user-2" });
    await second.delete("auth:session/b");
    assert.equal(await first.get("auth:session/b"), null);
  });
});

test("file document store persists bytes and serializes concurrent updates in one process", async () => {
  await withTempDirectory(async (directory) => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const store = createFileDocumentStore({ directory });

    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const first = store.update("calendar:primary", async (current) => {
      assert.equal(current, null);
      await firstGate;
      return { value: encoder.encode("a"), result: "first" };
    });
    const second = store.update("calendar:primary", async (current) => {
      return { value: encoder.encode(`${decoder.decode(current)}b`), result: "second" };
    });

    releaseFirst();
    assert.equal(await first, "first");
    assert.equal(await second, "second");

    const reopened = createFileDocumentStore({ directory });
    assert.equal(decoder.decode(await reopened.get("calendar:primary")), "ab");
  });
});

test("file blob store is immutable and persists content type", async () => {
  await withTempDirectory(async (directory) => {
    const store = createFileBlobStore({ directory });
    const key = "attachment/with unsafe path characters";

    assert.equal(await store.putIfAbsent(key, {
      bytes: new TextEncoder().encode("first"),
      contentType: "text/plain",
    }), true);
    assert.equal(await store.putIfAbsent(key, {
      bytes: new TextEncoder().encode("second"),
      contentType: "application/octet-stream",
    }), false);

    const reopened = createFileBlobStore({ directory });
    const stored = await reopened.get(key);
    assert.equal(new TextDecoder().decode(stored.bytes), "first");
    assert.equal(stored.contentType, "text/plain");
    assert.equal(await reopened.get("missing"), null);
  });
});
