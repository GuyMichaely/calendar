function normalizeOrigins(allowedOrigins) {
  return new Set((allowedOrigins || []).map((origin) => new URL(origin).origin));
}

function applyCors(response, origin) {
  if (!origin) return response;
  response.headers.set("access-control-allow-origin", origin);
  response.headers.set("access-control-allow-credentials", "true");
  const vary = response.headers.get("vary");
  response.headers.set("vary", vary ? `${vary}, Origin` : "Origin");
  return response;
}

export function createCalendarBackend({ authHandler, syncHandler, allowedOrigins = [] }) {
  if (typeof authHandler !== "function") throw new Error("Backend requires an auth handler.");
  if (typeof syncHandler !== "function") throw new Error("Backend requires a sync handler.");
  const origins = normalizeOrigins(allowedOrigins);

  return async function handleRequest(request) {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get("origin");
    const allowedOrigin = requestOrigin && origins.has(requestOrigin) ? requestOrigin : null;

    if (request.method === "OPTIONS") {
      if (!allowedOrigin) return new Response("Origin not allowed", { status: 403 });
      return applyCors(new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Content-Type",
          "access-control-max-age": "600",
        },
      }), allowedOrigin);
    }

    let response;
    if (url.pathname.startsWith("/auth/")) response = await authHandler(request);
    else if (url.pathname === "/sync") response = await syncHandler(request);
    else response = new Response("Not found", { status: 404 });

    return applyCors(response, allowedOrigin);
  };
}
