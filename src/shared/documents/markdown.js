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

/* ------------------------------------------------------------------ *
 * The same grammar as blocks, for a screen that draws text itself
 * ------------------------------------------------------------------ */

const SPAN_RE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

/** A line's text as runs with their marks: links (safe targets only), **bold**, *italic*. */
function spansOf(raw) {
  const textOf = String(raw || "");
  const spans = [];
  const push = (text, marks = {}) => {
    if (text) spans.push({ text, bold: Boolean(marks.bold), italic: Boolean(marks.italic), href: marks.href || null });
  };
  let at = 0;
  for (const m of textOf.matchAll(SPAN_RE)) {
    push(textOf.slice(at, m.index));
    if (m[1] !== undefined) push(m[1], { href: SAFE_HREF.test(m[2]) ? m[2] : null });
    else if (m[3] !== undefined) push(m[3], { bold: true });
    else push(m[4], { italic: true });
    at = m.index + m[0].length;
  }
  push(textOf.slice(at));
  return spans;
}

/**
 * Markdown to blocks (contract policies.RichTextBlock): the forms markdownToHtml draws, for a
 * screen that renders text as elements rather than HTML. A table's rows become paragraphs, its cells
 * joined; a rule is dropped.
 */
function markdownToBlocks(md) {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const para = [];
  const flush = () => {
    if (para.length) out.push({ kind: "paragraph", spans: spansOf(para.join(" ")) });
    para.length = 0;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd();
    if (!line.trim() || /^---+$/.test(line.trim()) || TABLE_RULE.test(line.trim())) {
      flush();
      i += 1;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push({ kind: "heading", level: Math.max(2, h[1].length), spans: spansOf(h[2].trim()) });
      i += 1;
      continue;
    }
    if (TABLE_ROW.test(line)) {
      flush();
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean);
      out.push({ kind: "paragraph", spans: spansOf(cells.join(" · ")) });
      i += 1;
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      flush();
      const re = BULLET.test(line) ? BULLET : NUMBERED;
      const items = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(spansOf(lines[i].replace(re, "").trim()));
        i += 1;
      }
      out.push({ kind: re === BULLET ? "bullets" : "numbered", items });
      continue;
    }
    para.push(line.trim());
    i += 1;
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ *
 * HTML from an editor (or pasted from Word or Google Docs) to Markdown
 * ------------------------------------------------------------------ */

/** A line that would read as a Markdown form, kept as text by a zero-width space in front. */
const LOOKS_LIKE_FORM = /^(#|[-*]\s|\d+\.\s|\||---)/;
const BLOCK_TAGS = new Set(["p", "div", "section", "article", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "pre", "figure", "header", "footer"]);
const SKIP_TAGS = new Set(["script", "style", "head", "title", "noscript", "template", "svg", "math", "iframe", "object"]);

/**
 * HTML to the Markdown markdownToHtml reads, keeping only headings (h1 and h2 as ##, h3 as ###,
 * h4 to h6 as ####), paragraphs, bullet and numbered lists (nested lists flattened), **bold**,
 * *italic* and links with a safe target; everything else becomes its text (a table's cells joined
 * on one line, an image dropped). Nothing from the input reaches the output as markup, so the result
 * is safe whatever was pasted.
 */
function htmlToMarkdown(html) {
  const { Parser } = require("htmlparser2");
  const blocks = [];
  let buf = "";
  let kind = "p";
  const lists = [];
  let listCount = 0;
  let skip = 0;
  const marks = [];
  let link = null;
  const end = () => {
    const text = buf.replace(/\s+/g, " ").trim();
    buf = "";
    if (!text) return;
    if (kind === "li") {
      const list = lists[lists.length - 1];
      const marker = list && list.tag === "ol" ? `${(list.n += 1)}.` : "-";
      // Items of one list (nested ones flattened into it) sit together; the next list starts apart.
      blocks.push({ list: lists.length ? lists[0].serial : 0, text: `${marker} ${text}` });
    } else if (/^h[1-6]$/.test(kind)) {
      const level = Math.min(4, Math.max(2, Number(kind[1])));
      blocks.push({ text: `${"#".repeat(level)} ${text}` });
    } else blocks.push({ text: LOOKS_LIKE_FORM.test(text) ? `\u200b${text}` : text });
  };
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (SKIP_TAGS.has(name)) skip += 1;
        if (skip) return;
        if (name === "ul" || name === "ol") {
          end();
          lists.push({ tag: name, n: 0, serial: lists.length ? lists[0].serial : (listCount += 1) });
          return;
        }
        if (BLOCK_TAGS.has(name)) {
          end();
          kind = name === "li" ? "li" : /^h[1-6]$/.test(name) ? name : "p";
          return;
        }
        if (name === "br") buf += " ";
        else if (name === "td" || name === "th") buf += buf.trim() ? " · " : "";
        else if (name === "strong" || name === "b") {
          marks.push("**");
          buf += "**";
        } else if (name === "em" || name === "i") {
          marks.push("*");
          buf += "*";
        } else if (name === "a" && attrs.href && SAFE_HREF.test(attrs.href.trim())) {
          link = { href: attrs.href.trim(), start: buf.length };
        }
      },
      ontext(t) {
        if (!skip) buf += t.replace(/\*/g, "\u2217");
      },
      onclosetag(name) {
        if (SKIP_TAGS.has(name)) {
          skip = Math.max(0, skip - 1);
          return;
        }
        if (skip) return;
        if (name === "ul" || name === "ol") {
          end();
          lists.pop();
          kind = lists.length ? "li" : "p";
        } else if (BLOCK_TAGS.has(name)) {
          end();
          kind = lists.length ? "li" : "p";
        } else if ((name === "strong" || name === "b" || name === "em" || name === "i") && marks.length) {
          const mark = marks.pop();
          // An empty pair of marks says nothing; drop it rather than leave stray asterisks.
          buf = buf.endsWith(mark) ? buf.slice(0, -mark.length) : `${buf}${mark}`;
        } else if (name === "a" && link) {
          const label = buf.slice(link.start).trim();
          buf = label ? `${buf.slice(0, link.start)}[${label}](${link.href})` : buf.slice(0, link.start);
          link = null;
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(String(html || ""));
  parser.end();
  end();
  const out = [];
  blocks.forEach((b, i) => {
    if (i > 0 && !(b.list && b.list === blocks[i - 1].list)) out.push("");
    out.push(b.text);
  });
  return out.join("\n").trim();
}

module.exports = {
  markdownToBlocks,
  htmlToMarkdown,
  markdownToHtml,
  markdownToText,
  stripTrailingAcceptanceBlock,
  escapeHtml: esc,
};
