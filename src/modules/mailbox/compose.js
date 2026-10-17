"use strict";
/**
 * What leaves: the composer's HTML made safe to send, and its plain text part
 * (mailbox.md §6). The composer's tools are a fixed set (bold, italic, underline,
 * strikethrough, heading, lists, quote, link, clear formatting), so the allow-list is
 * small; links are https or mailto only.
 */
const sanitize = require("sanitize-html");

const TAGS = ["p", "br", "strong", "b", "em", "i", "u", "s", "strike", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "a", "span", "div"];

function outgoingHtml(html) {
  return sanitize(String(html || ""), {
    allowedTags: TAGS,
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["https", "mailto"],
    transformTags: { a: (tag, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }) },
  });
}

/** The plain text part: paragraphs and line breaks kept, tags gone, entities decoded. */
function textOf(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = { outgoingHtml, textOf };
