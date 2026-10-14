"use strict";
/**
 * The one Markdown renderer (BACKEND_STRUCTURE §5.5). The same HTML feeds the web
 * view and the PDF, so what a candidate reads on screen is what they sign (M5).
 *
 *   markdownToHtml("**Start date:** 3 November 2026")  → "<p><strong>Start date:</strong> 3 November 2026</p>\n"
 *
 * Markdown here is written by people in Settings (letter templates, offer text,
 * knowledge articles) and is shown to others, including strangers on the public
 * site. So it is rendered as Markdown ONLY:
 *  - raw HTML in the source is shown as text, never passed through;
 *  - links are kept only for http, https, mailto and app-relative paths, and open
 *    with rel="noopener noreferrer";
 *  - images are not rendered (their alt text is): a template must not load anything
 *    from the internet into a PDF or a page.
 */
const { Marked } = require("marked");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?!\/))/i;

const marked = new Marked({
  gfm: true,
  breaks: false,
  async: false,
  renderer: {
    html(token) {
      return esc(token.text || token.raw || "");
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens);
      const href = String(token.href || "").trim();
      if (!SAFE_HREF.test(href)) return text;
      const title = token.title ? ` title="${esc(token.title)}"` : "";
      return `<a href="${esc(href)}"${title} rel="noopener noreferrer">${text}</a>`;
    },
    image(token) {
      return esc(token.text || "");
    },
  },
});

/** Markdown to safe HTML. */
function markdownToHtml(md) {
  return marked.parse(String(md || ""));
}

/** Markdown to plain text (the text part of an email). */
function markdownToText(md) {
  return String(md || "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = { markdownToHtml, markdownToText, escapeHtml: esc };
