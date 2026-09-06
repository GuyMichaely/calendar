import assert from "node:assert/strict";
import test from "node:test";
import { createBunHttpServer } from "../backend/bun-http.js";

test("Bun adapter preserves the public URL, request body, response status, and cookies behind an HTTP tunnel", async () => {
  const server = createBunHttpServer({
    port: 0,
    publicBaseUrl: "https://calendar.example/api/",
    handleRequest: async (request) => {
      assert.equal(request.url, "https://calendar.example/api/echo?value=1");
      assert.equal(request.method, "POST");
      assert.equal(await request.text(), "hello");

      const headers = new Headers();
      headers.append("set-cookie", "first=1; Path=/");
      headers.append("set-cookie", "second=2; Path=/");
      return new Response("ok", { status: 201, headers });
    },
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/echo?value=1`, {
      method: "POST",
      body: "hello",
      headers: { "x-forwarded-host": "untrusted.example", "x-forwarded-proto": "http" },
    });

    assert.equal(response.status, 201);
    assert.equal(await response.text(), "ok");
    assert.deepEqual(response.headers.getSetCookie(), [
      "first=1; Path=/",
      "second=2; Path=/",
    ]);
  } finally {
    await server.stop(true);
  }
});
