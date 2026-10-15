"use strict";
/**
 * The one Markdown renderer (BACKEND_STRUCTURE §5.5). The same HTML feeds the web
 * view and the PDF, so what a candidate reads on screen is what they sign (M5).
 *
 *   markdownToHtml("**Start date:** 3 November 2026")  → "<p><strong>Start date:</strong> 3 November 2026</p>"
 *
 * Markdown here is written by people in Settings (letter templates, offer text,
 * knowledge articles) and by the AI drafting an offer, and it is shown to others,
 * including strangers on the public site. So it is a WHITELIST, not a parser that
 * passes things through: every line is HTML-escaped first, then a small set of
 * forms is applied to the escaped text. No raw tag can survive, whatever the input.
 *
 *   blocks   # to #### headings, - or * bullets, 1. numbered lists, --- rules,
 *            | pipe | tables |, blank-line paragraphs
 *   inline   **bold**, *italic*, `code`, [links](https://...)
 *
 * Links are kept only for http, https, mailto and app-relative paths, and open with
 * rel="noopener noreferrer"; any other link keeps its text and loses its target.
 * Images are never rendered (their alt text is): a template must not load anything
 * from the internet into a PDF or a page.
 */

const esc = (s) =>
  String(s === null || s === undefined ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?!\/))/i;

/** Inline forms, on ALREADY-escaped text. */
function inline(escaped) {
  return escaped
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) =>
      SAFE_HREF.test(href)
        ? `<a href="${href}" rel="noopener noreferrer">${text}</a>`
        : text,
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+\.\s+/;
const TABLE_ROW = /^\|(.+)\|\s*$/;
const TABLE_RULE = /^\|[\s:|-]+\|\s*$/;

/** Markdown to safe HTML. */
function markdownToHtml(md) {
  const lines = String(md || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const out = [];
  const para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(esc(para.join(" ")))}</p>`);
    para.length = 0;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd();

    if (!line.trim()) {
      flush();
      i += 1;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flush();
      out.push("<hr />");
      i += 1;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push(
        `<h${h[1].length}>${inline(esc(h[2].trim()))}</h${h[1].length}>`,
      );
      i += 1;
      continue;
    }
    if (TABLE_ROW.test(line) && TABLE_RULE.test((lines[i + 1] || "").trim())) {
      flush();
      const cells = (r) =>
        r
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const header = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && TABLE_ROW.test(lines[i].trim())) {
        body.push(cells(lines[i].trim()));
        i += 1;
      }
      const thead = `<tr>${header.map((c) => `<th>${inline(esc(c))}</th>`).join("")}</tr>`;
      const tbody = body
        .map(
          (r) =>
            `<tr>${r.map((c) => `<td>${inline(esc(c))}</td>`).join("")}</tr>`,
        )
        .join("");
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      flush();
      const re = BULLET.test(line) ? BULLET : NUMBERED;
      const tag = re === BULLET ? "ul" : "ol";
      const items = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(`<li>${inline(esc(lines[i].replace(re, "").trim()))}</li>`);
        i += 1;
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    para.push(line.trim());
    i += 1;
  }
  flush();
  return out.join("\n");
}

/**
 * Drop a trailing "Accepted and agreed" or signature block from a drafted letter.
 * The document appends ONE formal execution block itself (M5), so a block the
 * author or the AI added at the end would leave a person two places to sign. The
 * marker has to stand on its own line, so body copy such as "To accept, please
 * sign below" is untouched. Everything from the first marker to the end goes.
 */
function stripTrailingAcceptanceBlock(md) {
  if (!md) return md;
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const isMarker = (raw) => {
    const s = raw
      .trim()
      .replace(/[*_`>#\s]+$/g, "")
      .replace(/^[*_`>#\s]+/g, "");
    return (
      Boolean(s) &&
      /^(accepted\s*(?:and|&|and\/or)?\s*agreed\b|acknowledged\s+and\s+accepted\b|signed\s+by\s+the\s+candidate\b|candidate\s+signature\b|signature\s*:?\s*$|\bsign\s+here\b)/i.test(
        s,
      )
    );
  };
  let cut = lines.findIndex(isMarker);
  if (cut === -1) return md;
  while (cut > 0 && !lines[cut - 1].trim()) cut -= 1;
  return lines.slice(0, cut).join("\n").trimEnd();
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

module.exports = {
  markdownToHtml,
  markdownToText,
  stripTrailingAcceptanceBlock,
  escapeHtml: esc,
};
