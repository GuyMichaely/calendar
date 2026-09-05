import { createServer } from "node:http";

const DEFAULT_MAX_REQUEST_BYTES = 6 * 1024 * 1024;

async function readNodeBody(request, maxBytes) {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maxBytes) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    chunks.push(bytes);
  }
  return chunks.length ? Buffer.concat(chunks, total) : null;
}

export async function nodeRequestToWebRequest(request, publicBaseUrl, { maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES } = {}) {
  const url = new URL(request.url || "/", publicBaseUrl);
  const body = await readNodeBody(request, maxRequestBytes);
  const init = {
    method: request.method || "GET",
    headers: request.headers,
  };
  if (body) init.body = body;
  return new Request(url, init);
}

function responseCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

export async function writeWebResponse(nodeResponse, response) {
  nodeResponse.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") nodeResponse.setHeader(name, value);
  });
  const cookies = responseCookies(response.headers);
  if (cookies.length) nodeResponse.setHeader("set-cookie", cookies);
  if (response.body == null) {
    nodeResponse.end();
    return;
  }
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}

export function createNodeHttpServer({ handleRequest, publicBaseUrl, maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES }) {
  if (typeof handleRequest !== "function") throw new Error("Node HTTP adapter requires handleRequest(request).");
  const baseUrl = new URL(publicBaseUrl).href;
  return createServer(async (request, response) => {
    try {
      const webRequest = await nodeRequestToWebRequest(request, baseUrl, { maxRequestBytes });
      await writeWebResponse(response, await handleRequest(webRequest));
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (status >= 500) console.error("Calendar development server request failed", error);
      response.statusCode = status;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(status === 413 ? "Request body is too large" : "Internal server error");
    }
  });
}
