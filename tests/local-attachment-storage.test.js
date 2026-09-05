import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB } from "fake-indexeddb";
import { putLocalAttachmentBlob } from "../site/attachment-storage.js";
import { listLocalItems, putLocalItem } from "../site/automerge-storage.js";

globalThis.indexedDB = indexedDB;

function item() {
  return {
    id: "attachment-hydration-item",
    kind: "task",
    title: "Attachment hydration",
    notes: "",
    state: "open",
    tags: [],
    attachments: [{ id: "remote-attachment", name: "remote.txt", type: "text/plain", size: 6 }],
    createdAt: "2026-09-04T12:00:00.000Z",
    updatedAt: "2026-09-04T12:00:00.000Z",
    history: [{ at: "2026-09-04T12:00:00.000Z", type: "created" }],
  };
}

test("a downloaded blob is hydrated onto existing synced attachment metadata", async () => {
  await putLocalItem(item());
  let [before] = (await listLocalItems()).filter((candidate) => candidate.id === "attachment-hydration-item");
  assert.equal(before.attachments[0].blob, undefined);

  await putLocalAttachmentBlob("remote-attachment", new Blob(["remote"], { type: "text/plain" }));
  const [after] = (await listLocalItems()).filter((candidate) => candidate.id === "attachment-hydration-item");
  assert.ok(after.attachments[0].blob instanceof Blob);
  assert.equal(await after.attachments[0].blob.text(), "remote");
  assert.equal(after.attachments[0].blob.type, "text/plain");
});
