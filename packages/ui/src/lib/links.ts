/**
 * What counts as a link in a message (docs/guides/community.md §6). The server finds a
 * message's first link by the same rule (src/services/web/links.js), so the card the
 * composer shows is the card the message gets.
 *
 *   findLinks("see nfelia.com, or http://intranet.local:8080")
 *     // [{ text: "nfelia.com", href: "https://nfelia.com/", ... }, { text: "http://intranet.local:8080", ... }]
 *   firstLink("ask ada@nfelia.com")     // null: an email address
 *   firstLink("Nfelia.com/About#top")   // "https://nfelia.com/About"
 *
 * A link is an `http://` or `https://` address, a `www.` one, or a bare domain on a known
 * ending. Every link is clickable; only the first, on ports 80 and 443 with no user name or
 * password, may get a card.
 */

/** Endings a bare domain must have to count as a link without http:// or www. */
export const LINK_ENDINGS = [
  "com", "org", "net", "ng", "io", "co", "app", "dev", "ai", "edu", "gov", "info", "biz",
  "me", "africa", "uk", "us", "tv", "xyz", "online", "site", "tech", "store", "news", "blog",
  "page", "live", "shop", "link",
] as const;

const MAX_URL = 2048;
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const TAIL = `[^\\s<>"'\`]*`;
const LINK_RE = new RegExp(
  `(^|[^\\w@.\\-/])(https?:\\/\\/[^\\s<>"'\`/]${TAIL}|www\\.[a-z0-9]${TAIL}|(?:${LABEL}\\.)+(?:${LINK_ENDINGS.join("|")})(?![a-z0-9-])(?:[/?#]${TAIL})?)`,
  "gi",
);
const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** Sentence punctuation after a link, and a closing bracket the link did not open. */
function trimTail(raw: string): string {
  let s = raw;
  for (;;) {
    const before = s;
    s = s.replace(/[.,;:!?'"*_]+$/, "");
    const last = s.slice(-1);
    const open = PAIRS[last];
    if (open && s.split(last).length > s.split(open).length) s = s.slice(0, -1);
    if (s === before) return s;
  }
}

/** One link found in text: where it is, as written, and where it goes. */
export interface FoundLink {
  start: number;
  end: number;
  text: string;
  href: string;
}

function hrefOf(written: string): string | null {
  const s = /^https?:\/\//i.test(written) ? written : `https://${written}`;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Every link in a text, in order. */
export function findLinks(text: string): FoundLink[] {
  const s = String(text ?? "");
  const out: FoundLink[] = [];
  LINK_RE.lastIndex = 0;
  for (let m = LINK_RE.exec(s); m; m = LINK_RE.exec(s)) {
    const written = trimTail(m[2] ?? "");
    const href = hrefOf(written);
    if (href) {
      const start = m.index + (m[1] ?? "").length;
      out.push({ start, end: start + written.length, text: written, href });
    }
    if (m[0].length === 0) LINK_RE.lastIndex += 1;
  }
  return out;
}

/**
 * The form a link's card is asked for in: https:// added, the host in lower case, the
 * fragment dropped. Null when it may not have a card (another scheme, a user name or
 * password, a port other than 80 or 443, a host with no dot, more than 2,048 characters).
 */
export function normaliseLink(raw: string): string | null {
  let s = String(raw ?? "").trim();
  if (!s || s.length > MAX_URL) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return null;
    s = `https://${s}`;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || (!host.includes(".") && !host.includes(":"))) return null;
  u.hash = "";
  const out = u.toString();
  return out.length > MAX_URL ? null : out;
}

/** The first link in a text in its card form, or null when there is none or it may not have a card. */
export function firstLink(text: string): string | null {
  const [link] = findLinks(text);
  return link ? normaliseLink(link.href) : null;
}

/** The host a link goes to, without www., for a card's last line. */
export function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}
