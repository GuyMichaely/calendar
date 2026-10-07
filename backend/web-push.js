// Web Push to browsers' push subscriptions: the payload encrypted for the subscription (RFC 8291, aes128gcm of RFC 8188),
// the request signed as this application server (VAPID, RFC 8292). WebCrypto only.
const encoder = new TextEncoder();
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
const unbase64url = text => Uint8Array.from(atob(text.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(text.length / 4) * 4, "=")), char => char.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((offset, part) => (out.set(part, offset), offset + part.length), 0);
  return out;
};
const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits(
  { name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bytes * 8));
/** A P-256 private key from its raw scalar `d` and uncompressed public point, as WebCrypto only takes it whole (a JWK). */
const importPrivate = (publicKey, d, algorithm, usages) => crypto.subtle.importKey("jwk", {
  kty: "EC", crv: "P-256", d: base64url(d), x: base64url(publicKey.slice(1, 33)), y: base64url(publicKey.slice(33, 65)),
}, { name: algorithm, namedCurve: "P-256" }, false, usages);

const RECORD_SIZE = 4096;
// Push services take bodies up to 4096 bytes: the 86-byte header, the padding delimiter and the 16-byte tag leave this much.
export const MAX_PLAINTEXT = RECORD_SIZE - 86 - 1 - 16;

/** Encrypts `plaintext` (bytes) for a subscription's `keys` ({ p256dh, auth }, base64url) into an aes128gcm body.
 * `salt` and `ephemeral` (an ECDH CryptoKeyPair) are fresh per message; they're parameters only so tests can replay RFC 8291's example. */
export async function encrypt({ p256dh, auth }, plaintext, { salt = crypto.getRandomValues(new Uint8Array(16)), ephemeral } = {}) {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error(`A push payload can be at most ${MAX_PLAINTEXT} bytes; this one is ${plaintext.length}`);
  const uaPublic = unbase64url(p256dh);
  ephemeral ??= await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, ephemeral.privateKey, 256));
  const ikm = await hkdf(unbase64url(auth), shared, concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record, so it's the last: its padding delimiter is 2, with no padding after it.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, [2])));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

/** `vapid` is { publicKey, privateKey, subject }: the VAPID key pair as base64url (publicKey: the 65-byte uncompressed P-256 point;
 * privateKey: the 32-byte private scalar "d"), and a mailto:/https: contact. */
export function createWebPush(vapid) {
  let signingKey = null;
  const tokens = new Map(); // audience → { jwt, exp }
  async function token(audience) {
    const now = Math.floor(Date.now() / 1000);
    const cached = tokens.get(audience);
    if (cached && cached.exp - 3600 > now) return cached.jwt;
    signingKey ??= importPrivate(unbase64url(vapid.publicKey), unbase64url(vapid.privateKey), "ECDSA", ["sign"]);
    const exp = now + 12 * 3600;
    const unsigned = `${base64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })))}.${base64url(encoder.encode(JSON.stringify({ aud: audience, exp, sub: vapid.subject })))}`;
    // WebCrypto's ECDSA signature is already r || s, as JWS wants it.
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey, encoder.encode(unsigned));
    const jwt = `${unsigned}.${base64url(signature)}`;
    tokens.set(audience, { jwt, exp });
    return jwt;
  }
  return {
    /** Sends `payload` (an object, sent as JSON) to a browser's push subscription ({ endpoint, keys: { p256dh, auth } }, as PushSubscription.toJSON() gives).
     * Resolves to "sent", or "gone" when the subscription no longer exists. */
    async send(subscription, payload, { ttl = 3600, urgency = "high", topic } = {}) {
      const body = await encrypt(subscription.keys, encoder.encode(JSON.stringify(payload)));
      const response = await fetch(subscription.endpoint, {
        method: "POST",
        headers: {
          authorization: `vapid t=${await token(new URL(subscription.endpoint).origin)}, k=${vapid.publicKey}`,
          "content-encoding": "aes128gcm", "content-type": "application/octet-stream",
          ttl: String(ttl), urgency, ...(topic ? { topic } : {}),
        },
        body,
      });
      if (response.ok) return "sent";
      if (response.status === 404 || response.status === 410) return "gone";
      throw new Error(`The push service refused a message (${response.status}): ${(await response.text()).slice(0, 200)}`);
    },
  };
}

/** A new VAPID key pair, as createWebPush takes it (for setting up: run once, keep the private key as a secret). */
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { publicKey: base64url(await crypto.subtle.exportKey("raw", pair.publicKey)), privateKey: (await crypto.subtle.exportKey("jwk", pair.privateKey)).d };
}
