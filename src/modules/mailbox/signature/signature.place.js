"use strict";
/**
 * Where a signature goes in a message (mailbox.md §3 step 9), PURE: after the person's words and
 * above the mail they quote, otherwise at the end, in the HTML and in the text part alike.
 *
 * The quote is the composer's own: a "On <when>, <who> wrote:" paragraph directly over a
 * blockquote (Reply and Forward write it, at the end of the body). When the person wrote below
 * the quote instead of above it, their words end the message and the signature follows them.
 */
const { textOf } = require("../compose");

/** The composer's line over a quote, as it reads once the body is sanitised. */
const INTRO = /<p>On [^<]*? wrote:<\/p>\s*(?=<blockquote>)/g;
const blockquotes = () => /<(\/?)blockquote\b[^>]*>/gi;

/** How many quotes deep a position in the HTML is. */
function depthAt(html, index) {
  let depth = 0;
  for (const t of html.slice(0, index).matchAll(blockquotes())) depth += t[1] ? -1 : 1;
  return depth;
}

/**
 * The composer's quote: the last intro outside every quote (a reply to a reply carries older
 * intros inside its quote), from the intro to the end of its blockquote.
 */
function quoteIn(html) {
  let last = null;
  for (const m of html.matchAll(INTRO)) if (depthAt(html, m.index) === 0) last = m;
  if (!last) return null;
  const tags = blockquotes();
  tags.lastIndex = last.index + last[0].length;
  let depth = 0;
  let t;
  while ((t = tags.exec(html))) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return { start: last.index, end: tags.lastIndex };
  }
  return { start: last.index, end: html.length };
}

/** The signature with room above it, as a row Outlook's engine spaces too. */
const spaced = (html) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse"><tr><td style="padding:20px 0 0 0">${html}</td></tr></table>`;

const joinText = (...parts) => parts.filter((p) => p && p.trim()).join("\n\n");

/**
 * @param {string} bodyHtml  the composer's HTML, already made safe (compose.js outgoingHtml)
 * @param {{html: string, text: string}|null} signature
 * @returns {{html: string, text: string}}
 */
function place(bodyHtml, signature) {
  const body = String(bodyHtml || "");
  if (!signature || !signature.html) return { html: body, text: textOf(body) };
  // A blank line sets it apart in the text part; no "-- " line, which the dash rule keeps out of copy.
  const sigText = signature.text || "";
  const q = quoteIn(body);
  if (q && !textOf(body.slice(q.end))) {
    const before = body.slice(0, q.start);
    const quoted = body.slice(q.start);
    return {
      html: `${before}${spaced(signature.html)}${quoted}`,
      text: joinText(textOf(before), sigText, textOf(quoted)),
    };
  }
  return { html: `${body}${spaced(signature.html)}`, text: joinText(textOf(body), sigText) };
}

module.exports = { place, quoteIn };
