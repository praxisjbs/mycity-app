"use strict";
/**
 * What of an email's HTML may reach a screen (mailbox.md §6): sanitised on the server
 * before it is stored, so scripts never run and nothing calls home. The reader adds a
 * second pass and holds remote images back until asked (features/mailbox).
 *
 * Kept: the tags and inline styles mail layouts use (tables, fonts, colours), links
 * opening outside, images by https, cid or data. Dropped: scripts, frames, forms,
 * event handlers, javascript: and CSS expressions.
 */
const sanitize = require("sanitize-html");

const EXTRA_TAGS = ["img", "font", "center", "big", "tt", "strike", "del", "ins", "span", "div", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "col", "colgroup"];
const ATTRS = {
  "*": ["style", "dir", "lang", "title", "align", "valign", "width", "height", "bgcolor", "border"],
  a: ["href", "name", "target", "rel"],
  img: ["src", "alt", "width", "height", "border"],
  table: ["cellpadding", "cellspacing", "border", "role"],
  td: ["colspan", "rowspan", "nowrap"],
  th: ["colspan", "rowspan", "nowrap", "scope"],
  font: ["color", "face", "size"],
  ol: ["start", "type"],
  li: ["value"],
  blockquote: ["cite"],
};
const UNSAFE_CSS = /expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import|url\(\s*["']?\s*(javascript|vbscript|data:text\/html)/i;

function cleanStyle(style) {
  return String(style || "")
    .split(";")
    .filter((rule) => rule.trim() && !UNSAFE_CSS.test(rule))
    .join(";");
}

/** Sanitised HTML for the reader, or null when nothing visible is left. */
function cleanHtml(html) {
  if (!html) return null;
  const out = sanitize(String(html), {
    allowedTags: sanitize.defaults.allowedTags.concat(EXTRA_TAGS),
    allowedAttributes: ATTRS,
    allowedSchemes: ["http", "https", "mailto", "tel", "cid"],
    allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
    allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
    nonTextTags: ["style", "script", "textarea", "option", "noscript", "title", "xml", "object", "embed", "iframe", "template", "button"],
    transformTags: {
      a: (tag, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }),
      "*": (tag, attribs) => (attribs.style ? { tagName: tag, attribs: { ...attribs, style: cleanStyle(attribs.style) } } : { tagName: tag, attribs }),
    },
  });
  return out.replace(/<[^>]*>|&nbsp;|\s/g, "").length || /<img\b/i.test(out) ? out : null;
}

/** A plain text body as HTML paragraphs, for mail that has no HTML part. */
function textToHtml(text) {
  if (!text) return null;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return String(text)
    .split(/\r?\n\r?\n/)
    .map((p) => `<p>${esc(p).replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
}

module.exports = { cleanHtml, textToHtml, cleanStyle };
