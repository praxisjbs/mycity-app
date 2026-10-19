"use strict";
/**
 * What a web push carries to the service worker (contract notifications.PushPayload,
 * version 1), kept under 3 KB: push services refuse a message over 4 KB, and encryption
 * adds to it. The title and line are cut first; nothing else is.
 *
 * Grouping on the device (docs/guides/notifications.md §6):
 *   tag   the conversation a notice belongs to: the event's own tag when its notification
 *         declares one (`push.tag`), else its record (`<entity_type>:<entity_id>`), else the
 *         notice itself (`n:<notification_id>`)
 *   mode  `alert`  a newer notice for the tag replaces the shown one and alerts again
 *         `quiet`  it replaces it silently until the person opens or dismisses it
 *         `single` it stands alone (a notice with no record)
 */
const MAX_BYTES = 3000;
const TITLE_MAX = 120;
const BODY_MAX = 600;

const cut = (s, max) => {
  const t = String(s || "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * The tag and mode of a notice.
 * @param {{notification_id: string, entity_type?: string|null, entity_id?: string|null}} row
 * @param {{tag?: string|null, mode?: string|null}|null} [style]  from the event's notification
 */
function styleOf(row, style) {
  const own = style && style.tag ? String(style.tag) : null;
  const record = row.entity_type && row.entity_id ? `${row.entity_type}:${row.entity_id}` : null;
  const tag = own || record || `n:${row.notification_id}`;
  const mode = style && style.mode ? style.mode : record || own ? "alert" : "single";
  return { tag, mode };
}

/**
 * The payload for one notice.
 * @param {{id: string|null, title: string, body?: string|null, path?: string|null, tag: string,
 *          mode: "alert"|"quiet"|"single", category: string, priority?: "normal"|"high",
 *          ts: string|Date, unread?: number, test?: boolean}} p
 */
function build(p) {
  const out = {
    v: 1,
    id: p.id || null,
    title: cut(p.title, TITLE_MAX) || "MyCity",
    body: cut(p.body, BODY_MAX),
    path: p.path || null,
    tag: String(p.tag),
    mode: p.mode,
    category: p.category || "system",
    priority: p.priority === "high" ? "high" : "normal",
    ts: new Date(p.ts || Date.now()).toISOString(),
    unread: Math.max(0, Number(p.unread) || 0),
    test: Boolean(p.test),
  };
  while (Buffer.byteLength(JSON.stringify(out)) > MAX_BYTES && out.body.length > 0) {
    out.body = cut(out.body, Math.floor(out.body.length * 0.8));
  }
  return out;
}

module.exports = { build, styleOf, MAX_BYTES };
