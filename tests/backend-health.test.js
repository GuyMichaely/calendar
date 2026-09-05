import assert from "node:assert/strict";
import test from "node:test";
import { createCalendarBackend } from "../backend/http.js";

test("backend exposes a read-only health endpoint", async () => {
  const backend = createCalendarBackend({
    authHandler: async () => new Response("auth"),
    syncHandler: async () => new Response("sync"),
    allowedOrigins: ["https://guymichaely.com"],
  });

  const direct = await backend(new Request("https://sync.example/healthz"));
  assert.equal(direct.status, 200);
  assert.equal(await direct.text(), "ok");

  const browser = await backend(new Request("https://sync.example/healthz", {
    headers: { origin: "https://guymichaely.com" },
  }));
  assert.equal(browser.status, 200);
  assert.equal(browser.headers.get("access-control-allow-origin"), "https://guymichaely.com");
});
