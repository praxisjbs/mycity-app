#!/usr/bin/env node
"use strict";
/**
 * Gate 15: dates are day-first for people (dd/mm/yyyy), ISO on the wire (README §7, CLAUDE.md).
 *
 * A month-first date is not a cosmetic slip: 03/07/2026 is a real date both ways, so
 * nothing throws, no test goes red, and the screen looks fine to whoever built it. It is
 * read wrong months later by someone acting on it: a contract end, a payslip period, a
 * leave start. And month-first is what you get by default: a native date input renders
 * in the operating system's locale, and toLocaleDateString() with no locale is whatever
 * the machine is set to (en-US in a container with no LANG).
 *
 * Backend (src/, scripts/, packages/): every date a person reads goes through
 * src/shared/time/day-first.js. Flags:
 *   own-date-format      toLocaleDateString(), a date toLocaleString(), or an
 *                        Intl.DateTimeFormat that renders a day next to a month, outside
 *                        src/shared/time/ (whatever the locale: a second copy of a shared
 *                        concern drifts). Intl used only for .formatToParts() is fine: it
 *                        renders nothing
 *   iso-date-on-paper    an ISO day ("yyyy-mm-dd", toISOString().slice(0, 10)) in code that
 *                        renders mail, PDFs, templates or spreadsheets a person opens
 *   month-first-literal  MM/DD/YYYY written into code
 * Frontend (app/src, public-app/src, packages/ui/src):
 *   native-date-input    <input type="date"> or "datetime-local": renders in the OS locale
 *   floating-locale      an order-sensitive date format with no locale pinned
 *   month-first-locale   one pinned to en-US, en-PH, en or und
 *   month-first-literal  as above
 * tests/ is scanned for month-first-literal only.
 *
 * Comments are not scanned. A line that legitimately handles a date is marked, with the
 * reason, on the line or in the comment directly above it:
 *   @date-format:parts     Intl used to read named parts, nothing rendered
 *   @date-format:foreign   somebody else's format (a bank file's MM/DD/YYYY, parsed in)
 *   @date-format:filename  an ISO day in a file name ("/" is not legal in one)
 *
 * Usage: node scripts/check/date-format.js     exit 0 clean, 1 with the list
 */
const fs = require("node:fs");
const path = require("node:path");
const { mask, argsAt, waived, walk, relTo } = require("./lib/source");

const ROOT = path.resolve(__dirname, "..", "..");

const BACKEND = ["src", "scripts", "packages"];
const FRONTEND = ["app/src", "public-app/src", "packages/ui/src"];
const TESTS = ["tests"];
const EXTS = /\.(c|m)?(j|t)sx?$/;

/** Where the shared day-first helpers live: the one place allowed to format dates. */
const HELPERS = "src/shared/time/";

/** Rendering paths whose output a person reads: ISO is wrong here and only here. */
const PAPER = [
  "src/shared/spreadsheet/",
  "src/shared/documents/",
  "src/shared/templates/",
  "src/services/pdf/",
  "src/services/mail/",
  "src/shared/import/report.js",
];

/** Files excused from named rules, with the reason. */
const ALLOW_FILES = {
  "scripts/check/date-format.js": {
    rules: [
      "month-first-literal",
      "native-date-input",
      "month-first-locale",
      "floating-locale",
      "own-date-format",
      "iso-date-on-paper",
    ],
    why: "This gate: it spells out every pattern it bans.",
  },
  "tests/unit/foundation/gates.test.js": {
    rules: ["month-first-literal"],
    why: "Tests this gate: its fixtures are violations on purpose.",
  },
};

