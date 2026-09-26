import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const app = fs.readFileSync(path.resolve(import.meta.dirname, "../solid/src/App.tsx"), "utf8");
const session = fs.readFileSync(path.resolve(import.meta.dirname, "../solid/src/remote-session.ts"), "utf8");
const remoteSync = fs.readFileSync(path.resolve(import.meta.dirname, "../solid/src/remote-sync.ts"), "utf8");

test("Solid refreshes authenticated remote state after reconnect and when the tab resumes", () => {
  assert.match(session, /window\.addEventListener\("online", refreshRemoteOnResume\)/u);
  assert.match(session, /document\.addEventListener\("visibilitychange", syncRemoteWhenVisible\)/u);
  assert.match(session, /document\.visibilityState === "visible"/u);
  assert.match(session, /if \(remoteSession\(\)\?\.authenticated\)/u);
  assert.match(session, /else if \(remoteSession\(\) === null && remoteError\(\)\)/u);
  assert.match(session, /window\.removeEventListener\("online", refreshRemoteOnResume\)/u);
  assert.match(session, /document\.removeEventListener\("visibilitychange", syncRemoteWhenVisible\)/u);
});

test("Solid lets the user configure the remote sync server from the hamburger menu", () => {
  assert.match(app, /Remote sync server/u);
  assert.match(app, /saveConfiguredBackendUrl\(remoteUrlDraft\(\)\)/u);
  assert.match(app, /window\.location\.reload\(\)/u);
  assert.match(remoteSync, /calendar\.remoteBackendUrl/u);
  assert.match(remoteSync, /window\.localStorage\?\.getItem\(REMOTE_BACKEND_STORAGE_KEY\)/u);
  assert.match(remoteSync, /window\.localStorage\.setItem\(REMOTE_BACKEND_STORAGE_KEY, normalized\)/u);
  assert.match(remoteSync, /VITE_CALENDAR_BACKEND_URL/u);
});
