import { test, afterEach } from 'bun:test';
import assert from 'node:assert/strict';
import { createWebPush, generateVapidKeys, encrypt, MAX_PLAINTEXT } from '../backend/web-push.js';
const encoder = new TextEncoder(), decoder = new TextDecoder();
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const unb64 = text => new Uint8Array(Buffer.from(text, 'base64url'));
const concat = (...parts) => new Uint8Array(parts.flatMap(part => [...part]));
const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bytes * 8));

/** A browser's side: a push subscription's key pair and auth secret, exported as PushSubscription.toJSON() gives them. */
async function browser(endpoint = 'https://push.example.net/wpush/v2/abc123') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const subscription = { endpoint, keys: { p256dh: b64(await crypto.subtle.exportKey('raw', pair.publicKey)), auth: b64(auth) } };
  return { subscription, privateKey: pair.privateKey };
}
/** The user agent's half of RFC 8291: decrypts an aes128gcm body with the subscription's private key. */
async function decrypt(body, { privateKey, subscription }) {
  const view = new DataView(body.buffer, body.byteOffset);
  const salt = body.slice(0, 16), rs = view.getUint32(16), idlen = body[20], asPublic = body.slice(21, 21 + idlen), ciphertext = body.slice(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65); assert.equal(asPublic[0], 4);
  assert.ok(ciphertext.length <= rs, 'a single record');
  const uaPublic = unb64(subscription.keys.p256dh);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, privateKey, 256));
  const ikm = await hkdf(unb64(subscription.keys.auth), shared, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ciphertext));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  assert.equal(padded[end], 2, 'the last record\'s padding delimiter');
  return padded.slice(0, end);
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
/** Replaces fetch with a push service answering `status`; returns the requests it got. */
function pushService(status = 201, text = '') {
  const requests = [];
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), ...init, body: new Uint8Array(init.body), headers: new Headers(init.headers) }); return new Response(text || null, { status }); };
  return requests;
}
const subject = 'mailto:push@example.com';

test('the payload arrives encrypted for the subscription, with the push headers', async () => {
  const vapid = { ...await generateVapidKeys(), subject };
  const ua = await browser();
  const requests = pushService();
  const payload = { type: 'reminder', id: 'evt-1', title: 'Dentist ✓ — שלום', at: '2026-10-06T09:00:00Z' };
  assert.equal(await createWebPush(vapid).send(ua.subscription, payload, { ttl: 600, urgency: 'normal', topic: 'evt-1' }), 'sent');
  const [request] = requests;
  assert.equal(request.url, ua.subscription.endpoint);
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.get('content-encoding'), 'aes128gcm');
  assert.equal(request.headers.get('content-type'), 'application/octet-stream');
  assert.equal(request.headers.get('ttl'), '600');
  assert.equal(request.headers.get('urgency'), 'normal');
  assert.equal(request.headers.get('topic'), 'evt-1');
  assert.deepEqual(JSON.parse(decoder.decode(await decrypt(request.body, ua))), payload);
});

test('defaults: an hour\'s TTL, high urgency, no topic; each message has its own salt and ephemeral key', async () => {
  const ua = await browser();
  const requests = pushService();
  const push = createWebPush({ ...await generateVapidKeys(), subject });
  await push.send(ua.subscription, { n: 1 });
  await push.send(ua.subscription, { n: 2 });
  assert.equal(requests[0].headers.get('ttl'), '3600');
  assert.equal(requests[0].headers.get('urgency'), 'high');
  assert.equal(requests[0].headers.has('topic'), false);
  assert.notDeepEqual(requests[0].body.slice(0, 16), requests[1].body.slice(0, 16));
  assert.notDeepEqual(requests[0].body.slice(21, 86), requests[1].body.slice(21, 86));
  assert.deepEqual(JSON.parse(decoder.decode(await decrypt(requests[1].body, ua))), { n: 2 });
});

