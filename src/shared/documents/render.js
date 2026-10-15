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

function renderNodes(nodes, scopes, body) {
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
        else if (n.helper) out += escapeHtml(HELPERS[n.helper](v));
        else
          out +=
            v === null || v === undefined
              ? ""
              : escapeHtml(typeof v === "object" ? "" : v);
        break;
      }
      case "if":
        out += truthy(lookup(scopes, n.path))
          ? renderNodes(n.children, scopes, body)
          : renderNodes(n.otherwise || [], scopes, body);
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

module.exports = { parse, render, variablesOf, TemplateError, HELPERS };
