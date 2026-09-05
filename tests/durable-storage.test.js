import assert from "node:assert/strict";
import test from "node:test";
import { createChunkedDocumentStore, createDurableAuthStore } from "../backend/durable-storage.js";

function memoryTransactionalStorage() {
  const values = new Map();
  const clone = (value) => value == null ? value : structuredClone(value);
  const operations = {
    async get(key) {
      return clone(values.get(key));
    },
    async put(key, value) {
      values.set(key, clone(value));
    },
    async delete(key) {
      values.delete(key);
    },
  };
  return {
    ...operations,
    async transaction(callback) {
      const snapshot = new Map([...values].map(([key, value]) => [key, clone(value)]));
      const transaction = {
        async get(key) { return clone(snapshot.get(key)); },
        async put(key, value) { snapshot.set(key, clone(value)); },
        async delete(key) { snapshot.delete(key); },
      };
      const result = await callback(transaction);
      values.clear();
      for (const [key, value] of snapshot) values.set(key, value);
      return result;
    },
    keys() {
      return [...values.keys()].sort();
    },
  };
}

function patternedBytes(length, seed = 17) {
  const value = new Uint8Array(length);
  for (let index = 0; index < value.length; index += 1) value[index] = (index * 31 + seed) % 256;
  return value;
}

test("durable auth adapter stores opaque values and enforces store expiry", async () => {
  let clock = 10_000;
  const storage = memoryTransactionalStorage();
  const auth = createDurableAuthStore(storage, { now: () => clock });
  const value = {
    identity: { issuer: "https://accounts.example", subject: "guy" },
    expiresAt: 42_000,
  };

  await auth.set("auth:session:abc", value, { expiresAt: value.expiresAt });
  value.identity.subject = "mutated-after-write";
  assert.deepEqual(await auth.get("auth:session:abc"), {
    identity: { issuer: "https://accounts.example", subject: "guy" },
    expiresAt: 42_000,
  });

  clock = 42_001;
  assert.equal(await auth.get("auth:session:abc"), null);
  assert.equal(storage.keys().includes("auth:session:abc"), false);
});

test("chunked document store round-trips a five-megabyte document without any value exceeding one megabyte", async () => {
  const storage = memoryTransactionalStorage();
  const documents = createChunkedDocumentStore(storage, { chunkBytes: 1024 * 1024 });
  const bytes = patternedBytes(5 * 1024 * 1024);

  const result = await documents.update("calendar:primary", async (current) => {
    assert.equal(current, null);
    return { value: bytes, result: "stored" };
  });

  assert.equal(result, "stored");
  assert.deepEqual(await documents.get("calendar:primary"), bytes);
  assert.equal(storage.keys().filter((key) => key.includes(":chunk:")).length, 5);
});

test("chunked document updates expose the complete previous value and remove stale chunks when the document shrinks", async () => {
  const storage = memoryTransactionalStorage();
  const documents = createChunkedDocumentStore(storage, { chunkBytes: 1024 });
  const first = patternedBytes(3_100, 5);
  const second = patternedBytes(700, 9);

  await documents.update("calendar:primary", async () => ({ value: first, result: null }));
  assert.equal(storage.keys().filter((key) => key.includes(":chunk:")).length, 4);

  await documents.update("calendar:primary", async (current) => {
    assert.deepEqual(current, first);
    return { value: second, result: null };
  });

  assert.deepEqual(await documents.get("calendar:primary"), second);
  assert.equal(storage.keys().filter((key) => key.includes(":chunk:")).length, 1);
});

test("a failed transactional update leaves the previous document intact", async () => {
  const storage = memoryTransactionalStorage();
  const documents = createChunkedDocumentStore(storage, { chunkBytes: 1024 });
  const initial = patternedBytes(2_100);
  await documents.update("calendar:primary", async () => ({ value: initial, result: null }));

  await assert.rejects(
    documents.update("calendar:primary", async () => {
      throw new Error("merge failed");
    }),
    /merge failed/u,
  );

  assert.deepEqual(await documents.get("calendar:primary"), initial);
});
