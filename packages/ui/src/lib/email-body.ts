/**
 * What a mail reader hands EmailFrame: remote content held back, inline parts
 * resolved, and quoted history split off to be folded.
 *
 * Remote content is held back until the reader asks, or trusts the sender,
 * because an image fetched from the sender's server tells them when the mail
 * was opened, from which address and on what device, every time it is shown.
 * Held back: `src`, `srcset`, `poster` and `background` on any element, and any
 * `url()` in an inline style. `cid:`, `data:` and `blob:` are local and stay.
 * The frame's own policy refuses web images anyway; this pass is what makes the
 * count honest, so Load Images is offered whenever anything was held back.
 *
 * Quoted history is folded, never dropped: one tap shows it. A thread quotes
 * itself outside-in, so the first `<blockquote>` (or the "On … wrote:" /
 * "Le … a écrit :" line, or a trailing run of `>` lines) starts the history.
 *
 * Bodies are parsed into a `<template>`, which is inert (nothing in it is
 * fetched or run while it is read) and keeps table cells that a body-context
 * parse would drop. Never with patterns over the HTML.
 */

/** The attributes that make a browser fetch while it draws. */
const URL_ATTRS = ["src", "srcset", "poster", "background"] as const;

/** Elements and attributes nothing in a mail body needs; the server removes them too. */
const DROPPED = "script,style,iframe,frame,object,embed,form,link,meta,base";

const isRemote = (url: string): boolean => {
  const v = String(url || "").trim();
  return v !== "" && !/^(cid:|data:|blob:|#)/i.test(v);
};

/** A srcset descriptor (`2x`, `640w`); anything else in the list is a URL. */
const DESCRIPTOR = /^\d+(?:\.\d+)?[wx]$/i;

/**
 * The URLs in a srcset. Split on whitespace first (a URL holds none), then each
 * token on commas, except a `data:` URL, the one that legitimately holds a comma.
 */
function srcsetUrls(value: string): string[] {
  const urls: string[] = [];
  for (const token of value.split(/\s+/)) {
    const t = token.replace(/,+$/, "");
    if (!t || DESCRIPTOR.test(t)) continue;
    if (/^data:/i.test(t)) {
      urls.push(t);
      continue;
    }
    for (const piece of t.split(",")) if (piece && !DESCRIPTOR.test(piece)) urls.push(piece);
  }
  return urls;
}

function parse(html: string): { doc: Document; root: DocumentFragment } {
  const doc = new DOMParser().parseFromString("", "text/html");
  const tpl = doc.createElement("template");
  tpl.innerHTML = html;
  return { doc, root: tpl.content };
}

function serialize(doc: Document, root: Node): string {
  const box = doc.createElement("div");
  box.appendChild(root.cloneNode(true));
  return box.innerHTML;
}

/** Strip what never belongs in a body, then hold back remote fetches. Returns how many were held. */
function hold(root: DocumentFragment, showRemote: boolean): number {
  root.querySelectorAll(DROPPED).forEach((n) => n.remove());
  let held = 0;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name) || /^\s*(javascript|vbscript):/i.test(a.value)) el.removeAttribute(a.name);
    }
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
    if (showRemote) continue;
    for (const attr of URL_ATTRS) {
      const value = el.getAttribute(attr);
      if (value == null) continue;
      if (attr === "srcset" ? srcsetUrls(value).some(isRemote) : isRemote(value)) {
        el.removeAttribute(attr);
        held += 1;
      }
    }
    const style = el.getAttribute("style");
    if (style && /url\(/i.test(style)) {
      const cleaned = style.replace(/url\([^)]*\)/gi, (whole) => {
        if (!isRemote(whole.slice(4, -1).trim().replace(/^['"]|['"]$/g, ""))) return whole;
        held += 1;
        return "none";
      });
      if (cleaned !== style) el.setAttribute("style", cleaned);
    }
  }
  return held;
}

/** `cid:<Logo@x>` as the bare id the server stores, lower case for matching. */
const cidOf = (value: string) => value.trim().replace(/^cid:/i, "").replace(/^<|>$/g, "").toLowerCase();

/** The content ids a body draws, so only those parts are fetched. */
export function referencedCids(html: string): string[] {
  if (!html || !/cid:/i.test(html)) return [];
  const { root } = parse(html);
  const out = new Set<string>();
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[src], [background]"))) {
    for (const attr of ["src", "background"]) {
      const v = el.getAttribute(attr) ?? "";
      if (/^\s*cid:/i.test(v)) out.add(cidOf(v));
    }
  }
  return [...out];
}

export interface PreparedEmail {
  html: string;
  /** Remote fetches held back; 0 when images are shown or there were none. */
  blocked: number;
}

/**
 * A body ready for EmailFrame: unsafe parts stripped, remote fetches held back
 * unless `showRemote`, and each `cid:` drawn from `inline` (content id to a
 * local URL, keys compared case-insensitively). A cid with no part stays as it
 * was and draws nothing.
 */
export function prepareEmail(html: string, { showRemote, inline = {} }: { showRemote: boolean; inline?: Record<string, string> }): PreparedEmail {
  if (!html) return { html: "", blocked: 0 };
  const { doc, root } = parse(html);
  const blocked = hold(root, showRemote);
  const parts = new Map(Object.entries(inline).map(([k, v]) => [cidOf(k), v]));
  if (parts.size) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[src], [background]"))) {
      for (const attr of ["src", "background"]) {
        const v = el.getAttribute(attr);
        const url = v && /^\s*cid:/i.test(v) ? parts.get(cidOf(v)) : undefined;
        if (url) el.setAttribute(attr, url);
      }
    }
  }
  return { html: serialize(doc, root), blocked };
}

