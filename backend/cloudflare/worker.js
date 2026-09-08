import { DurableObject } from "cloudflare:workers";
import { createCalendarBackendHandler } from "../app.js";
import { readBackendConfig } from "../config.js";

// One object serializes updates to the single calendar. This is deliberately
// not a multi-tenant service: auth uses the same exact identity allowlist as Bun.
export class CalendarStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.storage = ctx.storage;
    this.env = env;
    this.tail = Promise.resolve();
    this.handler = null;
  }

  fetch(request) {
    // Include all storage operations in one queue; awaited R2/OIDC calls must
    // not let another request interleave a snapshot read/merge/write.
    const result = this.tail.then(() => this.handle(request));
    this.tail = result.then(() => {}, () => {});
    return result;
  }

  async handle(request) {
    if (!this.handler) {
      const storage = this.storage;
      const bucket = this.env.ATTACHMENTS;
      const authStore = {
        async get(key) {
          const record = await storage.get("auth:" + key);
          if (!record) return null;
          if (record.expiresAt != null && record.expiresAt <= Date.now()) {
            await storage.delete("auth:" + key);
            return null;
          }
          return record.value;
        },
        async set(key, value, { expiresAt = null } = {}) {
          await storage.put("auth:" + key, { value, expiresAt });
          if (await storage.getAlarm() == null) await storage.setAlarm(Date.now() + 86400000);
        },
        async delete(key) { await storage.delete("auth:" + key); },
      };
      // The document lives in this object's serialized SQLite store.
      storage.sql.exec("CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, bytes BLOB NOT NULL)");
      const documentStore = {
        async update(key, updater) {
          const row = storage.sql.exec("SELECT bytes FROM documents WHERE id = ?", key).toArray()[0];
          const previous = row ? new Uint8Array(row.bytes) : null;
          const outcome = await updater(previous);
          storage.sql.exec("INSERT OR REPLACE INTO documents (id, bytes) VALUES (?, ?)", key, outcome.value);
          return outcome.result;
        },
      };
      const blobStore = {
        async get(key) {
          const object = await bucket.get("attachments/" + key);
          return object ? { bytes: new Uint8Array(await object.arrayBuffer()), contentType: object.httpMetadata?.contentType } : null;
        },
        async putIfAbsent(key, value) {
          const stored = await bucket.put("attachments/" + key, value.bytes, {
            onlyIf: { etagDoesNotMatch: "*" },
            httpMetadata: { contentType: value.contentType },
          });
          return stored !== null;
        },
      };
      this.handler = createCalendarBackendHandler({
        config: readBackendConfig(this.env), authStore, documentStore, blobStore,
      });
    }
    return this.handler(request);
  }

  async alarm() {
    let startAfter;
    do {
      const records = await this.storage.list({ prefix: "auth:", limit: 500, ...(startAfter ? { startAfter } : {}) });
      if (!records.size) break;
      const expired = [...records].filter(([, record]) => record.expiresAt != null && record.expiresAt <= Date.now()).map(([key]) => key);
      if (expired.length) await this.storage.delete(expired);
      startAfter = [...records.keys()].at(-1);
      if (records.size < 500) break;
    } while (true);
    await this.storage.setAlarm(Date.now() + 86400000);
  }
}

export default {
  fetch(request, env) {
    const id = env.CALENDAR.idFromName("primary");
    return env.CALENDAR.get(id).fetch(request);
  },
};
