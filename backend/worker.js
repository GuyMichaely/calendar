// The calendar at calendar.guymichaely.com. The app's built files are static assets; this runs only
// for /sync, the sync server. Cloudflare Access guards /sync (only its policy's account gets
// through), so nothing here checks who's asking. The app and /sync share one origin: no CORS.
//
//   GET  /sync/signin             after Access signs you in, sends the browser back to the app
//   POST /sync                    one round of Automerge's sync protocol (backend/sync/http.js)
//   GET  /sync/live               a WebSocket that's sent { heads } whenever the calendar changes
//   *    /sync/attachments/:id    attachment bytes, stored in R2 (backend/sync/attachments-http.js)
import * as Automerge from "@automerge/automerge";
import { DurableObject } from "cloudflare:workers";
import { loadCalendarDocument } from "../sync/automerge-document.js";
import { createAttachmentHandler } from "./sync/attachments-http.js";
import { createSyncHandler } from "./sync/http.js";

const DOCUMENT = "calendar:primary";

// One object holds the one calendar, so its updates are serialized.
export class CalendarStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Answering pings doesn't wake the object, so idle live connections cost nothing.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, bytes BLOB NOT NULL)");
    const documentStore = {
      async update(key, updater) {
        const row = sql.exec("SELECT bytes FROM documents WHERE id = ?", key).toArray()[0];
        const outcome = await updater(row ? new Uint8Array(row.bytes) : null);
        sql.exec("INSERT OR REPLACE INTO documents (id, bytes) VALUES (?, ?)", key, outcome.value);
        return outcome.result;
      },
    };
    const bucket = env.ATTACHMENTS;
    const blobStore = {
      async get(key) {
        const object = await bucket.get("attachments/" + key);
        return object ? { bytes: new Uint8Array(await object.arrayBuffer()), contentType: object.httpMetadata?.contentType } : null;
      },
      async putIfAbsent(key, value) {
        const stored = await bucket.put("attachments/" + key, value.bytes, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: value.contentType } });
        return stored !== null;
      },
    };
    this.sql = sql;
    this.sync = createSyncHandler({ documentStore, documentKey: DOCUMENT, onChanged: heads => this.announce(heads) });
    this.attachments = createAttachmentHandler({ blobStore });
    this.tail = Promise.resolve();
  }

  /** The calendar's current heads, which a device compares with its own to tell whether it's behind. */
  heads() {
    const row = this.sql.exec("SELECT bytes FROM documents WHERE id = ?", DOCUMENT).toArray()[0];
    return row ? Automerge.getHeads(loadCalendarDocument(new Uint8Array(row.bytes))) : [];
  }

  announce(heads) {
    const message = JSON.stringify({ heads });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(message); } catch { /* A connection that's going away reconnects and syncs anyway. */ }
    }
  }

  fetch(request) {
    if (new URL(request.url).pathname === "/sync/live") {
      if (request.headers.get("upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ heads: this.heads() }));
      return new Response(null, { status: 101, webSocket: client });
    }
    // One request at a time: awaited R2 calls mustn't let another read-merge-write interleave.
    const handle = () => new URL(request.url).pathname === "/sync" ? this.sync(request) : this.attachments(request);
    const result = this.tail.then(handle);
    this.tail = result.then(() => {}, () => {});
    return result;
  }

  webSocketClose(socket, code) {
    socket.close(code === 1005 ? 1000 : code, "closing");
  }
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/sync/signin") return new Response(null, { status: 302, headers: { location: "/#sync-signed-in" } });
    if (pathname === "/sync" || pathname.startsWith("/sync/")) return env.CALENDAR.get(env.CALENDAR.idFromName("primary")).fetch(request);
    return env.ASSETS.fetch(request);
  },
};
