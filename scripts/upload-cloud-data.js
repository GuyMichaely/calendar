// First cutover only, after pausing writes to the local server.
import { readdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { loadCalendarDocument } from "../sync/automerge-document.js";
const directory = process.argv[2];
if (!directory) throw new Error("Usage: ./scripts/bun scripts/upload-cloud-data.js .local/cloud-backup");
const root = resolve(directory);
const bucket = "calendar-sync-attachments";
const snapshot = join(root, "documents", Buffer.from("calendar:primary").toString("base64url") + ".automerge");
const snapshotBytes = new Uint8Array(await Bun.file(snapshot).arrayBuffer());
loadCalendarDocument(snapshotBytes);
if (snapshotBytes.byteLength > 1_900_000) throw new Error("Snapshot is close to the Durable Object row limit. Stop here and implement chunked document storage before cutover.");
const entries = [];
let names;
try { names = await readdir(join(root, "blobs")); }
catch (error) { if (error.code !== "ENOENT") throw error; names = []; }
for (const name of names) {
  if (name.includes(".tmp-")) continue;
  const id = Buffer.from(name, "base64url").toString("utf8");
  if (Buffer.from(id).toString("base64url") !== name) throw new Error("Invalid attachment directory.");
  const metadata = await Bun.file(join(root, "blobs", name, "metadata.json")).json();
  entries.push({ key: "attachments/" + id, file: join(root, "blobs", name, "blob"), type: metadata.contentType || "application/octet-stream" });
}
const verificationDirectory = await mkdtemp(join(root, ".cloud-verification-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  for (const [index, entry] of [...entries, { key: "__initial_calendar.automerge", file: snapshot, type: "application/vnd.automerge" }].entries()) {
    const source = new Uint8Array(await Bun.file(entry.file).arrayBuffer());
    const child = Bun.spawn(["./scripts/worker", "r2", "object", "put", bucket + "/" + entry.key, "--file", entry.file, "--content-type", entry.type, "--remote"], { stdout: "inherit", stderr: "inherit" });
    if (await child.exited !== 0) throw new Error("Cloud upload failed; preserve the local backup and retry before cutover.");
    const downloaded = join(verificationDirectory, String(index));
    const check = Bun.spawn(["./scripts/worker", "r2", "object", "get", bucket + "/" + entry.key, "--file", downloaded, "--remote"], { stdout: "inherit", stderr: "inherit" });
    if (await check.exited !== 0) throw new Error("Could not verify cloud data; do not change the hostname.");
    const received = new Uint8Array(await Bun.file(downloaded).arrayBuffer());
    if (digest(source) !== digest(received)) throw new Error("Cloud data hash mismatch; do not change the hostname.");
  }
} finally {
  await rm(verificationDirectory, { recursive: true, force: true });
}
console.log(`Uploaded and SHA-256 verified ${entries.length} attachments and the initial Automerge snapshot. Existing cloud calendar rows are never replaced by the seed.`);
