import { syncCalendarStorage } from "../sync/client.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { createCalendarDocument, loadCalendarDocument, materializeItems, saveCalendarDocument } from "../sync/automerge-document.js";

const directory = await mkdtemp(resolve(".local/worker-smoke-"));
const config = JSON.parse(await Bun.file("backend/cloudflare/wrangler.jsonc").text());
config.main = resolve("tests/fixtures/cloudflare-worker.js");
config.vars = {
  CALENDAR_APP_URL: "https://app.example/",
  CALENDAR_PUBLIC_BASE_URL: "https://sync.example/",
  GOOGLE_CLIENT_ID: "local-test", GOOGLE_CLIENT_SECRET: "local-test", ALLOWED_GOOGLE_SUBJECT: "test",
};
delete config.limits;
const configPath = directory + "/wrangler.json";
await Bun.write(configPath, JSON.stringify(config));
const child = Bun.spawn(["./scripts/worker", "dev", "--local", "--port", "8791", "--persist-to", directory + "/state"], {
  env: { ...process.env, CALENDAR_WORKER_CONFIG: configPath },
  stdout: Bun.file(directory + "/runtime.log"), stderr: Bun.file(directory + "/runtime.log"),
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    try { if ((await fetch("http://127.0.0.1:8791/healthz", { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    if (child.exitCode != null) break;
    await Bun.sleep(200);
  }
  assert.ok(ready, "Worker did not start; see " + directory + "/runtime.log");
  const endpoint = "http://127.0.0.1:8791";
  assert.equal((await fetch(endpoint + "/sync", { method: "POST" })).status, 401);
  const headers = { cookie: "__Host-calendar_session=local-test", "content-type": "application/vnd.automerge.sync" };
  async function sync(doc) {
    let current = doc;
    await syncCalendarStorage({ readSnapshot: async () => saveCalendarDocument(current), mergeSnapshot: async bytes => { current = loadCalendarDocument(bytes); } }, {
      endpoint: endpoint + "/sync",
      fetch: (url, init) => fetch(url, { ...init, headers: { ...init.headers, cookie: headers.cookie } }),
    });
    return current;
  }
  await sync(createCalendarDocument([{ id: "a", kind: "task", title: "First device" }]));
  const merged = await sync(createCalendarDocument([{ id: "b", kind: "task", title: "Second device" }]));
  assert.deepEqual(materializeItems(merged).map(item => item.id).sort(), ["a", "b", "seed"]);
  const fileHeaders = { cookie: headers.cookie, "content-type": "text/plain" };
  assert.equal((await fetch(endpoint + "/attachments/test", { method: "PUT", headers: fileHeaders, body: "original" })).status, 204);
  await fetch(endpoint + "/attachments/test", { method: "PUT", headers: fileHeaders, body: "replacement" });
  assert.equal(await (await fetch(endpoint + "/attachments/test", { headers: fileHeaders })).text(), "original");
  assert.equal((await fetch(endpoint + "/attachments/test")).status, 401);
  assert.equal((await fetch(endpoint + "/sync", { method: "POST", headers: { ...headers, origin: "https://untrusted.example" } })).status, 403);
  console.log("Worker smoke passed: health, auth, persisted snapshot loading, independent-device merges, immutable R2 attachments, and origin rejection.");
} finally {
  child.kill();
  await child.exited;
  // Keep logs on failure for diagnosis; no real credentials or data are used.
}
