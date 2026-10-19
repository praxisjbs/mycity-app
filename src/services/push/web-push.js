"use strict";
/**
 * Web push: one encrypted message to one browser, through the push service that browser
 * chose (RFC 8030, encrypted per RFC 8291 with aes128gcm, signed with the environment's
 * VAPID pair per RFC 8292). The one place the app talks to a push service.
 *
 *   const push = require("../../services/push/web-push");
 *   const out = await push.send(subscription, payload, { ttl, urgency, topic });
 *   // { ok: true, status }                       delivered to the push service
 *   // { ok: false, gone: true, status, error }   the subscription is dead: revoke it
 *   // { ok: false, retry: true, retryAfterMs }   try again later (429, 5xx, network)
 *   // { ok: false, status, error }               refused for good (bad request, too large)
 *
 * 404 and 410 mean the browser dropped the subscription. 401 and 403 mean it was made
 * under another VAPID key: revoked too, and the app subscribes again on its next start
 * with the current key (vapid.keyId). Nothing here throws on a refused push.
 */
const crypto = require("node:crypto");
const webpush = require("web-push");
const vapid = require("./vapid");

const TIMEOUT_MS = 10_000;
/** A push service refuses a topic longer than 32 URL-safe base64 characters. */
const TOPIC_RE = /^[A-Za-z0-9_-]{1,32}$/;

let transport = (subscription, body, options) => webpush.sendNotification(subscription, body, options);

/** A topic from any tag: a newer push with the same topic replaces one still queued. */
function topicOf(tag) {
  if (!tag) return undefined;
  const t = String(tag);
  return TOPIC_RE.test(t) ? t : crypto.createHash("sha256").update(t).digest("base64url").slice(0, 32);
}

function retryAfterMs(headers) {
  const v = headers && (headers["retry-after"] || headers["Retry-After"]);
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** What a failed send means for the subscription and for the job. */
function classify(err) {
  const status = err && Number.isInteger(err.statusCode) ? err.statusCode : null;
  const error = String((err && (err.body || err.message)) || "push failed").slice(0, 300);
  if (status === 404 || status === 410) return { ok: false, status, gone: true, error };
  if (status === 401 || status === 403) return { ok: false, status, gone: true, error };
  if (status === 429) return { ok: false, status, retry: true, retryAfterMs: retryAfterMs(err.headers), error };
  if (status === null || status >= 500) return { ok: false, status, retry: true, retryAfterMs: null, error };
  return { ok: false, status, error };
}

/**
 * Sends one payload to one subscription.
 * @param {{endpoint: string, p256dh: string, auth: string}} sub
 * @param {object} payload  the push payload (contract notifications.PushPayload)
 * @param {{ttl?: number, urgency?: "very-low"|"low"|"normal"|"high", topic?: string}} [opts]
 */
async function send(sub, payload, { ttl = 24 * 60 * 60, urgency = "normal", topic } = {}) {
  const k = await vapid.keys();
  try {
    const res = await transport(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      {
        TTL: ttl,
        urgency,
        topic: topicOf(topic),
        timeout: TIMEOUT_MS,
        contentEncoding: "aes128gcm",
        vapidDetails: { subject: k.subject, publicKey: k.publicKey, privateKey: k.privateKey },
      },
    );
    return { ok: true, status: res && res.statusCode ? res.statusCode : 201 };
  } catch (err) {
    return classify(err);
  }
}

/** Tests only: replace the network call; returns a function that puts the real one back. */
function useTransportForTest(fn) {
  const before = transport;
  transport = fn;
  return () => {
    transport = before;
  };
}

module.exports = { send, classify, topicOf, useTransportForTest };
