// The calendar at calendar.guymichaely.com, its own origin, so no other site shares its storage or
// sign-in. The app's built files are static assets; this runs only for /sync, the sync server.
// Cloudflare Access guards /sync (only its policy's account gets through), so nothing here checks
// who's asking. The app and /sync share one origin: no CORS.
//
//   GET  /sync/signin             after Access signs you in, sends the browser back to the app
//   POST /sync                    one round of Automerge's sync protocol (backend/sync/http.js)
//   GET  /sync/live               a WebSocket that's sent { heads } whenever the calendar changes
//   *    /sync/attachments/:id    attachment bytes, stored in R2 (backend/sync/attachments-http.js)
//   PUT/DELETE /sync/devices       { token }: a phone's FCM token, to tell it when reminders change
//   GET  /sync/reminders?taskStarts=1&eventMinutes=30
//                                  that phone's coming reminders, worked out here (solid/src/reminders.ts)
//
// After the calendar changes (30 seconds after, so a burst of edits sends one message), each phone is
// sent a data message through FCM; its app then fetches /sync/reminders and reschedules.
import * as Automerge from "@automerge/automerge";
import { DurableObject } from "cloudflare:workers";
import { upcomingReminders } from "../solid/src/reminders.ts";
import { setCalendarZone } from "../solid/src/zone.ts";
import { loadCalendarDocument, materializeItems } from "../sync/automerge-document.js";
import { createFcm } from "./fcm.js";
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
    sql.exec("CREATE TABLE IF NOT EXISTS devices (token TEXT PRIMARY KEY, updated_at INTEGER NOT NULL)");
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
    this.sync = createSyncHandler({ documentStore, documentKey: DOCUMENT, onChanged: heads => { this.announce(heads); void this.remindLater(); } });
    this.fcm = env.FCM_SERVICE_ACCOUNT ? createFcm(env.FCM_SERVICE_ACCOUNT) : null;
    this.attachments = createAttachmentHandler({ blobStore });
    this.tail = Promise.resolve();
  }

  document() {
    const row = this.sql.exec("SELECT bytes FROM documents WHERE id = ?", DOCUMENT).toArray()[0];
    return row ? loadCalendarDocument(new Uint8Array(row.bytes)) : null;
  }

  /** The calendar's current heads, which a device compares with its own to tell whether it's behind. */
  heads() {
    const doc = this.document();
    return doc ? Automerge.getHeads(doc) : [];
  }

  /** A phone's coming reminders, as its app would work them out, read in the calendar's time zone. */
  reminders(settings) {
    const doc = this.document();
    const items = doc ? materializeItems(doc) : [];
    const zone = items.find(item => item.kind === "settings")?.timeZone;
    if (zone) setCalendarZone(zone);
    return upcomingReminders(items, new Date(), settings).map(reminder => ({ ...reminder, at: reminder.at.getTime() }));
  }

  // Phones hear about changes once a burst of them has settled.
  async remindLater() {
    if (!this.fcm || await this.ctx.storage.getAlarm() != null) return;
    if (this.sql.exec("SELECT 1 FROM devices LIMIT 1").toArray().length) await this.ctx.storage.setAlarm(Date.now() + 30_000);
  }

  async alarm() {
    if (!this.fcm) return;
    for (const { token } of this.sql.exec("SELECT token FROM devices").toArray()) {
      try {
        if (await this.fcm.send(token, { type: "reminders" }, { collapseKey: "reminders" }) === "gone") this.sql.exec("DELETE FROM devices WHERE token = ?", token);
      } catch (error) {
        console.error("Could not tell a phone its reminders changed", error);
      }
    }
  }

  async devices(request) {
    if (!["PUT", "DELETE"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { allow: "PUT, DELETE" } });
    let token;
    try { ({ token } = await request.json()); } catch { /* checked below */ }
    if (typeof token !== "string" || !token || token.length > 4096) return new Response("Expected { token }", { status: 400 });
    if (request.method === "PUT") this.sql.exec("INSERT OR REPLACE INTO devices (token, updated_at) VALUES (?, ?)", token, Date.now());
    else this.sql.exec("DELETE FROM devices WHERE token = ?", token);
    return new Response(null, { status: 204 });
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
    const url = new URL(request.url);
    if (url.pathname === "/sync/devices") return this.devices(request);
    if (url.pathname === "/sync/reminders") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { allow: "GET" } });
      const minutes = url.searchParams.get("eventMinutes");
      const settings = { taskStarts: url.searchParams.get("taskStarts") === "1", eventMinutes: minutes === null || minutes === "off" || !Number.isFinite(Number(minutes)) ? null : Number(minutes) };
      return Response.json(this.reminders(settings), { headers: { "cache-control": "no-store" } });
    }
    // One request at a time: awaited R2 calls mustn't let another read-merge-write interleave.
    const handle = () => url.pathname === "/sync" ? this.sync(request) : this.attachments(request);
    const result = this.tail.then(handle);
    this.tail = result.then(() => {}, () => {});
    return result;
  }

  webSocketClose(socket, code) {
    socket.close(code === 1005 ? 1000 : code, "closing");
  }
}

// Back to the app from signing in, by a page rather than a redirect: the Android app loads pages
// itself (Capacitor, to add its bridge) and follows redirects without telling the WebView, which
// then stays here and never sees the #sync-signed-in that turns sync on.
const signedIn = `<!doctype html><meta charset="utf-8"><title>Signed in</title><script>location.replace("/#sync-signed-in")</script>`;

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/sync/signin") return new Response(signedIn, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (pathname === "/sync" || pathname.startsWith("/sync/")) return env.CALENDAR.get(env.CALENDAR.idFromName("primary")).fetch(request);
    return env.ASSETS.fetch(request);
  },
};
