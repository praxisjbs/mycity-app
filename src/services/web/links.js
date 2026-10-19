"use strict";
/**
 * What counts as a link in a message, and the one form an address is kept in
 * (docs/guides/community.md §6). The app's composer finds links by the same rule
 * (packages/ui/src/lib/links.ts), so the card it shows is the card the message gets.
 *
 *   findLinks("see nfelia.com, or http://intranet.local:8080")
 *     // [{ text: "nfelia.com", href: "https://nfelia.com/", ... },
 *     //  { text: "http://intranet.local:8080", href: "http://intranet.local:8080/", ... }]
 *   firstLink("see https://nfelia.com/about, then www.mycityapp.io")  // "https://nfelia.com/about"
 *   firstLink("ask ada@nfelia.com")                                    // null: an email address
 *   normalise("Nfelia.com/About#top")                                  // "https://nfelia.com/About"
 *   normalise("http://intranet.local:8080")                            // null: no card off 80 and 443
 *
 * A link is an `http://` or `https://` address, a `www.` one, or a bare domain on a known
 * ending (nfelia.com, mycityapp.io, jumia.com.ng). Trailing punctuation that ends a sentence
 * is not part of it, and neither is a closing bracket the link did not open. Every link is
 * clickable; only the first one, in its normal form, may get a card.
 */

/** Endings a bare domain must have to count as a link without http:// or www. */
const ENDINGS = Object.freeze([
  "com", "org", "net", "ng", "io", "co", "app", "dev", "ai", "edu", "gov", "info", "biz",
  "me", "africa", "uk", "us", "tv", "xyz", "online", "site", "tech", "store", "news", "blog",
  "page", "live", "shop", "link",
]);

/** The longest address kept, as the database holds it. */
const MAX_URL = 2048;

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const TAIL = `[^\\s<>"'\`]*`;
/*
 * One alternation per form. The character before a match is captured instead of looked
 * behind for, so an email address (ada@nfelia.com) or a word glued to a domain is not a
 * link, on browsers too old for look-behind as well.
 */
const LINK_RE = new RegExp(
  `(^|[^\\w@.\\-/])(https?:\\/\\/[^\\s<>"'\`/]${TAIL}|www\\.[a-z0-9]${TAIL}|(?:${LABEL}\\.)+(?:${ENDINGS.join("|")})(?![a-z0-9-])(?:[/?#]${TAIL})?)`,
  "gi",
);

/** Sentence punctuation after a link, and a closing bracket the link did not open. */
function trimTail(raw) {
  let s = raw;
  for (;;) {
    const before = s;
    s = s.replace(/[.,;:!?'"*_]+$/, "");
    const last = s.slice(-1);
    const pairs = { ")": "(", "]": "[", "}": "{" };
    if (pairs[last]) {
      const open = s.split(pairs[last]).length - 1;
      const close = s.split(last).length - 1;
      if (close > open) s = s.slice(0, -1);
    }
    if (s === before) return s;
  }
}

/** A bracketed IPv6 host as the URL parser gives it, without its brackets. */
const bare = (host) => String(host || "").replace(/^\[|\]$/g, "");

/**
 * The form an address is fetched and kept in: https:// added when it has no scheme, the host
 * in lower case (and punycode), the fragment dropped. Null for anything that is not an http or
 * https address on the public web's ports: another scheme, a user name or password, a port
 * other than 80 or 443, a host with no dot, or more than 2,048 characters.
 * @param {string} raw
 * @returns {string|null}
 */
function normalise(raw) {
  let s = String(raw ?? "").trim();
  if (!s || s.length > MAX_URL) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return null;
    s = `https://${s}`;
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const host = bare(u.hostname);
  if (!host || (!host.includes(".") && !host.includes(":"))) return null;
  u.hash = "";
  const out = u.toString();
  return out.length > MAX_URL ? null : out;
}

/** Where a link written in text goes: https:// added when it has none; null when it is not http or https. */
function hrefOf(written) {
  const s = /^https?:\/\//i.test(written) ? written : `https://${written}`;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Every link in a text, in order: where it is, as written, and where it goes.
 * @param {string} text
 * @returns {Array<{start: number, end: number, text: string, href: string}>}
 */
function findLinks(text) {
  const s = String(text ?? "");
  const out = [];
  LINK_RE.lastIndex = 0;
  for (let m = LINK_RE.exec(s); m; m = LINK_RE.exec(s)) {
    const written = trimTail(m[2]);
    const href = hrefOf(written);
    if (href) {
      const start = m.index + m[1].length;
      out.push({ start, end: start + written.length, text: written, href });
    }
    if (m[0].length === 0) LINK_RE.lastIndex += 1;
  }
  return out;
}

/** The first link in a text, in its normal form, or null when there is none or it may not have a card. */
function firstLink(text) {
  const [link] = findLinks(text);
  return link ? normalise(link.href) : null;
}

module.exports = { ENDINGS, MAX_URL, normalise, findLinks, firstLink };
