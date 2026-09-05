import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryAuthStore } from "../auth/http.js";
import { createCalendarBackendHandler } from "../backend/app.js";
import { createNodeHttpServer } from "../backend/node-http.js";
import { createMemoryBlobStore } from "../sync/attachments-http.js";
import {
  createCalendarDocument,
  loadCalendarDocument,
  materializeItem,
  saveCalendarDocument,
} from "../sync/automerge-document.js";
import { AUTOMERGE_MEDIA_TYPE, createMemoryDocumentStore } from "../sync/http.js";

function cookieFrom(response, name) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  for (const value of values) {
    const match = new RegExp(`(?:^|,\\s*)${name}=([^;]*)`, "u").exec(value);
    if (match?.[1]) return `${name}=${match[1]}`;
  }
  return "";
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("local Node backend completes login, document sync, and attachment sync over real HTTP", async () => {
  let handleRequest = async () => new Response("Backend not initialized", { status: 503 });
  const server = createNodeHttpServer({
    handleRequest: (request) => handleRequest(request),
    publicBaseUrl: "http://127.0.0.1/",
  });
  const origin = await listen(server);

  try {
    const provider = {
      id: "example",
      issuer: "https://identity.example",
      clientId: "calendar-client",
    };
    const appOrigin = "http://app.example";
    const publicBaseUrl = `${origin}/calendar-api/`;
    handleRequest = createCalendarBackendHandler({
      config: {
        appUrl: `${appOrigin}/calendar/`,
        publicBaseUrl,
        basePath: "/calendar-api",
        allowedOrigins: [appOrigin],
        providers: [provider],
        allowedIdentities: [{ issuer: provider.issuer, subject: "guy" }],
      },
      authStore: createMemoryAuthStore(),
      documentStore: createMemoryDocumentStore(),
      blobStore: createMemoryBlobStore(),
      secureCookies: false,
      oidcClient: {
        async begin(currentProvider, redirectUri) {
          assert.equal(currentProvider.id, provider.id);
          assert.equal(redirectUri, `${publicBaseUrl}auth/callback/example`);
          return {
            authorizationUrl: new URL("https://identity.example/authorize?state=state-1"),
            transaction: {
              providerId: currentProvider.id,
              issuer: currentProvider.issuer,
              redirectUri,
              state: "state-1",
              nonce: "nonce-1",
              codeVerifier: "verifier-1",
            },
          };
        },
        async finish(currentProvider, callbackUrl, transaction) {
          assert.equal(currentProvider.id, provider.id);
          assert.equal(new URL(callbackUrl).searchParams.get("state"), transaction.state);
          return { issuer: currentProvider.issuer, subject: "guy", email: "guy@example.com" };
        },
      },
    });

    const login = await fetch(`${origin}/calendar-api/auth/login/example`, { redirect: "manual" });
    assert.equal(login.status, 302);
    assert.match(login.headers.get("location"), /^https:\/\/identity\.example\/authorize/u);
    const flowCookie = cookieFrom(login, "calendar_auth_flow");
    assert.ok(flowCookie);

    const callback = await fetch(`${origin}/calendar-api/auth/callback/example?code=abc&state=state-1`, {
      redirect: "manual",
      headers: { cookie: flowCookie },
    });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), `${appOrigin}/calendar/`);
    const sessionCookie = cookieFrom(callback, "calendar_session");
    assert.ok(sessionCookie);

    const document = createCalendarDocument([{
      id: "node-integration-task",
      kind: "task",
      title: "Local HTTP sync",
      notes: "",
      state: "open",
      tags: [],
      attachments: [{ id: "node-attachment", name: "note.txt", type: "text/plain", size: 5 }],
    }]);
    const sync = await fetch(`${origin}/calendar-api/sync`, {
      method: "POST",
      headers: {
        origin: appOrigin,
        cookie: sessionCookie,
        "content-type": AUTOMERGE_MEDIA_TYPE,
      },
      body: saveCalendarDocument(document),
    });
    assert.equal(sync.status, 200);
    assert.equal(sync.headers.get("access-control-allow-origin"), appOrigin);
    const merged = loadCalendarDocument(new Uint8Array(await sync.arrayBuffer()));
    assert.equal(materializeItem(merged, "node-integration-task").title, "Local HTTP sync");

    const attachmentUrl = `${origin}/calendar-api/attachments/node-attachment`;
    const upload = await fetch(attachmentUrl, {
      method: "PUT",
      headers: {
        origin: appOrigin,
        cookie: sessionCookie,
        "content-type": "text/plain",
      },
      body: "hello",
    });
    assert.equal(upload.status, 204);

    const attachment = await fetch(attachmentUrl, {
      headers: { origin: appOrigin, cookie: sessionCookie },
    });
    assert.equal(attachment.status, 200);
    assert.equal(attachment.headers.get("content-type"), "text/plain");
    assert.equal(await attachment.text(), "hello");
  } finally {
    await close(server);
  }
});
