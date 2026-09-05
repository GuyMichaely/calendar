import assert from "node:assert/strict";
import test from "node:test";
import { createNodeHttpServer } from "../backend/node-http.js";

async function withServer(handleRequest, callback) {
  const server = createNodeHttpServer({ handleRequest, publicBaseUrl: "http://127.0.0.1/" });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("Node HTTP adapter preserves request path, method, headers, and bytes", async () => {
  await withServer(async (request) => {
    assert.equal(new URL(request.url).pathname, "/calendar-api/sync");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("content-type"), "application/octet-stream");
    assert.deepEqual(new Uint8Array(await request.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
    return new Response(new Uint8Array([9, 8, 7]), {
      status: 201,
      headers: { "content-type": "application/octet-stream", "x-calendar-test": "yes" },
    });
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/calendar-api/sync`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3, 4]),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-calendar-test"), "yes");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([9, 8, 7]));
  });
});

test("Node HTTP adapter default limit accepts attachment-sized requests above the sync limit", async () => {
  const bytes = new Uint8Array(7 * 1024 * 1024);
  bytes[0] = 17;
  bytes[bytes.length - 1] = 29;
  await withServer(async (request) => {
    const body = new Uint8Array(await request.arrayBuffer());
    assert.equal(body.byteLength, bytes.byteLength);
    assert.equal(body[0], 17);
    assert.equal(body.at(-1), 29);
    return new Response(null, { status: 204 });
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/attachments/large-local-test`, {
      method: "PUT",
      body: bytes,
    });
    assert.equal(response.status, 204);
  });
});

test("Node HTTP adapter forwards multiple Set-Cookie values", async () => {
  await withServer(async () => {
    const headers = new Headers();
    headers.append("set-cookie", "first=1; Path=/; HttpOnly");
    headers.append("set-cookie", "second=2; Path=/; HttpOnly");
    return new Response(null, { status: 204, headers });
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/login/example`, { redirect: "manual" });
    const cookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") || ""];
    assert.match(cookies.join("\n"), /first=1/u);
    assert.match(cookies.join("\n"), /second=2/u);
  });
});

test("Node HTTP adapter rejects an oversized request before invoking the backend", async () => {
  let called = false;
  const server = createNodeHttpServer({
    handleRequest: async () => {
      called = true;
      return new Response("unexpected");
    },
    publicBaseUrl: "http://127.0.0.1/",
    maxRequestBytes: 3,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/sync`, {
      method: "POST",
      body: new Uint8Array([1, 2, 3, 4]),
    });
    assert.equal(response.status, 413);
    assert.equal(called, false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
