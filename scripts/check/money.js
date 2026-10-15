#!/usr/bin/env node
"use strict";
/**
 * Gate 20: money is never a JavaScript number (README §7 rule 1, CLAUDE.md).
 *
 * 0.1 + 0.2 is 0.30000000000000004. On one payslip that is a kobo; across a payroll run
 * and a year of statutory returns it is a reconciliation nobody can close. Money is
 * numeric(18,2) in Postgres, a "1250000.00" string on the wire, and a Decimal in code,
 * through src/shared/money/money.js (money(), plus/minus/times, toWire(), formatNaira()).
 *
 * A name is money when one of its words is (amount, salary, gross, net, price, cost, fee,
 * balance, tax, paye, pension, deduction, allowance, bonus, budget, ngn, kobo, naira,
 * wage, earnings, refund, payout, spend, spent, subtotal, vat, levy, ...) and none is a
 * count or a ratio (rate, percent, count, days, qty, id, number, tokens, ...). So
 * gross_monthly and costNgn are money; tax_rate and amount_count are not.
 *
 * Fails the build on, in src/, packages/ and scripts/ (not tests, not shared/money):
 *   float-parse      parseFloat(), parseInt() or Number() of a money value
 *   float-round      Math.round/floor/ceil/trunc() of a money value
 *   to-fixed         .toFixed() on a money value (money.toWire() rounds half-up, once)
 *   number-math      + - * / % (or += -= *= /=) with a money value as an operand, which
 *                    includes "Total: " + amount (format it with money.formatNaira())
 *   sql-float        a money column cast to float, real or double precision in SQL
 * and in migrations/:
 *   column-type      a money column of a number type other than numeric(18,2)
 *
 * A line that is genuinely not money arithmetic (a count that happens to be called
 * "fees") is marked on the line or in the comment directly above it:
 *   @money:ok <reason>
 *
 * Usage: node scripts/check/money.js     exit 0 clean, 1 with the list
 */
const fs = require("node:fs");
const path = require("node:path");
const { mask, argsAt, waived, walk, relTo } = require("./lib/source");

