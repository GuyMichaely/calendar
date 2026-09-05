import { randomUUID } from "node:crypto";
import {
  mkdir,
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

function fileNameForKey(key, extension = "") {
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

function destinationExists(error) {
  return error?.code === "EEXIST" || error?.code === "ENOTEMPTY";
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
  const pathFor = (key) => join(root, fileNameForKey(key));

  return {
    async get(key) {
      await ensureDirectory(root);
      const path = pathFor(key);
      let bytes;
      try {
        bytes = new Uint8Array(await readFile(join(path, "blob")));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }

      const metadata = JSON.parse(await readFile(join(path, "metadata.json"), "utf8"));
      const contentType = typeof metadata?.contentType === "string" && metadata.contentType
        ? metadata.contentType
        : "application/octet-stream";
      return { bytes, contentType };
    },

    async putIfAbsent(key, value) {
      if (!(value?.bytes instanceof Uint8Array)) throw new Error("Blob store requires Uint8Array bytes.");
      await ensureDirectory(root);
      const path = pathFor(key);
      const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;

      try {
        await mkdir(temporary, { mode: 0o700 });
        await writeFile(join(temporary, "blob"), value.bytes, { mode: 0o600 });
        await writeFile(
          join(temporary, "metadata.json"),
          JSON.stringify({ contentType: value.contentType || "application/octet-stream" }),
          { encoding: "utf8", mode: 0o600 },
        );
        await rename(temporary, path);
        return true;
      } catch (error) {
        await rm(temporary, { recursive: true, force: true }).catch(() => {});
        if (destinationExists(error)) return false;
        throw error;
      }
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
