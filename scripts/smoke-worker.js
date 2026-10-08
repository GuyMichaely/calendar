// Runs the Worker locally (wrangler dev, with no Access in front) against the built app, and
// tries what devices do: sign-in's return, two devices merging, the live connection hearing a
// change, attachments in R2, and the app's files. Needs `bun run build:solid` first.
import { syncCalendarStorage } from "../sync/client.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { createCalendarDocument, loadCalendarDocument, materializeItems, saveCalendarDocument } from "../sync/automerge-document.js";

const directory = await mkdtemp(resolve(".local/worker-smoke-"));
const config = JSON.parse((await Bun.file("backend/wrangler.jsonc").text()).replace(/^\s*\/\/.*$/gmu, ""));
config.main = resolve("tests/fixtures/cloudflare-worker.js");
config.assets.directory = resolve("dist");
delete config.routes;
const configPath = directory + "/wrangler.json";
await Bun.write(configPath, JSON.stringify(config));
const child = Bun.spawn(["./scripts/worker", "dev", "--local", "--port", "8791", "--persist-to", directory + "/state"], {
  env: { ...process.env, CALENDAR_WORKER_CONFIG: configPath },
  stdout: Bun.file(directory + "/runtime.log"), stderr: Bun.file(directory + "/runtime.log"),
});
const endpoint = "http://127.0.0.1:8791";
try {
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    try { if ((await fetch(endpoint + "/", { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    if (child.exitCode != null) break;
    await Bun.sleep(200);
  }
  assert.ok(ready, "Worker did not start; see " + directory + "/runtime.log");
  assert.match(await (await fetch(endpoint + "/")).text(), /<div id="app">/u);
  const signin = await fetch(endpoint + "/sync/signin", { redirect: "manual" });
  assert.equal(signin.status, 200);
  assert.match(await signin.text(), /location\.replace\("\/"\)/u);
  const framed = encodeURIComponent("https://guymichaely.com/calendar/#agenda");
  assert.match(await (await fetch(endpoint + "/sync/signin?return=" + framed)).text(), /location\.replace\("https:\/\/guymichaely\.com\/calendar\/#agenda"\)/u);
  assert.match(await (await fetch(endpoint + "/sync/signin?return=" + encodeURIComponent("https://elsewhere.example/</script>"))).text(), /location\.replace\("\/"\)/u);

  const live = new WebSocket(endpoint.replace("http", "ws") + "/sync/live");
  const heard = [];
  live.addEventListener("message", event => heard.push(JSON.parse(event.data)));
  await new Promise((done, fail) => { live.addEventListener("open", done); live.addEventListener("error", fail); });
  const sync = async doc => {
    let current = doc;
    await syncCalendarStorage({ readSnapshot: async () => saveCalendarDocument(current), mergeSnapshot: async bytes => { current = loadCalendarDocument(bytes); } }, { endpoint: endpoint + "/sync" });
    return current;
  };
  await sync(createCalendarDocument([{ id: "a", kind: "task", title: "First device" }]));
  const merged = await sync(createCalendarDocument([{ id: "b", kind: "task", title: "Second device", availableFrom: new Date(Date.now() + 86_400_000).toISOString() }]));
  assert.deepEqual(materializeItems(merged).map(item => item.id).sort(), ["a", "b", "seed"]);
  for (let attempt = 0; attempt < 50 && heard.length < 3; attempt++) await Bun.sleep(50);
  // On connecting, then once for each device's change.
  assert.ok(heard.length >= 3 && heard.every(message => Array.isArray(message.heads)), JSON.stringify(heard));
  live.close();

  // A phone registers, and reads its reminders: the second device's task, when it can start tomorrow.
  assert.equal((await fetch(endpoint + "/sync/devices", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "test-device" }) })).status, 204);
  const reminders = await (await fetch(endpoint + "/sync/reminders?taskStarts=1&events=1")).json();
  assert.deepEqual(reminders.map(reminder => [reminder.itemId, reminder.channel, reminder.title]), [["b", "starts", "Second device"]]);
  assert.deepEqual(await (await fetch(endpoint + "/sync/reminders?taskStarts=0&events=0")).json(), []);
  assert.equal((await fetch(endpoint + "/sync/devices", { method: "PUT", body: "{}" })).status, 400);
  // A browser's push subscription, for a page the server will open (the app, or a page framing it).
  const push = body => fetch(endpoint + "/sync/push", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const subscription = { endpoint: "https://push.example/abc", keys: { p256dh: "key", auth: "secret" } };
  assert.equal((await push({ subscription, settings: { taskStarts: true, events: true }, open: "https://guymichaely.com/calendar/" })).status, 204);
  assert.equal((await push({ subscription, settings: { taskStarts: true, events: true }, open: "https://elsewhere.example/" })).status, 400);
  assert.equal((await fetch(endpoint + "/sync/push", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) })).status, 204);

  const file = { "content-type": "text/plain" };
  assert.equal((await fetch(endpoint + "/sync/attachments/test", { method: "PUT", headers: file, body: "original" })).status, 204);
  await fetch(endpoint + "/sync/attachments/test", { method: "PUT", headers: file, body: "replacement" });
  assert.equal(await (await fetch(endpoint + "/sync/attachments/test")).text(), "original");
  console.log("Worker smoke passed: the app's files, sign-in's return, a stored calendar loading, two devices merging, live announcements, device registration and reminders, and immutable R2 attachments.");
} finally {
  child.kill();
  await child.exited;
  // Keep logs on failure for diagnosis; no real credentials or data are used.
}
