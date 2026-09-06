import * as Automerge from "@automerge/automerge";
import assert from "node:assert/strict";
import test from "node:test";
import {
  addAttachmentMetadata,
  addTag,
  createCalendarDocument,
  forkCalendarDocument,
  getItemFieldConflicts,
  loadCalendarDocument,
  materializeItem,
  materializeItems,
  mergeCalendarDocuments,
  mergeSnapshotBytes,
  patchItem,
  restoreItem,
  saveCalendarDocument,
  tombstoneItem,
  updateItemText,
} from "../sync/automerge-document.js";

function task(overrides = {}) {
  return {
    id: "task-1",
    kind: "task",
    title: "Buy goggles",
    notes: "hello world",
    state: "open",
    tags: ["shopping"],
    attachments: [],
    availableFrom: null,
    deadline: "2026-09-30T17:00:00.000Z",
    sleep: null,
    ...overrides,
  };
}

test("calendar document round-trips and excludes tombstones by default", () => {
  let doc = createCalendarDocument([task()]);
  doc = tombstoneItem(doc, "task-1", "2026-09-04T04:00:00.000Z");

  const loaded = loadCalendarDocument(saveCalendarDocument(doc));
  assert.equal(materializeItems(loaded).length, 0);
  assert.equal(materializeItems(loaded, { includeDeleted: true })[0].deletedAt, "2026-09-04T04:00:00.000Z");
});

test("different fields changed on disconnected replicas merge together", () => {
  const base = createCalendarDocument([task()]);
  let laptop = forkCalendarDocument(base);
  let phone = forkCalendarDocument(base);

  laptop = patchItem(laptop, "task-1", { deadline: "2026-10-02T17:00:00.000Z" });
  phone = patchItem(phone, "task-1", { sleep: { until: "2026-09-20T04:00:00.000Z", startedAt: "2026-09-04T04:00:00.000Z" } });

  const merged = mergeCalendarDocuments(laptop, phone);
  const result = materializeItem(merged, "task-1");
  assert.equal(result.deadline, "2026-10-02T17:00:00.000Z");
  assert.equal(result.sleep.until, "2026-09-20T04:00:00.000Z");
});

test("concurrent tag additions are both preserved", () => {
  const base = createCalendarDocument([task()]);
  const laptop = addTag(forkCalendarDocument(base), "task-1", "pool");
  const phone = addTag(forkCalendarDocument(base), "task-1", "errands");

  const tags = materializeItem(mergeCalendarDocuments(laptop, phone), "task-1").tags;
  assert.deepEqual(new Set(tags), new Set(["shopping", "pool", "errands"]));
});

test("collaborative notes merge non-overlapping concurrent text edits", () => {
  const base = createCalendarDocument([task()]);
  const laptop = updateItemText(forkCalendarDocument(base), "task-1", "notes", "hello brave world");
  const phone = updateItemText(forkCalendarDocument(base), "task-1", "notes", "hello world!");

  const merged = mergeCalendarDocuments(laptop, phone);
  assert.equal(materializeItem(merged, "task-1").notes, "hello brave world!");
});

test("same-field concurrent writes remain inspectable as conflicts", () => {
  const base = createCalendarDocument([task()]);
  const laptop = patchItem(forkCalendarDocument(base), "task-1", { deadline: "2026-10-02T17:00:00.000Z" });
  const phone = patchItem(forkCalendarDocument(base), "task-1", { deadline: "2026-10-05T17:00:00.000Z" });

  const merged = mergeCalendarDocuments(laptop, phone);
  assert.deepEqual(
    new Set(getItemFieldConflicts(merged, "task-1", "deadline")),
    new Set(["2026-10-02T17:00:00.000Z", "2026-10-05T17:00:00.000Z"]),
  );
});

test("a tombstone and a concurrent edit merge without resurrecting the item", () => {
  const base = createCalendarDocument([task()]);
  const laptop = tombstoneItem(forkCalendarDocument(base), "task-1", "2026-09-04T04:00:00.000Z");
  const phone = patchItem(forkCalendarDocument(base), "task-1", { deadline: "2026-10-10T17:00:00.000Z" });

  const merged = mergeCalendarDocuments(laptop, phone);
  assert.equal(materializeItem(merged, "task-1"), null);
  assert.equal(materializeItem(merged, "task-1", { includeDeleted: true }).deadline, "2026-10-10T17:00:00.000Z");
});

test("restore is an explicit post-merge operation", () => {
  const base = createCalendarDocument([task()]);
  const deleted = tombstoneItem(forkCalendarDocument(base), "task-1", "2026-09-04T04:00:00.000Z");
  const edited = patchItem(forkCalendarDocument(base), "task-1", { title: "Buy custom goggles" });
  const merged = mergeCalendarDocuments(deleted, edited);
  const restored = restoreItem(merged, "task-1");

  assert.equal(materializeItem(restored, "task-1").title, "Buy custom goggles");
});

test("attachment blobs stay local while attachment metadata is synchronized", () => {
  const localBlob = new Blob(["private local bytes"], { type: "text/plain" });
  let doc = createCalendarDocument([task({ attachments: [{ id: "a1", name: "one.txt", size: 19, blob: localBlob }] })]);
  doc = addAttachmentMetadata(doc, "task-1", {
    id: "a2",
    name: "two.txt",
    size: 2,
    contentHash: "sha256:abc",
    blob: new Blob(["hi"]),
  });

  const attachments = materializeItem(doc, "task-1").attachments;
  assert.deepEqual(attachments.map((attachment) => attachment.id), ["a1", "a2"]);
  assert.equal("blob" in attachments[0], false);
  assert.equal("blob" in attachments[1], false);
});

