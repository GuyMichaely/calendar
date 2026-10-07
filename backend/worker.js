// The calendar at calendar.guymichaely.com, its own origin, so no other site shares its storage or
// sign-in. The app's built files are static assets; this runs only for /sync, the sync server.
// Cloudflare Access guards /sync (only its policy's account gets through), so nothing here checks
// who's asking. The app and /sync share one origin: no CORS.
//
//   GET  /sync/signin?return=     after Access signs you in, sends the browser back to the app
//   POST /sync                    one round of Automerge's sync protocol (backend/sync/http.js)
//   GET  /sync/live               a WebSocket that's sent { heads } whenever the calendar changes
//   *    /sync/attachments/:id    attachment bytes, stored in R2 (backend/sync/attachments-http.js)
//   PUT/DELETE /sync/devices       { token }: a phone's FCM token, to tell it when reminders change
//   GET  /sync/reminders?taskStarts=1&events=1
//                                  that phone's coming reminders, worked out here (solid/src/reminders.ts)
//   PUT  /sync/push                { subscription, settings, open }: a browser's Web Push subscription
//   DELETE /sync/push              { endpoint }
//
// After the calendar changes (30 seconds after, so a burst of edits sends one message), each phone is
// sent a data message through FCM; its app then fetches /sync/reminders and reschedules. Browsers
// can't schedule notifications, so each reminder is pushed to them at its time.
import * as Automerge from "@automerge/automerge";
import { DurableObject } from "cloudflare:workers";
import { VAPID_PUBLIC_KEY } from "../solid/src/push-key.ts";
import { upcomingReminders } from "../solid/src/reminders.ts";
import { setCalendarZone } from "../solid/src/zone.ts";
import { loadCalendarDocument, materializeItems } from "../sync/automerge-document.js";
import { createFcm } from "./fcm.js";
import { createAttachmentHandler } from "./sync/attachments-http.js";
import { createSyncHandler } from "./sync/http.js";
import { createWebPush } from "./web-push.js";

const DOCUMENT = "calendar:primary";
// The pages that show the app in a frame (guymichaely.com/calendar/, from the homepage repo): signing
// in and notifications go back to them.
const frames = ["https://guymichaely.com/calendar/"];
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// Where each browser's reminders are up to: the ones due before it have gone (or were refused).
const pushedKey = endpoint => `pushed:${endpoint}`;