const MONTH_FIRST_LOCALE = /^["'`](en-US|en-PH|en|und)["'`]$/;
const WAIVER = /@date-format:(parts|foreign|filename)\b/;

/** Does the argument list render a day number beside a month (the only case order matters)? */
function orderSensitive(args) {
  const comma = args.indexOf(",");
  const opts = args.slice(comma + 1);
  if (comma === -1 || !/\{/.test(opts)) return true;
  return /\b(day|dateStyle)\s*:/.test(opts);
}

/** The locale argument as written, or "" when none is passed. */
function localeArg(args) {
  const first = (args.split(",")[0] || "").trim();
  if (!first || first === "undefined" || first === "[]") return "";
  return first;
}

const kindOf = (rel) =>
  FRONTEND.some((r) => rel.startsWith(`${r}/`))
    ? "frontend"
    : TESTS.some((r) => rel.startsWith(`${r}/`))
      ? "tests"
      : "backend";

/**
 * Every month-first risk in one file.
 * @param {string} source
 * @param {string} rel  repo-relative path, forward slashes
 * @returns {Array<{rel: string, at: number, rule: string, hint: string, line: string}>}
 */
function scanSource(source, rel) {
  const problems = [];
  const kind = kindOf(rel);
  const lines = String(source).split("\n");
  const m = mask(source);
  const code = m.code;
  const codeLines = code.split("\n");
  const allowed = (ALLOW_FILES[rel] && ALLOW_FILES[rel].rules) || [];
  const add = (offset, rule, hint) => {
    if (allowed.includes(rule)) return;
    const at = m.lineOf(offset);
    if (waived(lines, codeLines, at - 1, WAIVER)) return;
    problems.push({
      rel,
      at,
      rule,
      hint,
      line: (lines[at - 1] || "").trim().slice(0, 160),
    });
  };

  for (const x of code.matchAll(/\bMM[/.-]DD[/.-](YYYY|YY)\b/gi)) {
    add(
      x.index,
      "month-first-literal",
      "MyCity writes dates dd/mm/yyyy. If this names an incoming third-party format, mark it @date-format:foreign with the reason.",
    );
  }
  if (kind === "tests") return problems;

  if (kind === "frontend") {
    for (const x of code.matchAll(
      /type\s*=\s*["'{`]*(date|datetime-local)["'`}]/g,
    )) {
      add(
        x.index,
        "native-date-input",
        `A native "${x[1]}" input renders its date in the OS locale. Use the shared day-first date field.`,
      );
    }
  }

  const CALLS = [
    /\.toLocaleDateString\s*\(/g,
    /\.toLocaleString\s*\(/g,
    /new\s+Intl\.DateTimeFormat\s*\(/g,
  ];
  CALLS.forEach((re, which) => {
    for (const x of code.matchAll(re)) {
      const open = x.index + x[0].length - 1;
      const args = argsAt(code, open);
      if (which === 1) {
        // Number#toLocaleString too: only a date when it formats one.
        const before = code.slice(Math.max(0, x.index - 120), x.index);
        const isDate =
          /new\s+Date\s*\([^)]*\)\s*$/.test(before) ||
          /\b(day|dateStyle|weekday)\s*:/.test(args);
        if (!isDate) continue;
      }
      if (which === 2) {
        const after = code.slice(
          open + args.length + 2,
          open + args.length + 80,
        );
        if (/^\s*\.\s*formatToParts\s*\(/.test(after)) continue;
      }
      if (!orderSensitive(args)) continue;
      if (kind === "backend") {
        if (rel.startsWith(HELPERS)) continue;
        add(
          x.index,
          "own-date-format",
          "Format dates for people with src/shared/time/day-first.js (formatDate, formatDateTime, formatLongDate).",
        );
        continue;
      }
      const locale = localeArg(args);
      if (!locale)
        add(
          x.index,
          "floating-locale",
          "Pin the locale (en-GB) or use the day-first helper: no locale means whatever the machine is set to.",
        );
      else if (MONTH_FIRST_LOCALE.test(locale))
        add(
          x.index,
          "month-first-locale",
          `${locale} renders dates month-first. Use "en-GB" or the day-first helper.`,
        );
    }
  });

  if (
    kind === "backend" &&
    PAPER.some((p) => rel === p || (p.endsWith("/") && rel.startsWith(p)))
  ) {
    for (const x of code.matchAll(/["'`]y{2,4}[-/]m{1,2}[-/]d{1,2}/gi)) {
      add(
        x.index,
        "iso-date-on-paper",
        "A person reads this: print dd/mm/yyyy with day-first.js; keep ISO for the wire.",
      );
    }
    for (const x of code.matchAll(
      /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/g,
    )) {
      add(
        x.index,
        "iso-date-on-paper",
        "An ISO day where a person reads it: print dd/mm/yyyy with day-first.js. A file name is the exception: mark it @date-format:filename.",
      );
    }
  }
  return problems;
}

/**
 * @param {{root?: string}} [opts]
 * @returns {{problems: string[], notes: string[], count: number}}
 */
function check({ root = ROOT } = {}) {
  const files = [...BACKEND, ...FRONTEND, ...TESTS].flatMap((r) =>
    walk(path.join(root, r), (n) => EXTS.test(n) && !n.endsWith(".d.ts")),
  );
  const problems = [];
  for (const f of files) {
    const rel = relTo(root, f);
    for (const p of scanSource(fs.readFileSync(f, "utf8"), rel))
      problems.push(`${p.rel}:${p.at}  [${p.rule}] ${p.line}\n      ${p.hint}`);
  }
  return { problems, notes: [], count: files.length };
}

if (require.main === module) {
  const { problems, count } = check();
  if (!problems.length) {
    console.log(
      `date-format: ok (${count} files, every date a person reads is day-first)`,
    );
    process.exit(0);
  }
  console.error(
    "date-format: dates are dd/mm/yyyy for people, ISO on the wire\n",
  );
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nHandling somebody else's format? Mark the line @date-format:foreign, :parts or :filename, with the reason.",
  );
  process.exit(1);
}

module.exports = {
  check,
  scanSource,
  orderSensitive,
  localeArg,
  ALLOW_FILES,
  PAPER,
};
