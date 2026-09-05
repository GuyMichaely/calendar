const DEFAULT_DOCUMENT_CHUNK_BYTES = 1024 * 1024;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function asBytes(value) {
  if (value == null) return null;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  throw new TypeError("Stored document chunks must be binary values.");
}

function documentPrefix(key) {
  return `document:${encodeURIComponent(key)}`;
}

function metadataKey(key) {
  return `${documentPrefix(key)}:meta`;
}

function chunkKey(key, index) {
  return `${documentPrefix(key)}:chunk:${index}`;
}

function validateMetadata(metadata) {
  if (!metadata) return null;
  if (
    metadata.version !== 1 ||
    !Number.isInteger(metadata.chunkCount) || metadata.chunkCount < 1 ||
    !Number.isInteger(metadata.byteLength) || metadata.byteLength < 1
  ) {
    throw new Error("Stored calendar document metadata is invalid.");
  }
  return metadata;
}

async function readDocument(storage, key) {
  const metadata = validateMetadata(await storage.get(metadataKey(key)));
  if (!metadata) return { bytes: null, chunkCount: 0 };

  const chunks = [];
  let total = 0;
  for (let index = 0; index < metadata.chunkCount; index += 1) {
    const chunk = asBytes(await storage.get(chunkKey(key, index)));
    if (!chunk) throw new Error(`Stored calendar document chunk ${index} is missing.`);
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  if (total !== metadata.byteLength) throw new Error("Stored calendar document length does not match its metadata.");

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, chunkCount: metadata.chunkCount };
}

async function writeDocument(storage, key, value, previousChunkCount, chunkBytes) {
  const bytes = asBytes(value);
  if (!bytes?.byteLength) throw new Error("Document store updates require non-empty Uint8Array values.");
  const chunkCount = Math.ceil(bytes.byteLength / chunkBytes);

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * chunkBytes;
    const end = Math.min(start + chunkBytes, bytes.byteLength);
    await storage.put(chunkKey(key, index), bytes.slice(start, end));
  }
  for (let index = chunkCount; index < previousChunkCount; index += 1) {
    await storage.delete(chunkKey(key, index));
  }
  await storage.put(metadataKey(key), {
    version: 1,
    chunkCount,
    byteLength: bytes.byteLength,
  });
}

export function createDurableAuthStore(storage) {
  if (!storage?.get || !storage?.put || !storage?.delete) {
    throw new Error("Durable auth storage requires get/put/delete operations.");
  }
  return {
    async get(key) {
      return clone(await storage.get(key));
    },
    async set(key, value) {
      await storage.put(key, clone(value));
    },
    async delete(key) {
      await storage.delete(key);
    },
  };
}

export function createChunkedDocumentStore(storage, { chunkBytes = DEFAULT_DOCUMENT_CHUNK_BYTES } = {}) {
  if (!storage?.get || !storage?.put || !storage?.delete || !storage?.transaction) {
    throw new Error("Chunked document storage requires get/put/delete/transaction operations.");
  }
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1) throw new Error("Document chunk size must be a positive integer.");

  return {
    async get(key) {
      return storage.transaction(async (transaction) => {
        const { bytes } = await readDocument(transaction, key);
        return bytes;
      });
    },

    async update(key, updater) {
      if (typeof updater !== "function") throw new Error("Document store update requires a function.");
      return storage.transaction(async (transaction) => {
        const current = await readDocument(transaction, key);
        const outcome = await updater(current.bytes);
        if (!outcome || !(outcome.value instanceof Uint8Array)) {
          throw new Error("Document store updater must return { value: Uint8Array, result }.");
        }
        await writeDocument(transaction, key, outcome.value, current.chunkCount, chunkBytes);
        return outcome.result;
      });
    },
  };
}
