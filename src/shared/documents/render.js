"use strict";
/**
 * The template language for letters, payslips and system mail, and the renderer.
 * Deliberately small: a template states facts, it does not compute them.
 *
 *   Dear {{ employee.first_name }},
 *   Your query {{ number }} dated {{ date issued_on }} asks you to respond by {{ longdate respond_by }}.
 *   {{#if allowance}}An allowance of {{ money allowance }} applies.{{else}}No allowance applies.{{/if}}
 *   {{#each items}}<tr><td>{{ label }}</td><td>{{ money amount }}</td></tr>{{/each}}
 *   {{ markdown body }}
 *
 * Rules:
 *  - Every value is HTML-escaped. There is no raw output; the one way to put markup in
 *    is `markdown`, which is rendered safely (shared/documents/markdown.js).
 *  - The only formatters are the house formats (gate 15): `date` 09/10/2026, `longdate`
 *    9 October 2026, `datetime` 09/10/2026 14:05, `month` October 2026, `money`
 *    ₦1,250,000.00, `number` 1,250. Nothing else can format a date or an amount.
 *  - `{{#if x}}` is true for anything but null, undefined, false, "", 0 and [].
 *    `{{#each list}}` repeats for each item; inside it, names read from the item first,
 *    then from outside, and `@index` / `@number` give the position (0- and 1-based).
 *  - A layout includes its page with `{{> body}}`.
 *  - A value can be a block the code built (never one a template or a person writes): a list of
 *    words prints as numbered clauses, a grid (`{ head: [...], rows: [[...]] }`) as a table, and a
 *    signature the hub stamped (`{ signature: "data:image/png;base64,…", typed, name }`) as its
 *    image, or its typed name in a signature face. Every cell and clause is escaped as any value
 *    is; a signature's picture is only ever a PNG data URL (docs/guides/partnerships.md §6.8, an
 *    agreement's options, its delivery checklist and its execution block). A chart
 *    (`{ chart: { kind, title, labels, series, unit } }`) prints as SVG drawn from its numbers by
 *    shared/documents/chart.js, every label escaped (docs/guides/praxis-ai.md §6.19 item 8.4).
 *  - A name that walks the prototype ("__proto__", "constructor") is refused when the
 *    template is parsed, and a value is only read from an object's own properties.
 *  - A template that does not parse fails at parse time, naming the line: in Settings
 *    when it is saved, in tests for the shipped defaults, never halfway through a payslip run.
 */
const money = require("../money/money");
const dayFirst = require("../time/day-first");
const { markdownToHtml, escapeHtml } = require("./markdown");

const HELPERS = Object.freeze({
  date: (v) => (v ? dayFirst.formatDate(v) : ""),
  longdate: (v) => (v ? dayFirst.formatLongDate(v) : ""),
  datetime: (v) => (v ? dayFirst.formatDateTime(v) : ""),
  month: (v) => (v ? dayFirst.formatMonth(v) : ""),
  money: (v) =>
    v === null || v === undefined || v === "" ? "" : money.formatNaira(v),
  number: (v) =>
    v === null || v === undefined || v === ""
      ? ""
      : new Intl.NumberFormat("en-NG").format(Number(v)),
  markdown: null, // handled specially: its output is HTML, not escaped
});

