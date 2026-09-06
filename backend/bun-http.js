// Reconstruct the public origin explicitly: the SSH tunnel terminates HTTPS
// and forwards HTTP, and OAuth validates the complete callback URL.
export function createBunHttpServer({ handleRequest, publicBaseUrl, hostname = "127.0.0.1", port = 8787 }) {
  const publicOrigin = new URL(publicBaseUrl).origin;
  return Bun.serve({
    hostname,
    port,
    async fetch(request) {
      const incoming = new URL(request.url);
      const url = new URL(publicOrigin);
      url.pathname = incoming.pathname;
      url.search = incoming.search;
      return handleRequest(new Request(url, request));
    },
    error(error) {
      console.error("Calendar backend request failed", error);
      return new Response("Internal server error", { status: 500 });
    },
  });
}