const ROOT = path.resolve(__dirname, "..", "..");
const SCAN = ["src", "packages", "scripts"];
const SKIP = [/^src\/shared\/money\//, /^scripts\/check\/money\.js$/];

const MONEY = new Set(
  `amount amounts salary salaries gross net price prices cost costs fee fees balance balances
   tax taxes paye pension pensions deduction deductions allowance allowances bonus bonuses
   budget budgets ngn kobo naira wage wages earnings refund refunds payout payouts spend
   spent subtotal vat wht levy levies nhf nsitf reimbursement disbursed commission
   commissions arrears loan loans`.split(/\s+/),
);
const NOT_MONEY = new Set(
  `rate rates percent percentage pct ratio count counts days day hours hour minutes seconds ms
   qty quantity id ids number no code ref year years month months band grade level version
   tokens token index idx page pages size length limit key keys name label type status date
   at file url mode kind flag enabled`.split(/\s+/),
);
const MARK = /@money:ok\s+\S/;

/** The words of an identifier: grossMonthly, gross_monthly → ["gross", "monthly"]. */
const wordsOf = (name) =>
  String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Is this identifier (or the last link of a.b.c) money? */
function isMoneyName(name) {
  const last = String(name).split(/\??\./).pop().trim();
  const w = wordsOf(last);
  return w.some((x) => MONEY.has(x)) && !w.some((x) => NOT_MONEY.has(x));
}

/** Does this expression text name a money value anywhere? */
const mentionsMoney = (text) =>
  (
    String(text).match(/[A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*/g) ||
    []
  ).some((id) => isMoneyName(id.replace(/\s+/g, "")));

const TOKEN =
  /[A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*|\d+(?:\.\d+)?|\+\+|--|=>|[!=<>]=+|&&|\|\||\?\?|[+\-*/%]=?|\S/g;
const OPS = new Set(["+", "-", "*", "/", "%", "+=", "-=", "*=", "/=", "%="]);
const KEYWORDS = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "new",
  "await",
  "yield",
  "void",
  "throw",
  "delete",
]);
const isOperand = (t) => /^[A-Za-z_$\d]/.test(t) && !KEYWORDS.has(t);

/**
 * Money arithmetic in one JavaScript file.
 * @returns {Array<{line: number, rule: string, text: string}>}
 */
function scanJs(source) {
  const m = mask(source);
  const lines = String(source).split("\n");
  const codeLines = m.code.split("\n");
  const hits = [];
  const seen = new Set();
  const add = (offset, rule) => {
    const line = m.lineOf(offset);
    const key = `${line}:${rule}`;
    if (seen.has(key)) return;
    if (waived(lines, codeLines, line - 1, MARK)) return;
    seen.add(key);
    hits.push({
      line,
      rule,
      text: (lines[line - 1] || "").trim().slice(0, 140),
    });
  };
  const bare = m.bare;

  for (const x of bare.matchAll(
    /\b(?:Number\s*\.\s*)?(parseFloat|parseInt|Number)\s*\(/g,
  )) {
    const args = argsAt(bare, x.index + x[0].length - 1);
    if (mentionsMoney(args)) add(x.index, "float-parse");
  }
  for (const x of bare.matchAll(
    /\bMath\s*\.\s*(round|floor|ceil|trunc)\s*\(/g,
  )) {
    const args = argsAt(bare, x.index + x[0].length - 1);
    if (mentionsMoney(args)) add(x.index, "float-round");
  }
  for (const x of bare.matchAll(
    /([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*(?:\)\s*)?\.\s*toFixed\s*\(/g,
  )) {
    if (isMoneyName(x[1].replace(/\s+/g, ""))) add(x.index, "to-fixed");
  }

  const tokens = [...bare.matchAll(TOKEN)].map((t) => ({
    t: t[0],
    i: t.index,
  }));
  tokens.forEach((tok, k) => {
    if (!OPS.has(tok.t)) return;
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    if (!next) return;
    const left = prev && isOperand(prev.t) ? prev.t.replace(/\s+/g, "") : null;
    const right = isOperand(next.t) ? next.t.replace(/\s+/g, "") : null;
    if ((left && isMoneyName(left)) || (right && isMoneyName(right))) {
      // Unary minus on a literal or a non-money name is fine; "-amount" is arithmetic.
      add(tok.i, "number-math");
    }
  });

  for (const s of m.strings) {
    const re =
      /([A-Za-z_][\w.]*)\s*::\s*(float[48]?|real|double\s+precision)\b|\bCAST\s*\(\s*([A-Za-z_][\w.]*)\s+AS\s+(float[48]?|real|double\s+precision)\b/gi;
    for (const x of s.text.matchAll(re)) {
      if (isMoneyName(x[1] || x[3])) add(s.start + x.index, "sql-float");
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

const NUMBER_TYPE =
  /^(?:numeric|decimal|integer|int|int2|int4|int8|bigint|smallint|real|float[48]?|double\s+precision|money)\b(\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?/i;

/**
 * Money columns of the wrong type in one migration.
 * @returns {Array<{line: number, rule: string, text: string}>}
 */
function scanSql(source) {
  const lines = String(source).replace(/\r\n/g, "\n").split("\n");
  const hits = [];
  lines.forEach((raw, i) => {
    const l = raw.replace(/--.*$/, "");
    const re =
      /(?:^|[(,]|\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?|\bALTER\s+COLUMN\s+)\s*"?([a-z_][a-z0-9_]*)"?\s+(?:SET\s+DATA\s+)?(?:TYPE\s+)?([a-z][a-z0-9_]*(?:\s+precision)?(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?)/gi;
    for (const x of l.matchAll(re)) {
      const t = NUMBER_TYPE.exec(x[2].trim());
      if (!t || !isMoneyName(x[1])) continue;
      if (
        /^numeric\s*\(\s*18\s*,\s*2\s*\)$/i.test(
          t[0].replace(/\s+/g, " ").trim(),
        )
      )
        continue;
      if (MARK.test(raw) || MARK.test(lines[i - 1] || "")) continue;
      hits.push({ line: i + 1, rule: "column-type", text: `${x[1]} ${t[0]}` });
    }
  });
  return hits;
}

const isJs = (n) =>
  /\.(c|m)?js$/.test(n) && !/\.(test|spec)\.(c|m)?js$/.test(n);

/**
 * @param {{root?: string}} [opts]
 * @returns {{problems: string[], notes: string[], count: number}}
 */
function check({ root = ROOT } = {}) {
  const problems = [];
  let count = 0;
  for (const f of SCAN.flatMap((d) => walk(path.join(root, d), isJs))) {
    const rel = relTo(root, f);
    if (SKIP.some((re) => re.test(rel))) continue;
    count += 1;
    for (const h of scanJs(fs.readFileSync(f, "utf8")))
      problems.push(`${rel}:${h.line}  [${h.rule}] ${h.text}`);
  }
  for (const f of walk(path.join(root, "migrations"), (n) =>
    n.endsWith(".sql"),
  )) {
    count += 1;
    for (const h of scanSql(fs.readFileSync(f, "utf8")))
      problems.push(
        `${relTo(root, f)}:${h.line}  [${h.rule}] ${h.text}; money columns are numeric(18,2)`,
      );
  }
  return { problems, notes: [], count };
}

if (require.main === module) {
  const { problems, count } = check();
  if (!problems.length) {
    console.log(`money: ok (${count} files, no money as a JavaScript number)`);
    process.exit(0);
  }
  console.error(
    "money: money goes through src/shared/money, never a JavaScript number (README §7)\n",
  );
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nNot money after all (a count called "fees")? Mark the line @money:ok <reason>.',
  );
  process.exit(1);
}

module.exports = { check, scanJs, scanSql, isMoneyName, wordsOf };
