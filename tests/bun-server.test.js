import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function reservePort() {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(url, child) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Backend exited before becoming healthy with code ${child.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok && await response.text() === "ok") return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("Backend did not become healthy.");
}

test("production Bun entrypoint starts with persistent storage and serves healthz", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "calendar-bun-server-"));
  const port = await reservePort();
  const publicBaseUrl = `http://127.0.0.1:${port}/`;
  const child = spawn(process.execPath, ["--no-env-file", "backend/bun-server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      CALENDAR_APP_URL: "http://localhost:5173/calendar/",
      CALENDAR_PUBLIC_BASE_URL: publicBaseUrl,
      CALENDAR_DATA_DIR: dataDirectory,
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      ALLOWED_GOOGLE_SUBJECT: "test-subject",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  try {
    await waitForHealth(`${publicBaseUrl}healthz`, child);
    assert.equal(child.exitCode, null);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode != null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        if (child.exitCode == null) child.kill("SIGKILL");
      }, 1000).unref();
    });
    await rm(dataDirectory, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
});
