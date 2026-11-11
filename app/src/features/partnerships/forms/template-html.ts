import type { TemplateAsk } from "@mycity/contract/contract.gen.ts";

/** A value a template may name, as the editor's chip carries it. */
export interface Chip {
  field: string;
  label: string;
  tag: string;
}

/**
 * Every chip of one field in the wording becomes another field's: how Tidy With AI's proposal is changed
 * before Use Draft. The HTML is the editor's own, so a chip is `span[data-field]` holding its tag.
 */
export function retag(html: string, from: string, to: Chip): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const span of Array.from(doc.body.querySelectorAll("span[data-field]"))) {
    if (span.getAttribute("data-field") !== from) continue;
    span.setAttribute("data-field", to.field);
    span.setAttribute("data-label", to.label);
    span.textContent = to.tag;
  }
  return doc.body.innerHTML;
}

/** `opening_hours` from "Opening Hours": a lower case key of letters, digits and underscores that starts with a letter. */
export function askKey(label: string, taken: ReadonlyArray<Pick<TemplateAsk, "key">>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 34);
  const start = /^[a-z]/.test(base) ? base : `ask_${base}`.replace(/_$/, "") || "ask";
  const used = new Set(taken.map((a) => a.key));
  let key = start;
  for (let n = 2; used.has(key); n += 1) key = `${start}_${n}`;
  return key;
}