const PATH_RE =
  /^(@index|@number|this|[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*)$/;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const TAG_RE = /\{\{\s*([#/>]?)\s*([^}]*?)\s*\}\}/g;

class TemplateError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = "TemplateError";
    this.line = line || null;
  }
}

function checkPath(p, line) {
  if (!PATH_RE.test(p))
    throw new TemplateError(`"${p}" is not a variable name`, line);
  if (p.split(".").some((s) => FORBIDDEN.has(s)))
    throw new TemplateError(`"${p}" is not allowed`, line);
  return p;
}

const lineAt = (src, index) => src.slice(0, index).split("\n").length;

/**
 * Parse a template into a tree. Throws TemplateError naming the line.
 * @param {string} src
 * @returns {Array<object>} nodes
 */
function parse(src) {
  const root = { kind: "root", children: [] };
  const stack = [root];
  const text = String(src || "");
  const into = (node) => (node.inElse ? node.otherwise : node.children);
  let last = 0;
  for (const m of text.matchAll(TAG_RE)) {
    const [whole, sigil, body] = m;
    const line = lineAt(text, m.index);
    const top = stack[stack.length - 1];
    if (m.index > last)
      into(top).push({ kind: "text", text: text.slice(last, m.index) });
    last = m.index + whole.length;

    if (sigil === "#") {
      const [word, arg, extra] = body.split(/\s+/);
      if (!["if", "each"].includes(word) || !arg || extra)
        throw new TemplateError(
          `"{{#${body}}}" should be {{#if name}} or {{#each name}}`,
          line,
        );
      const node = {
        kind: word,
        path: checkPath(arg, line),
        children: [],
        otherwise: null,
        inElse: false,
        line,
      };
      into(top).push(node);
      stack.push(node);
    } else if (sigil === "/") {
      if (top.kind !== body || top.kind === "root") {
        throw new TemplateError(
          `"{{/${body}}}" does not close ${top.kind === "root" ? "anything" : `{{#${top.kind}}}`}`,
          line,
        );
      }
      delete top.inElse;
      stack.pop();
    } else if (sigil === ">") {
      if (body !== "body")
        throw new TemplateError("only {{> body}} can be included", line);
      into(top).push({ kind: "body", line });
    } else if (body === "else") {
      if (top.kind !== "if" || top.inElse)
        throw new TemplateError("{{else}} outside {{#if}}", line);
      top.otherwise = [];
      top.inElse = true;
    } else {
      const parts = body.split(/\s+/);
      if (parts.length > 2)
        throw new TemplateError(`"{{ ${body} }}" has too many words`, line);
      const [helper, arg] = parts.length === 2 ? parts : [null, parts[0]];
      if (helper && !Object.prototype.hasOwnProperty.call(HELPERS, helper)) {
        throw new TemplateError(
          `"${helper}" is not a formatter; use ${Object.keys(HELPERS).join(", ")}`,
          line,
        );
      }
      into(top).push({ kind: "var", helper, path: checkPath(arg, line), line });
    }
  }
  if (last < text.length)
    into(stack[stack.length - 1]).push({
      kind: "text",
      text: text.slice(last),
    });
  const open = stack[stack.length - 1];
  if (open !== root)
    throw new TemplateError(`{{#${open.kind}}} is never closed`, open.line);
  return root.children;
}

/** Every variable path a template reads (for checking it against its declared variables). */
function variablesOf(nodes, out = new Set(), inEach = false) {
  for (const n of nodes) {
    if (n.kind === "var" || n.kind === "if" || n.kind === "each") {
      if (!n.path.startsWith("@") && n.path !== "this")
        out.add(`${inEach ? "~" : ""}${n.path}`);
    }
    if (n.kind === "if") {
      variablesOf(n.children, out, inEach);
      if (n.otherwise) variablesOf(n.otherwise, out, inEach);
    }
    if (n.kind === "each") variablesOf(n.children, out, true);
  }
  return out;
}

function own(obj, key) {
  return obj !== null &&
    typeof obj === "object" &&
    Object.prototype.hasOwnProperty.call(obj, key)
    ? obj[key]
    : undefined;
}

function lookup(scopes, path) {
  const top = scopes[scopes.length - 1];
  if (path === "this") return top.item;
  if (path === "@index") return top.index;
  if (path === "@number")
    return top.index === undefined ? undefined : top.index + 1;
  const [head, ...rest] = path.split(".");
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const value = own(scopes[i].data, head);
    if (value !== undefined) return rest.reduce((o, k) => own(o, k), value);
  }
  return undefined;
}

const truthy = (v) =>
  !(
    v === null ||
    v === undefined ||
    v === false ||
    v === "" ||
    v === 0 ||
    (Array.isArray(v) && v.length === 0)
  );

/** A signature's picture: a PNG the signing pad drew and the vault re-encoded, nothing else. */
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

const isChart = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && v.chart !== null && typeof v.chart === "object" && !Array.isArray(v.chart) && Array.isArray(v.chart.labels);
const isGrid = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Array.isArray(v.head) && Array.isArray(v.rows);
const isSignature = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && ("signature" in v || "typed" in v) && !isGrid(v);
const isClauses = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number");
const cellText = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? "" : String(v));

/** A signature as HTML: the stamped picture, or the typed name; empty before it is signed. */
function signatureHtml(v) {
  const name = escapeHtml(cellText(v.name));
  if (typeof v.signature === "string" && PNG_DATA_URL.test(v.signature))
    return `<img class="doc-signature" src="${v.signature}" alt="Signature of ${name}">`;
  if (v.typed) return `<span class="doc-signature-typed">${escapeHtml(cellText(v.typed))}</span>`;
  return "";
}

/** A block value in an HTML template. */
function blockHtml(v) {
  if (isChart(v)) return require("./chart").chartSvg(v.chart);
  if (isGrid(v)) {
    const row = (cells, tag) => `<tr>${cells.map((c) => `<${tag}>${escapeHtml(cellText(c))}</${tag}>`).join("")}</tr>`;
    return `<table>${row(v.head, "th")}${v.rows.map((r) => row(Array.isArray(r) ? r : [], "td")).join("")}</table>`;
  }
  if (isSignature(v)) return signatureHtml(v);
  if (isClauses(v)) return v.length ? `<ol>${v.map((x) => `<li>${escapeHtml(cellText(x))}</li>`).join("")}</ol>` : "";
  return "";
}

/**
 * A block value in a Markdown template: a pipe table or numbered clauses, each cell held as any value
 * is (holdMarkdown), on lines of their own. A signature leaves a marker the HTML step stamps.
 */
function blockMarkdown(v, hold, stamps) {
  if (isChart(v)) {
    stamps.push(require("./chart").chartSvg(v.chart));
    return `${STAMP_OPEN}${stamps.length - 1}${STAMP_CLOSE}`;
  }
  if (isGrid(v)) {
    const width = Math.max(v.head.length, 1);
    const line = (cells) => `| ${Array.from({ length: width }, (_, k) => hold(cellText(cells[k])) || " ").join(" | ")} |`;
    const rule = `|${" --- |".repeat(width)}`;
    return `\n\n${[line(v.head), rule, ...v.rows.map((r) => line(Array.isArray(r) ? r : []))].join("\n")}\n\n`;
  }
  if (isSignature(v)) {
    stamps.push(signatureHtml(v));
    return `${STAMP_OPEN}${stamps.length - 1}${STAMP_CLOSE}`;
  }
  if (isClauses(v)) return v.length ? `\n\n${v.map((x, k) => `${k + 1}. ${hold(cellText(x))}`).join("\n")}\n\n` : "";
  return "";
}

/** Private-use marks around a stamped signature's place in a Markdown template, outside MD_HELD's range. */
const STAMP_OPEN = "\ue010";
const STAMP_CLOSE = "\ue011";

function renderNodes(nodes, scopes, body, escape = escapeHtml, stamps = null) {
  let out = "";
  for (const n of nodes) {
    switch (n.kind) {
      case "text":
        out += n.text;
        break;
      case "body":
        out += body || "";
        break;
      case "var": {
        const v = lookup(scopes, n.path);
        if (n.helper === "markdown") out += markdownToHtml(v || "");
        else if (n.helper) out += escape(HELPERS[n.helper](v));
        else if (v !== null && typeof v === "object")
          out += stamps ? blockMarkdown(v, escape, stamps) : blockHtml(v);
        else out += v === null || v === undefined ? "" : escape(v);
        break;
      }
      case "if":
        out += truthy(lookup(scopes, n.path))
          ? renderNodes(n.children, scopes, body, escape, stamps)
          : renderNodes(n.otherwise || [], scopes, body, escape, stamps);
        break;
      case "each": {
        const list = lookup(scopes, n.path);
        if (Array.isArray(list)) {
          list.forEach((item, index) => {
            const data = item !== null && typeof item === "object" ? item : {};
            out += renderNodes(
              n.children,
              [...scopes, { data, item, index }],
              body,
              escape,
              stamps,
            );
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * Render a template with data.
 * @param {string|Array} template  source text, or a tree from parse()
 * @param {object} data
 * @param {{body?: string}} [opts]  body: what {{> body}} includes (layouts)
 * @returns {string}
 */
function render(template, data = {}, { body = "" } = {}) {
  const tree = Array.isArray(template) ? template : parse(template);
  return renderNodes(tree, [{ data }], body);
}

/*
 * A Markdown template's values. The Markdown step escapes HTML itself, so a value goes in
 * unescaped (escaping it here too printed "O&#39;Brien"), and its Markdown signs are held as
 * private-use characters until the HTML is made, so a name a stranger typed ("[Click](https://…)",
 * "**Urgent**") stays text and never becomes a link or bold. A new line in a value is a space.
 */
const MD_SIGNS = "[]*`|#-_!";
const MD_HELD = [...MD_SIGNS].map((_, i) => String.fromCharCode(0xe000 + i)).join("");
const holdMarkdown = (v) =>
  String(v === null || v === undefined ? "" : v)
    .replace(/\r?\n/g, " ")
    .replace(/[[\]*`|#\-_!]/g, (c) => MD_HELD[MD_SIGNS.indexOf(c)]);
const releaseMarkdown = (html) =>
  html.replace(/[\ue000-\ue008]/g, (c) => MD_SIGNS[c.charCodeAt(0) - 0xe000]);

/**
 * Render a Markdown template (an edit saved in Settings, or a default shipped as Markdown) to safe
 * HTML: names filled, then the one Markdown whitelist, each value escaped exactly once.
 * @param {string|Array} template
 * @param {object} data
 * @returns {string}
 */
function renderMarkdown(template, data = {}) {
  const tree = Array.isArray(template) ? template : parse(template);
  const stamps = [];
  const html = releaseMarkdown(markdownToHtml(renderNodes(tree, [{ data }], "", holdMarkdown, stamps)));
  return html.replace(new RegExp(`${STAMP_OPEN}(\\d+)${STAMP_CLOSE}`, "g"), (_, k) => stamps[Number(k)] || "");
}

/**
 * Fill a Markdown template's names and give back Markdown, not HTML: an agreement's wording filled
 * from its record for the person to edit in Draft. Values are held exactly as renderMarkdown holds
 * them and released afterwards, so a value prints as written but can never close a name or open a
 * new one ("{{" in a partner's name is kept as text). `keep` names the roots left as they are, to be
 * filled later (`signer`, at signing); with `keepEmpty` a name with no value is kept too, so the
 * Draft shows it as a field still to fill and Submit can name it.
 * @param {string} template
 * @param {object} data
 * @param {{keep?: string[], keepEmpty?: boolean}} [opts]
 * @returns {string}
 */
function fillMarkdown(template, data = {}, { keep = [], keepEmpty = false } = {}) {
  const tree = Array.isArray(template) ? template : parse(template);
  const kept = new Set(keep);
  // A value never opens or closes a name, however it was typed.
  const value = (v) => holdMarkdown(v).replace(/\{\{/g, "{ {").replace(/\}\}/g, "} }");
  const out = [];
  const tag = (n) => `{{ ${n.helper ? `${n.helper} ` : ""}${n.path} }}`;
  const blank = (v) =>
    v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || (isGrid(v) && v.rows.length === 0);
  const walk = (nodes, scopes) => {
    for (const n of nodes) {
      const waits = n.path && kept.has(n.path.split(".")[0]);
      if (n.kind === "text") out.push(n.text);
      else if (n.kind === "var" && waits) out.push(tag(n));
      else if (n.kind === "var" && keepEmpty && n.helper !== "markdown" && scopes.length === 1 && blank(lookup(scopes, n.path))) out.push(tag(n));
      else if (n.kind === "var") {
        const v = lookup(scopes, n.path);
        if (n.helper === "markdown") out.push(String(v || "").replace(/\{\{/g, "{ {").replace(/\}\}/g, "} }"));
        else if (n.helper) out.push(value(HELPERS[n.helper](v)));
        else if (v !== null && typeof v === "object") out.push(blockMarkdown(v, value, []));
        else out.push(v === null || v === undefined ? "" : value(v));
      } else if (n.kind === "if") {
        // A part that waits for signing is kept: its names are filled when the document is signed.
        walk(waits || truthy(lookup(scopes, n.path)) ? n.children : n.otherwise || [], scopes);
      } else if (n.kind === "each" && !waits) {
        const list = lookup(scopes, n.path);
        if (Array.isArray(list))
          list.forEach((item, index) =>
            walk(n.children, [...scopes, { data: item !== null && typeof item === "object" ? item : {}, item, index }]),
          );
      }
    }
  };
  walk(tree, [{ data }]);
  return releaseMarkdown(out.join(""));
}

module.exports = { parse, render, renderMarkdown, fillMarkdown, variablesOf, TemplateError, HELPERS };
