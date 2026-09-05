function normalizeOrigins(allowedOrigins) {
  return new Set((allowedOrigins || []).map((origin) => new URL(origin).origin));
}

function normalizeBasePath(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "/") return "";
  const prefixed = raw.startsWith("/") ? raw : `/${raw}`;
  return prefixed.replace(/\/+$/u, "");
}

function pathWithinBase(pathname, basePath) {
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (!pathname.startsWith(`${basePath}/`)) return null;
  return pathname.slice(basePath.length);
}

function applyCors(response, origin) {
  if (!origin) return response;
  response.headers.set("access-control-allow-origin", origin);
  response.headers.set("access-control-allow-credentials", "true");
  const vary = response.headers.get("vary");
  response.headers.set("vary", vary ? `${vary}, Origin` : "Origin");
  return response;
}

export function createCalendarBackend({ authHandler, syncHandler, attachmentHandler = null, allowedOrigins = [], basePath = "" }) {
  if (typeof authHandler !== "function") throw new Error("Backend requires an auth handler.");
  if (typeof syncHandler !== "function") throw new Error("Backend requires a sync handler.");
  if (attachmentHandler != null && typeof attachmentHandler !== "function") throw new Error("Backend attachment handler must be a function.");
  const origins = normalizeOrigins(allowedOrigins);
  const routeBasePath = normalizeBasePath(basePath);

  return async function handleRequest(request) {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get("origin");
    const allowedOrigin = requestOrigin && origins.has(requestOrigin) ? requestOrigin : null;

    // CORS response headers alone do not prevent a credentialed request from
    // reaching the server. Reject untrusted Origin values before auth/logout or
    // sync handlers can mutate server state.
    if (requestOrigin && !allowedOrigin) return new Response("Origin not allowed", { status: 403 });

    const path = pathWithinBase(url.pathname, routeBasePath);
    if (path == null) return applyCors(new Response("Not found", { status: 404 }), allowedOrigin);

    if (request.method === "OPTIONS") {
      if (!allowedOrigin) return new Response("Origin not allowed", { status: 403 });
      return applyCors(new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-methods": "GET, HEAD, POST, PUT, OPTIONS",
          "access-control-allow-headers": "Content-Type",
          "access-control-max-age": "600",
        },
      }), allowedOrigin);
    }

    let response;
    if (request.method === "GET" && path === "/healthz") response = new Response("ok");
    else if (path.startsWith("/auth/")) response = await authHandler(request);
    else if (path === "/sync") response = await syncHandler(request);
    else if (path.startsWith("/attachments/") && attachmentHandler) response = await attachmentHandler(request);
    else response = new Response("Not found", { status: 404 });

    return applyCors(response, allowedOrigin);
  };
}
