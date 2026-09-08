import { syncCalendarStorage } from "../sync/client.js";
// Exercise only the isolated trial Worker, never the production hostname.
import assert from "node:assert/strict";
import { createCalendarDocument, forkCalendarDocument, loadCalendarDocument, materializeItems, materializeItem, patchItem, saveCalendarDocument, updateItemText } from "../sync/automerge-document.js";
const endpoint = new URL(process.argv[2]);
if (!endpoint.hostname.startsWith("calendar-sync-trial.") || !endpoint.hostname.endsWith(".workers.dev")) throw new Error("Expected the isolated calendar-sync-trial workers.dev URL.");
const { TRIAL_TOKEN } = await Bun.file(".local/trial-secrets.json").json();
const prefix = crypto.randomUUID();
const timings = [];
async function sync(doc) {
  const start = performance.now();
  let result = doc;
  await syncCalendarStorage({ readSnapshot: async () => saveCalendarDocument(result), mergeSnapshot: async bytes => { result = loadCalendarDocument(bytes); } }, {
    endpoint: new URL("/sync", endpoint).href,
    fetch: (url, init) => fetch(url, { ...init, headers: { ...init.headers, cookie: "__Host-calendar_session=" + TRIAL_TOKEN } }),
    signal: AbortSignal.timeout(60000),
  });
  timings.push(Math.round(performance.now() - start));
  return result;
}
assert.equal((await fetch(new URL("/sync", endpoint), { method: "POST" })).status, 401);
const task = (index) => ({
  id: prefix + "-" + index, kind: "task", title: "Synthetic task " + index,
  notes: "A realistic note about planning and scheduling. ".repeat(40),
  tags: ["trial"], attachments: [], state: "open", deadline: null,
  history: Array.from({ length: 10 }, (_, i) => ({ at: "2026-09-07T00:00:00Z", type: "synthetic-edit-" + i })),
});
const initial = createCalendarDocument(Array.from({ length: 200 }, (_, i) => task(i)));
let current = await sync(initial);
const fresh = await sync(createCalendarDocument());
assert.equal(materializeItems(fresh).filter(item => item.id.startsWith(prefix)).length, 200);
const id = prefix + "-0";
const left = patchItem(forkCalendarDocument(current), id, { deadline: "2026-10-01T12:00:00Z" });
const right = updateItemText(forkCalendarDocument(current), id, "notes", materializeItem(current, id).notes + " Concurrent edit.");
await Promise.all([sync(left), sync(right)]);
current = await sync(createCalendarDocument());
assert.equal(materializeItem(current, id).deadline, "2026-10-01T12:00:00Z");
assert.ok(materializeItem(current, id).notes.endsWith(" Concurrent edit."));
for (let i = 0; i < 15; i++) current = await sync(current);
timings.sort((a, b) => a - b);
console.log(JSON.stringify({
  passed: true, syntheticTasks: 200, requests: timings.length,
  snapshotBytes: saveCalendarDocument(current).byteLength,
  latencyMs: { median: timings[Math.floor(timings.length / 2)], max: timings.at(-1) },
  note: "Latency includes network and client processing; this is not a CPU-time measurement. Google login and R2 are outside this isolated trial.",
}, null, 2));
