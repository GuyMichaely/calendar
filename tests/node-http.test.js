import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createNodeHttpServer } from "../backend/node-http.js";

test("Node adapter preserves the public URL, request body, response status, and cookies", async () => {
  const server = createNodeHttpServer({
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

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/echo?value=1`, {
      method: "POST",
      body: "hello",
    });

    assert.equal(response.status, 201);
    assert.equal(await response.text(), "ok");
    assert.deepEqual(response.headers.getSetCookie(), [
      "first=1; Path=/",
      "second=2; Path=/",
    ]);
  } finally {
    server.close();
    await once(server, "close");
  }
});