/**
 * The line that introduces a quotation, in English and French: it ends in a
 * colon, so "on Tuesday we wrote:" inside a paragraph is not one. Tested on a
 * trimmed line, anchored, with bounded repeats, so no body can make it slow.
 */
const ATTRIBUTION =
  /^(?:>+ ?)?(?:On\s.{0,200}?\swrote:|Le\s.{0,200}?\sa\s[ée]crit[  ]?:|-{2,}\s?(?:Original Message|Message d'origine|Forwarded message|Message transf[ée]r[ée])\s?-{2,})$/i;
const isAttribution = (text: string) => ATTRIBUTION.test(text.trim());

export interface SplitEmail {
  /** What is new in this message. */
  visible: string;
  /** The history it quotes, folded behind a toggle; null when there is none. */
  quoted: string | null;
}

/** Cut the fragment from `start` to its end into the quoted part. */
function cutFrom(doc: Document, root: DocumentFragment, start: Node): SplitEmail {
  const rest = doc.createRange();
  rest.setStartBefore(start);
  rest.setEnd(root, root.childNodes.length);
  const box = doc.createElement("div");
  box.appendChild(rest.extractContents());
  return { visible: serialize(doc, root), quoted: box.innerHTML };
}

/**
 * Split a body into what is new and the history it quotes. A message that is
 * nothing but a quotation (a forward) is not folded: folding it would show an
 * empty message. A reply that answers between quoted lines is not folded from
 * its first `>`: only a run of `>` lines that reaches the end is history.
 */
export function splitQuoted(html: string): SplitEmail {
  const body = String(html || "");
  if (!body.trim()) return { visible: body, quoted: null };
  const { doc, root } = parse(body);

  const bq = root.querySelector("blockquote");
  if (bq) {
    /* The "On … wrote:" line right above the quotation folds with it. */
    let start: Node = bq;
    let prev = bq.previousSibling;
    while (prev && !(prev.textContent ?? "").trim()) prev = prev.previousSibling;
    if (prev && isAttribution(prev.textContent ?? "")) start = prev;
    const before = doc.createRange();
    before.setStart(root, 0);
    before.setEndBefore(start);
    if (!(before.cloneContents().textContent ?? "").trim()) return { visible: body, quoted: null };
    return cutFrom(doc, root, start);
  }

  const all = lines(root);
  const said = (upTo: number) => all.slice(0, upTo).some((l) => l.text.trim() !== "");
  for (let i = 1; i < all.length; i += 1) {
    if (isAttribution(all[i]!.text) && said(i)) return cutFrom(doc, root, all[i]!.start);
  }

  /* A trailing run of `>` lines, as a plain-text reply quotes. */
  let cut = all.length;
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const text = all[i]!.text.trim();
    if (text.startsWith(">")) cut = i;
    else if (!text && cut < all.length) continue;
    else break;
  }
  if (cut < all.length && said(cut)) return cutFrom(doc, root, all[cut]!.start);
  return { visible: body, quoted: null };
}

/**
 * The body's lines, in order: each top-level block is a line, and so is each
 * `<br>`-separated run inside a block, because a plain-text message arrives as
 * paragraphs whose lines are joined by `<br>`. `start` is where a cut before
 * that line begins; a cut inside a paragraph splits it, keeping both halves.
 */
function lines(root: DocumentFragment): { start: Node; text: string }[] {
  const out: { start: Node; text: string }[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType !== 1 || !Array.from(node.childNodes).some((c) => c.nodeName === "BR")) {
      out.push({ start: node, text: node.textContent ?? "" });
      continue;
    }
    let start: Node | null = null;
    let text = "";
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeName === "BR") {
        out.push({ start: start ?? child, text });
        start = null;
        text = "";
        continue;
      }
      start ??= child;
      text += child.textContent ?? "";
    }
    if (start) out.push({ start, text });
  }
  return out;
}
