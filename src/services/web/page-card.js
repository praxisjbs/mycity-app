"use strict";
/**
 * A web page's card: what the page says about itself, and its picture, read through
 * public-fetch only (docs/guides/community.md §3 step 18, §6).
 *
 *   const card = await pageCard.fetchCard("https://nfelia.com/");
 *   // { status: "ready", url, title, description, site_name, image: { buffer, name } | null }
 *   // { status: "empty" }             the page offers no title
 *   // { status: "failed", reason }    it could not be read: refused, too slow, not a page
 *
 * Read in this order, the first that is there winning: Open Graph (`og:title`,
 * `og:description`, `og:site_name`, `og:image`), then Twitter's (`twitter:title`, ...), then the
 * page's own `<title>` and `<meta name="description">`; the site falls back to the host. Only
 * the page's head is read, at most 1 MB of it, and its text is decoded in its own charset.
 * The picture is fetched as a photo (at most 5 MB); the vault decides whether it is one.
 */
const { Parser } = require("htmlparser2");
const publicFetch = require("./public-fetch");

const PAGE_MAX_BYTES = 1024 * 1024;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const LIMITS = Object.freeze({ title: 200, description: 300, site_name: 80 });
const PAGE_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const IMAGE_EXT = Object.freeze({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" });

/** One line of at most `max` characters, or null when there is nothing in it. */
function clean(text, max) {
  if (text === null || text === undefined) return null;
  const s = String(text).replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** An address on the page made whole against the page's own, or null for anything but http and https. */
function absolute(src, base) {
  if (!src) return null;
  try {
    const u = new URL(String(src).trim(), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The page's text in its own charset: the header's, else the page's meta, else UTF-8. */
function decodeHtml(buffer, contentType = "") {
  let charset = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = buffer.subarray(0, 4096).toString("latin1");
    charset = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

/**
 * What a page's head says about it.
 * @param {string} html
 * @param {string} pageUrl  where the page was read from, after redirects
 * @returns {{title: string|null, description: string|null, site_name: string, image_url: string|null}}
 */
function parseCard(html, pageUrl) {
  const meta = new Map();
  let title = "";
  let inTitle = false;
  let done = false;
  let imageSrc = null;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (done) return;
        if (name === "body") {
          done = true;
          return;
        }
        if (name === "title") inTitle = true;
        if (name === "meta") {
          const key = String(attrs.property || attrs.name || attrs.itemprop || "").trim().toLowerCase();
          if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
        }
        if (name === "link" && attrs.href && !imageSrc) {
          const rel = String(attrs.rel || "").toLowerCase().split(/\s+/);
          if (rel.includes("image_src")) imageSrc = attrs.href;
        }
      },
      ontext(text) {
        if (inTitle && !done) title += text;
      },
      onclosetag(name) {
        if (name === "title") inTitle = false;
        if (name === "head") done = true;
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();

  const pick = (...keys) => {
    for (const k of keys) {
      const v = meta.get(k);
      if (v !== undefined && String(v).trim()) return v;
    }
    return null;
  };
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  return {
    title: clean(pick("og:title", "twitter:title") ?? title, LIMITS.title),
    description: clean(pick("og:description", "twitter:description", "description"), LIMITS.description),
    site_name: clean(pick("og:site_name", "application-name"), LIMITS.site_name) ?? host,
    image_url: absolute(
      pick("og:image:secure_url", "og:image:url", "og:image", "twitter:image", "twitter:image:src") ?? imageSrc,
      pageUrl,
    ),
  };
}

/**
 * Read a page's card from the public web.
 * @param {string} url  an address in links.normalise() form
 * @param {{fetcher?: {get: Function}}} [deps]  a test's own fetcher
 */
async function fetchCard(url, { fetcher = publicFetch } = {}) {
  let page;
  try {
    page = await fetcher.get(url, {
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      maxBytes: PAGE_MAX_BYTES,
      truncate: true,
      timeoutMs: TIMEOUT_MS,
    });
  } catch (err) {
    return { status: "failed", reason: err.code || "NETWORK" };
  }
  if (!PAGE_TYPES.has(page.type)) return { status: "failed", reason: "NOT_A_PAGE" };
  const card = parseCard(decodeHtml(page.body, page.contentType), page.url);
  if (!card.title) return { status: "empty" };

  let image = null;
  if (card.image_url) {
    try {
      const pic = await fetcher.get(card.image_url, {
        accept: "image/webp,image/png,image/jpeg,image/gif;q=0.8",
        maxBytes: IMAGE_MAX_BYTES,
        timeoutMs: TIMEOUT_MS,
      });
      if (IMAGE_EXT[pic.type]) image = { buffer: pic.body, name: `preview.${IMAGE_EXT[pic.type]}` };
    } catch {
      image = null;
    }
  }
  return {
    status: "ready",
    url: page.url,
    title: card.title,
    description: card.description,
    site_name: card.site_name,
    image,
  };
}

module.exports = { LIMITS, PAGE_MAX_BYTES, IMAGE_MAX_BYTES, clean, decodeHtml, parseCard, fetchCard };
