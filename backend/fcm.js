// Firebase Cloud Messaging (the HTTP v1 API), signed in as the Firebase project's service account:
// a JWT signed with its key is exchanged for an hour's access token.
const encoder = new TextEncoder();
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");

async function accessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64url(encoder.encode(JSON.stringify({
    iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })));
  const der = Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/gu, "")), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(`${header}.${claims}`));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${base64url(signature)}` }),
  });
  if (!response.ok) throw new Error(`Could not sign in to Firebase (${response.status}): ${(await response.text()).slice(0, 200)}`);
  return (await response.json()).access_token;
}

/** `serviceAccount` is the Firebase service account's JSON key. */
export function createFcm(serviceAccount) {
  const account = JSON.parse(serviceAccount);
  let cached = null;
  return {
    /** Sends a data message; resolves to "sent", or "gone" when the device's token no longer exists. */
    async send(token, data, { collapseKey } = {}) {
      if (!cached || cached.expires < Date.now()) cached = { value: await accessToken(account), expires: Date.now() + 50 * 60_000 };
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: "POST",
        headers: { authorization: `Bearer ${cached.value}`, "content-type": "application/json" },
        // Normal priority: delivered at once while the phone's awake, in its next window when dozing.
        body: JSON.stringify({ message: { token, data, android: { priority: "normal", ttl: "86400s", ...(collapseKey ? { collapse_key: collapseKey } : {}) } } }),
      });
      if (response.ok) return "sent";
      const detail = await response.text();
      if (response.status === 404 || /UNREGISTERED|registration token/iu.test(detail)) return "gone";
      throw new Error(`FCM refused a message (${response.status}): ${detail.slice(0, 200)}`);
    },
  };
}
