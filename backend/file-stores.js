import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

function requireDirectory(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("A storage directory is required.");
  return resolve(text);
}

function fileNameForKey(key, extension) {
  const encoded = Buffer.from(String(key), "utf8").toString("base64url");
  return `${encoded || "empty"}${extension}`;
}

function copy(value) {
  return value == null ? value : structuredClone(value);
}

function copyBytes(value) {
  return value == null ? null : new Uint8Array(value);
}

function isMissing(error) {
  return error?.code === "ENOENT";
}

async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true });
}

async function atomicWrite(path, data, options = {}) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, data, options);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function createFileAuthStore({ directory, now = () => Date.now() } = {}) {
  const root = join(requireDirectory(directory), "auth");
  const pathFor = (key) => join(root, fileNameForKey(key, ".json"));

  return {
    async get(key) {
      await ensureDirectory(root);
      let record;
      try {
        record = JSON.parse(await readFile(pathFor(key), "utf8"));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
      if (record?.expiresAt != null && record.expiresAt <= now()) {
        await rm(pathFor(key), { force: true });
        return null;
      }
      return copy(record?.value ?? null);
    },

    async set(key, value, { expiresAt = null } = {}) {
      await ensureDirectory(root);
      await atomicWrite(
        pathFor(key),
        JSON.stringify({ value: copy(value), expiresAt }),
        { encoding: "utf8", mode: 0o600 },
      );
    },

    async delete(key) {
      await ensureDirectory(root);
      await rm(pathFor(key), { force: true });
    },
  };
}

export function createFileDocumentStore({ directory } = {}) {
  const root = join(requireDirectory(directory), "documents");
  const tails = new Map();
  const pathFor = (key) => join(root, fileNameForKey(key, ".automerge"));

  const read = async (key) => {
    await ensureDirectory(root);
    try {
      return new Uint8Array(await readFile(pathFor(key)));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  };

  return {
    get(key) {
      return read(key);
    },

    async update(key, updater) {
      if (typeof updater !== "function") throw new Error("Document store update requires a function.");
      const previous = tails.get(key) || Promise.resolve();
      let finish;
      const gate = new Promise((resolveGate) => { finish = resolveGate; });
      const tail = previous.catch(() => {}).then(() => gate);
      tails.set(key, tail);

      await previous.catch(() => {});
      try {
        const current = await read(key);
        const outcome = await updater(copyBytes(current));
        if (!outcome || !(outcome.value instanceof Uint8Array)) {
          throw new Error("Document store updater must return { value: Uint8Array, result }.");
        }
        await ensureDirectory(root);
        await atomicWrite(pathFor(key), outcome.value, { mode: 0o600 });
        return outcome.result;
      } finally {
        finish();
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
  };
}

export function createFileBlobStore({ directory } = {}) {
  const root = join(requireDirectory(directory), "blobs");
  const blobPathFor = (key) => join(root, fileNameForKey(key, ".blob"));
  const metadataPathFor = (key) => join(root, fileNameForKey(key, ".json"));

  return {
    async get(key) {
      await ensureDirectory(root);
      let bytes;
      try {
        bytes = new Uint8Array(await readFile(blobPathFor(key)));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }

      let contentType = "application/octet-stream";
      try {
        const metadata = JSON.parse(await readFile(metadataPathFor(key), "utf8"));
        if (typeof metadata?.contentType === "string" && metadata.contentType) contentType = metadata.contentType;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      return { bytes, contentType };
    },

    async putIfAbsent(key, value) {
      if (!(value?.bytes instanceof Uint8Array)) throw new Error("Blob store requires Uint8Array bytes.");
      await ensureDirectory(root);
      const blobPath = blobPathFor(key);
      const metadataPath = metadataPathFor(key);
      let handle;
      try {
        handle = await open(blobPath, "wx", 0o600);
      } catch (error) {
        if (error?.code === "EEXIST") return false;
        throw error;
      }

      try {
        await handle.writeFile(value.bytes);
        await handle.close();
        handle = null;
        await atomicWrite(
          metadataPath,
          JSON.stringify({ contentType: value.contentType || "application/octet-stream" }),
          { encoding: "utf8", mode: 0o600 },
        );
      } catch (error) {
        await handle?.close().catch(() => {});
        await rm(blobPath, { force: true }).catch(() => {});
        await rm(metadataPath, { force: true }).catch(() => {});
        throw error;
      }
      return true;
    },
  };
}

export function createFileBackendStores({ directory, now } = {}) {
  const root = requireDirectory(directory);
  return {
    authStore: createFileAuthStore({ directory: root, ...(now ? { now } : {}) }),
    documentStore: createFileDocumentStore({ directory: root }),
    blobStore: createFileBlobStore({ directory: root }),
  };
}