// One object holds the one calendar, so its updates are serialized.
export class CalendarStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Answering pings doesn't wake the object, so idle live connections cost nothing.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, bytes BLOB NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS devices (token TEXT PRIMARY KEY, updated_at INTEGER NOT NULL)");
    // A browser's push subscription, what it reminds about ({ taskStarts, events }), and the page a
    // tapped notification opens (the app, or a page framing it).
    sql.exec("CREATE TABLE IF NOT EXISTS pushes (endpoint TEXT PRIMARY KEY, subscription TEXT NOT NULL, settings TEXT NOT NULL, open TEXT NOT NULL)");
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
    this.webPush = env.VAPID_PRIVATE_KEY ? createWebPush({ publicKey: VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: "https://guymichaely.com/" }) : null;
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

  /** The calendar's items, with its time zone set for reading them. */
  items() {
    const doc = this.document();
    const items = doc ? materializeItems(doc) : [];
    const zone = items.find(item => item.kind === "settings")?.timeZone;
    if (zone) setCalendarZone(zone);
    return items;
  }

  /** A phone's coming reminders, as its app would work them out. */
  reminders(settings) {
    return upcomingReminders(this.items(), new Date(), settings).map(reminder => ({ ...reminder, at: reminder.at.getTime() }));
  }

  // One alarm does both jobs: telling phones the calendar changed (fcmAt, once a burst of changes
  // has settled) and pushing each browser its reminders as they come due (those after its pushedKey).
  async remindLater() {
    if (this.fcm && await this.ctx.storage.get("fcmAt") == null && this.sql.exec("SELECT 1 FROM devices LIMIT 1").toArray().length) await this.ctx.storage.put("fcmAt", Date.now() + 30_000);
    await this.schedule();
  }

  pushes() {
    return this.sql.exec("SELECT endpoint, subscription, settings, open FROM pushes").toArray()
      .map(row => ({ endpoint: row.endpoint, subscription: JSON.parse(row.subscription), settings: JSON.parse(row.settings), open: row.open }));
  }

  // A browser's reminders still to send: those after where it's up to, as far back as a day (late
  // is better than never, but not by more than that).
  async pushFrom(endpoint, now) {
    return Math.max(await this.ctx.storage.get(pushedKey(endpoint)) ?? now, now - DAY);
  }

  async schedule() {
    const times = [await this.ctx.storage.get("fcmAt")];
    const pushes = this.webPush ? this.pushes() : [];
    if (pushes.length) {
      const now = Date.now();
      const items = this.items();
      for (const { endpoint, settings } of pushes) {
        const next = upcomingReminders(items, new Date(await this.pushFrom(endpoint, now)), settings, 14, 1)[0]?.at.getTime();
        // One already due is waiting on a push service that couldn't take it: try again in a minute.
        times.push(next != null && next <= now ? now + MINUTE : next);
      }
    }
    const next = Math.min(...times.filter(time => time != null));
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next); else await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    const now = Date.now();
    const fcmAt = await this.ctx.storage.get("fcmAt");
    if (fcmAt != null && fcmAt <= now) {
      await this.ctx.storage.delete("fcmAt");
      if (this.fcm) for (const { token } of this.sql.exec("SELECT token FROM devices").toArray()) {
        try {
          if (await this.fcm.send(token, { type: "reminders" }, { collapseKey: "reminders" }) === "gone") this.sql.exec("DELETE FROM devices WHERE token = ?", token);
        } catch (error) {
          console.error("Could not tell a phone its reminders changed", error);
        }
      }
    }
    const pushes = this.webPush ? this.pushes() : [];
    const items = pushes.length ? this.items() : [];
    for (const { endpoint, subscription, settings, open } of pushes) {
      // Each browser on its own: one whose push service is down keeps its place without holding up the rest.
      let upTo = now;
      for (const reminder of upcomingReminders(items, new Date(await this.pushFrom(endpoint, now)), settings).filter(reminder => reminder.at.getTime() <= now)) {
        const url = open + (reminder.channel === "starts" ? `#tasks/${encodeURIComponent(reminder.itemId)}` : "#calendar");
        let result;
        try {
          // The push service holds it for a day while the browser is closed or offline.
          result = await this.webPush.send(subscription, { title: reminder.title, body: reminder.body, tag: String(reminder.id), url }, { ttl: DAY / 1000 });
        } catch (error) {
          console.error("A push service refused a reminder", error);
          continue;
        }
        if (result === "gone") { upTo = null; break; }
        // From just before this one, so it (and any due at the same moment) goes next time.
        if (result === "retry") { upTo = reminder.at.getTime() - 1; break; }
      }
      if (upTo == null) {
        this.sql.exec("DELETE FROM pushes WHERE endpoint = ?", endpoint);
        await this.ctx.storage.delete(pushedKey(endpoint));
      } else {
        await this.ctx.storage.put(pushedKey(endpoint), upTo);
      }
    }
    await this.schedule();
  }

  async push(request) {
    if (!["PUT", "DELETE"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { allow: "PUT, DELETE" } });
    let body;
    try { body = await request.json(); } catch { /* checked below */ }
    if (request.method === "DELETE") {
      if (typeof body?.endpoint !== "string") return new Response("Expected { endpoint }", { status: 400 });
      this.sql.exec("DELETE FROM pushes WHERE endpoint = ?", body.endpoint);
      await this.ctx.storage.delete(pushedKey(body.endpoint));
    } else {
      const { subscription, settings, open } = body ?? {};
      const own = new URL("/", request.url).href;
      const valid = typeof subscription?.endpoint === "string" && subscription.endpoint.startsWith("https://") && typeof subscription.keys?.p256dh === "string" && typeof subscription.keys?.auth === "string"
        && typeof settings?.taskStarts === "boolean" && typeof settings?.events === "boolean" && (open === own || frames.includes(open));
      if (!valid) return new Response("Expected { subscription, settings: { taskStarts, events }, open }", { status: 400 });
      // A new browser starts from now; one already here keeps its place.
      if (await this.ctx.storage.get(pushedKey(subscription.endpoint)) == null) await this.ctx.storage.put(pushedKey(subscription.endpoint), Date.now());
      this.sql.exec("INSERT OR REPLACE INTO pushes (endpoint, subscription, settings, open) VALUES (?, ?, ?, ?)", subscription.endpoint,
        JSON.stringify({ endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } }), JSON.stringify({ taskStarts: settings.taskStarts, events: settings.events }), open);
    }
    await this.schedule();
    return new Response(null, { status: 204 });
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
    if (url.pathname === "/sync/push") return this.push(request);
    if (url.pathname === "/sync/reminders") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { allow: "GET" } });
      const settings = { taskStarts: url.searchParams.get("taskStarts") === "1", events: url.searchParams.get("events") === "1" };
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
// itself (Capacitor, to add its bridge) and follows redirects without moving the address, which
// would stay here. Signing in from guymichaely.com/calendar/, the page that shows the app in a
// frame, comes back there (it adds return=); any other return goes to the app.
const signedIn = back => {
  const to = back && frames.some(frame => back.startsWith(frame)) ? back : "/";
  return `<!doctype html><meta charset="utf-8"><title>Signed in</title><script>location.replace(${JSON.stringify(to).replaceAll("<", "\\u003c")})</script>`;
};

export default {
  fetch(request, env) {
    const { pathname, searchParams } = new URL(request.url);
    if (pathname === "/sync/signin") return new Response(signedIn(searchParams.get("return")), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (pathname === "/sync" || pathname.startsWith("/sync/")) return env.CALENDAR.get(env.CALENDAR.idFromName("primary")).fetch(request);
    return env.ASSETS.fetch(request);
  },
};
