// One-time local identity discovery using the same validated OIDC flow as auth.
// It has no sync routes, creates no application sessions, and prints no tokens.
import { beginOidcLogin, finishOidcLogin } from "../auth/oidc.js";

const values = {};
for (const line of (await Bun.file(".local/backend.env").text()).split(/\r?\n/u)) {
  if (!line.trim() || line.trimStart().startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) throw new Error("Use KEY=value lines in .local/backend.env.");
  values[line.slice(0, separator).trim()] = line.slice(separator + 1);
}
for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) {
  if (!values[name] || values[name].includes("REPLACE")) throw new Error(`Set ${name} in .local/backend.env first.`);
}
const provider = {
  id: "google",
  issuer: "https://accounts.google.com",
  clientId: values.GOOGLE_CLIENT_ID,
  clientSecret: values.GOOGLE_CLIENT_SECRET,
  scopes: ["email", "profile"],
  authorizationParams: { prompt: "select_account" },
};
const callback = "http://localhost:8877/auth/callback/google";
const { authorizationUrl, transaction } = await beginOidcLogin(provider, callback);
let used = false;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 8877,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/auth/callback/google") return new Response("Not found", { status: 404 });
    if (used || url.searchParams.get("state") !== transaction.state) return new Response("Invalid or used login state", { status: 400 });
    used = true;
    try {
      const identity = await finishOidcLogin(provider, `${callback}${url.search}`, transaction);
      console.log(`Verified Google account: ${identity.email || identity.name || "(no display name)"}`);
      console.log(`ALLOWED_GOOGLE_SUBJECT=${identity.subject}`);
      return new Response("Account verified. Copy ALLOWED_GOOGLE_SUBJECT from the terminal into .local/backend.env. You can close this tab.", {
        headers: { "content-type": "text/plain", "cache-control": "no-store", "referrer-policy": "no-referrer" },
      });
    } catch {
      console.error("Google sign-in failed. Check the client credentials and registered callback, then run this helper again.");
      process.exitCode = 1;
      return new Response("Sign-in failed. See the terminal.", { status: 400 });
    } finally {
      clearTimeout(timeout);
      setTimeout(() => server.stop(false), 100);
    }
  },
});
const timeout = setTimeout(() => {
  console.error("Identity setup expired after 10 minutes. Run the helper again.");
  server.stop(true);
  process.exitCode = 1;
}, 10 * 60 * 1000);
console.log(`Register this additional redirect URI in the same Google Web application client: ${callback}`);
console.log(`Then open this URL on this computer:\n${authorizationUrl}`);
