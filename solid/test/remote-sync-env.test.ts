import assert from "node:assert/strict";
import test from "node:test";
import { configuredBackendUrl } from "../src/remote-sync.ts";

test("remote backend stays disabled when Vite environment configuration is absent", () => {
  assert.equal(configuredBackendUrl(), "");
});
