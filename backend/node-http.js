import { createServer } from "node:http";
import { Readable } from "node:stream";

function appendIncomingHeaders(target, source) {
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const entry of value) target.append(name, entry);
    } else if (value != null) {
      target.append(name, value);
    }
  }
}

function requestUrl(request, publicBaseUrl) {
  return new URL(request.url || "/", new URL(publicBaseUrl)).href;
}

function nodeRequestToFetchRequest(request, publicBaseUrl) {
  const headers = new Headers();
  appendIncomingHeaders(headers, request.headers);
  const method = request.method || "GET";
  const init = { method, headers };

  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }

  return new Request(requestUrl(request, publicBaseUrl), init);
}

function writeFetchHeaders(response, outgoing) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];

  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === "set-cookie") continue;
    outgoing.setHeader(name, value);
  }

  if (setCookies.length) {
    outgoing.setHeader("set-cookie", setCookies);
  } else {
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) outgoing.setHeader("set-cookie", setCookie);
  }
}

async function writeFetchResponse(response, outgoing) {
  outgoing.statusCode = response.status;
  writeFetchHeaders(response, outgoing);

  if (!response.body) {
    outgoing.end();
    return;
  }

  const body = Readable.fromWeb(response.body);
  body.on("error", (error) => outgoing.destroy(error));
  body.pipe(outgoing);
}

export function createNodeHttpServer({ handleRequest, publicBaseUrl }) {
  if (typeof handleRequest !== "function") throw new Error("Node HTTP server requires a request handler.");
  if (!publicBaseUrl) throw new Error("Node HTTP server requires a public base URL.");

  return createServer(async (incoming, outgoing) => {
    try {
      const request = nodeRequestToFetchRequest(incoming, publicBaseUrl);
      const response = await handleRequest(request);
      if (!(response instanceof Response)) throw new Error("Calendar request handler must return a Response.");
      await writeFetchResponse(response, outgoing);
    } catch (error) {
      console.error("Calendar backend request failed", error);
      if (!outgoing.headersSent) {
        outgoing.statusCode = 500;
        outgoing.setHeader("content-type", "text/plain; charset=utf-8");
      }
      if (!outgoing.writableEnded) outgoing.end("Internal server error");
    }
  });
}