test('VAPID: a valid ES256 JWT for the endpoint\'s origin, and the public key', async () => {
  const vapid = { ...await generateVapidKeys(), subject };
  assert.equal(unb64(vapid.publicKey).length, 65);
  assert.equal(unb64(vapid.privateKey).length, 32);
  const ua = await browser('https://fcm.googleapis.com:443/fcm/send/xyz?x=1');
  const requests = pushService();
  const before = Math.floor(Date.now() / 1000);
  await createWebPush(vapid).send(ua.subscription, { hi: true });
  const match = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/u.exec(requests[0].headers.get('authorization'));
  assert.ok(match, requests[0].headers.get('authorization'));
  const [, jwt, k] = match;
  assert.equal(k, vapid.publicKey);
  const [header, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(decoder.decode(unb64(header))), { typ: 'JWT', alg: 'ES256' });
  const { aud, exp, sub } = JSON.parse(decoder.decode(unb64(claims)));
  assert.equal(aud, 'https://fcm.googleapis.com');
  assert.equal(sub, subject);
  assert.ok(exp > before + 11 * 3600 && exp <= before + 12 * 3600 + 5, `exp ${exp}`);
  assert.equal(unb64(signature).length, 64, 'raw r || s');
  const key = await crypto.subtle.importKey('raw', unb64(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(signature), encoder.encode(`${header}.${claims}`)));
  const tampered = b64(encoder.encode(JSON.stringify({ aud, exp, sub: 'mailto:someone@else.example' })));
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(signature), encoder.encode(`${header}.${tampered}`)), false);
});

test('VAPID tokens are reused per audience', async () => {
  const push = createWebPush({ ...await generateVapidKeys(), subject });
  const requests = pushService();
  const [a1, a2, b] = await Promise.all(['https://a.example/1', 'https://a.example/2', 'https://b.example/1'].map(browser));
  for (const ua of [a1, a2, b]) await push.send(ua.subscription, {});
  const tokens = requests.map(request => request.headers.get('authorization'));
  assert.equal(tokens[0], tokens[1]);
  assert.notEqual(tokens[0], tokens[2]);
});

test('statuses: 201 sent, 404 and 410 gone, 429 and 5xx retry, anything else throws with the status and body', async () => {
  const push = createWebPush({ ...await generateVapidKeys(), subject });
  const { subscription } = await browser();
  for (const [status, expected] of [[201, 'sent'], [200, 'sent'], [404, 'gone'], [410, 'gone'], [429, 'retry'], [500, 'retry'], [503, 'retry']]) {
    pushService(status);
    assert.equal(await push.send(subscription, {}), expected, `status ${status}`);
  }
  for (const status of [400, 403, 413]) {
    pushService(status, `nope ${status} ${'x'.repeat(500)}`);
    await assert.rejects(push.send(subscription, {}), error => error.message.includes(`(${status})`) && error.message.includes(`nope ${status}`) && error.message.length < 300);
  }
});

test('payloads too big for a push service are refused before sending', async () => {
  const ua = await browser();
  const requests = pushService();
  const push = createWebPush({ ...await generateVapidKeys(), subject });
  const fits = 'x'.repeat(MAX_PLAINTEXT - 2); // JSON quotes
  await push.send(ua.subscription, fits);
  assert.equal(requests[0].body.length, 4096);
  assert.equal(JSON.parse(decoder.decode(await decrypt(requests[0].body, ua))), fits);
  await assert.rejects(push.send(ua.subscription, fits + 'x'), /at most 3993 bytes/u);
  assert.equal(requests.length, 1);
});

test('RFC 8291 Appendix A: the example\'s keys and salt give its exact message', async () => {
  const asPublic = unb64('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  const asPrivate = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
  const ephemeral = {
    publicKey: await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
    privateKey: await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: asPrivate, x: b64(asPublic.slice(1, 33)), y: b64(asPublic.slice(33)) }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
  };
  const keys = { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
  const body = await encrypt(keys, encoder.encode('When I grow up, I want to be a watermelon'), { salt: unb64('DGv6ra1nlYgDCS1FRnbzlw'), ephemeral });
  assert.equal(b64(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  // And the receiving side, with the example's user agent private key, reads it back.
  const uaPublic = unb64(keys.p256dh);
  const privateKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94', x: b64(uaPublic.slice(1, 33)), y: b64(uaPublic.slice(33)) }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  assert.equal(decoder.decode(await decrypt(body, { privateKey, subscription: { keys } })), 'When I grow up, I want to be a watermelon');
});

test('a push service that cannot be reached is retried', async () => {
  const push = createWebPush({ ...await generateVapidKeys(), subject });
  const { subscription } = await browser();
  globalThis.fetch = async () => { throw new TypeError('Network connection lost.'); };
  assert.equal(await push.send(subscription, {}), 'retry');
});