test("the request-response snapshot sync primitive converges three replicas", () => {
  const base = createCalendarDocument([task()]);
  let laptop = patchItem(forkCalendarDocument(base), "task-1", { deadline: "2026-10-02T17:00:00.000Z" });
  let phone = addTag(forkCalendarDocument(base), "task-1", "pool");
  let tablet = patchItem(forkCalendarDocument(base), "task-1", { sleep: { until: "2026-09-20T04:00:00.000Z" } });
  let serverBytes = saveCalendarDocument(base);

  for (const client of [laptop, phone, tablet]) {
    const result = mergeSnapshotBytes(serverBytes, saveCalendarDocument(client));
    serverBytes = result.storedBytes;
  }

  const server = loadCalendarDocument(serverBytes);
  laptop = mergeCalendarDocuments(laptop, server);
  phone = mergeCalendarDocuments(phone, server);
  tablet = mergeCalendarDocuments(tablet, server);

  const expected = materializeItem(server, "task-1");
  assert.deepEqual(materializeItem(laptop, "task-1"), expected);
  assert.deepEqual(materializeItem(phone, "task-1"), expected);
  assert.deepEqual(materializeItem(tablet, "task-1"), expected);
  assert.equal(expected.deadline, "2026-10-02T17:00:00.000Z");
  assert.ok(expected.tags.includes("pool"));
  assert.equal(expected.sleep.until, "2026-09-20T04:00:00.000Z");
});

test("an edit made while a sync request is in flight survives response merge", () => {
  const base = createCalendarDocument([task()]);
  let client = patchItem(forkCalendarDocument(base), "task-1", { deadline: "2026-10-02T17:00:00.000Z" });
  const sentBytes = saveCalendarDocument(client);

  client = addTag(client, "task-1", "made-while-request-in-flight");
  const response = mergeSnapshotBytes(saveCalendarDocument(base), sentBytes).responseBytes;
  client = mergeCalendarDocuments(client, loadCalendarDocument(response));

  const result = materializeItem(client, "task-1");
  assert.equal(result.deadline, "2026-10-02T17:00:00.000Z");
  assert.ok(result.tags.includes("made-while-request-in-flight"));
});

test("replaying the same client snapshot is idempotent at the data level", () => {
  const base = createCalendarDocument([task()]);
  const client = addTag(forkCalendarDocument(base), "task-1", "pool");
  const first = mergeSnapshotBytes(saveCalendarDocument(base), saveCalendarDocument(client));
  const second = mergeSnapshotBytes(first.storedBytes, saveCalendarDocument(client));

  assert.deepEqual(
    materializeItems(loadCalendarDocument(first.storedBytes), { includeDeleted: true }),
    materializeItems(loadCalendarDocument(second.storedBytes), { includeDeleted: true }),
  );
});


test("independently initialized devices share the root but have distinct editing actors", () => {
  const emptyA = createCalendarDocument();
  const emptyB = createCalendarDocument();
  assert.deepEqual(Automerge.getHeads(emptyA), Automerge.getHeads(emptyB));
  assert.notEqual(Automerge.getActorId(emptyA), Automerge.getActorId(emptyB));
  const a = createCalendarDocument([task({ id: "a" })]);
  const b = createCalendarDocument([task({ id: "b" })]);
  const merged = mergeCalendarDocuments(a, b);
  assert.deepEqual(materializeItems(merged).map((item) => item.id).sort(), ["a", "b"]);
  assert.equal(Object.keys(Automerge.getConflicts(merged, "items") || {}).length, 0);
  assert.equal(materializeItems(mergeCalendarDocuments(merged, emptyA)).length, 2);
});

test("legacy root conflicts retain items, late edits, text history and tombstones", () => {
  const old = Automerge.from({ schemaVersion: 1, items: { "task-1": task() } }, { actor: "aa" });
  const blank = Automerge.from({ schemaVersion: 1, items: {} }, { actor: "bb" });
  let merged = mergeCalendarDocuments(old, blank);
  assert.equal(merged.items["task-1"], undefined); // The formerly hidden root.
  assert.equal(materializeItems(merged).length, 1);
  merged = updateItemText(merged, "task-1", "notes", "hello brave world");
  const late = updateItemText(forkCalendarDocument(old), "task-1", "notes", "hello world!");
  merged = mergeCalendarDocuments(merged, late);
  assert.equal(materializeItem(merged, "task-1").notes, "hello brave world!");
  merged = addTag(merged, "task-1", "recovered");
  merged = addAttachmentMetadata(merged, "task-1", { id: "file", name: "test.txt" });
  assert.ok(materializeItem(merged, "task-1").tags.includes("recovered"));
  assert.equal(materializeItem(merged, "task-1").attachments[0].id, "file");
  merged = tombstoneItem(merged, "task-1", "2026-09-06T12:00:00Z");
  merged = mergeCalendarDocuments(merged, late);
  assert.equal(materializeItems(merged).length, 0);
  merged = restoreItem(merged, "task-1");
  assert.equal(materializeItem(loadCalendarDocument(saveCalendarDocument(merged)), "task-1").notes, "hello brave world!");
  assert.equal(Object.keys(Automerge.getConflicts(merged, "items")).length, 2);
});

test("duplicate IDs across legacy roots resolve consistently without reviving a tombstone", () => {
  const a = Automerge.from({ schemaVersion: 1, items: { "task-1": task() } }, { actor: "aa" });
  const b = Automerge.from({ schemaVersion: 1, items: { "task-1": task({ deletedAt: "2026-09-06T12:00:00Z" }) } }, { actor: "bb" });
  assert.deepEqual(materializeItems(mergeCalendarDocuments(a, b)), []);
  assert.deepEqual(materializeItems(mergeCalendarDocuments(b, a)), []);
});
