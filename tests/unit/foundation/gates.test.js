"use strict";
/**
 * The CI gates' judgement, tested on text and on throwaway folders rather than on the
 * repository: migration numbers, reversibility and idempotency, day-first dates, money,
 * the module catalogue, production environment references and shell scripts, plus the
 * source reader they share. Fixtures here are violations on purpose. Gate 17 (dashes)
 * is tested with the screen gates (tests/unit/check-copy.test.js).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const source = require("../../../scripts/check/lib/source");
const migrate = require("../../../scripts/db/migrate");
const numbers = require("../../../scripts/check/migration-numbers");
const idem = require("../../../scripts/check/migration-idempotency");
const rev = require("../../../scripts/check/migration-reversibility");
const dates = require("../../../scripts/check/date-format");
const money = require("../../../scripts/check/money");
const catalogue = require("../../../scripts/check/module-catalogue");
const prodRefs = require("../../../scripts/check/production-environment-refs");
const shell = require("../../../scripts/check/shell");

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
function put(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}
const MIG = (up, down) => `-- UP\n${up}\n-- DOWN\n${down}\n`;

describe("source reader", () => {
  test("strings, template pieces and regex literals are told apart from code", () => {
    const src = [
      'const a = "x — y"; // a comment — here',
      "const re = /[\"']/g; const b = 'it\\'s';",
      "const sql = `SELECT ${cols} FROM t -- note`;",
      "/* block",
      "   comment */ const c = a + b;",
    ].join("\n");
    const m = source.mask(src);
    expect(m.code.length).toBe(src.length);
    expect(m.bare.length).toBe(src.length);
    expect(m.code).not.toMatch(/a comment/);
    expect(m.code).toMatch(/x — y/);
    expect(m.bare).not.toMatch(/x — y/);
    expect(m.bare).toMatch(/a \+ b/);
    const texts = m.strings.map((s) => s.text);
    expect(texts).toEqual(["x — y", "it\\'s", "SELECT ", " FROM t -- note"]);
    const pieces = m.strings.filter((s) => s.template !== undefined);
    expect(new Set(pieces.map((s) => s.template)).size).toBe(1);
    expect(m.strings[3].line).toBe(3);
    expect(m.lineOf(src.indexOf("const c"))).toBe(5);
  });

  test("a nested template inside ${ } is its own literal", () => {
    const m = source.mask("x = `a ${f(`b ${c}`)} d`;");
    expect(m.strings.map((s) => s.text)).toEqual(["a ", "b ", " d"]);
  });

  test("a waiver counts on the line or in the comment block right above, not further", () => {
    const text = [
      "// @money:ok counts, not naira",
      "// second line of the reason",
      "x = fees + 1;",
      "",
      "y = 2;",
      "z = fees + 1;",
    ].join("\n");
    const lines = text.split("\n");
    const codeLines = source.mask(text).code.split("\n");
    expect(source.waived(lines, codeLines, 2, /@money:ok\s+\S/)).toBe(true);
    expect(source.waived(lines, codeLines, 5, /@money:ok\s+\S/)).toBe(false);
  });
});

describe("migration files and numbers", () => {
  test("M10 and M11 files sort after M9, and an irreversible file names its reason", () => {
    expect(["10000_a", "9000_b", "0001_c"].sort(migrate.byNumber)).toEqual([
      "0001_c",
      "9000_b",
      "10000_a",
    ]);
    expect(migrate.FILE_RE.test("10001_kb.sql")).toBe(true);
    expect(
      migrate.irreversibleReason(
        "-- IRREVERSIBLE: split fields cannot be joined back",
      ),
    ).toBe("split fields cannot be joined back");
    expect(migrate.irreversibleReason("DROP TABLE IF EXISTS x;")).toBeNull();
    const dir = tmp("mycity-mig-");
    put(dir, "10000_a.sql", MIG("SELECT 1;", "SELECT 1;"));
    put(dir, "9000_b.sql", MIG("SELECT 1;", "SELECT 1;"));
    expect(migrate.listMigrations(dir).map((m) => m.name)).toEqual([
      "9000_b",
      "10000_a",
    ]);
  });

  test("blocks, names and duplicates", () => {
    expect(numbers.blockOf(0)).toEqual([1, 999]);
    expect(numbers.blockOf(11)).toEqual([11000, 11999]);
    expect(numbers.milestoneOf(1050)).toBe(1);
    expect(numbers.milestoneOf(12000)).toBeNull();
    expect(numbers.branchMilestone("m0-foundation-build")).toBe(0);
    expect(numbers.branchMilestone("m4/proposals")).toBe(4);
    expect(numbers.branchMilestone("main")).toBeNull();

    const root = tmp("mycity-num-");
    put(root, "migrations/0001_extensions.sql", MIG("SELECT 1;", "SELECT 1;"));
    put(root, "migrations/0001_again.sql", MIG("SELECT 1;", "SELECT 1;"));
    put(root, "migrations/12000_too_far.sql", MIG("SELECT 1;", "SELECT 1;"));
    put(root, "migrations/0099_Bad-Name.sql", "");
    put(root, "migrations/00042_padded.sql", MIG("SELECT 1;", "SELECT 1;"));
    put(root, "migrations/.gitkeep", "");
    const { problems } = numbers.check({ root, branch: null, changes: [] });
    expect(problems.join("\n")).toMatch(/number 1 is used 2 times/);
    expect(problems.join("\n")).toMatch(
      /12000_too_far\.sql: 12000 is in no milestone block/,
    );
    expect(problems.join("\n")).toMatch(/0099_Bad-Name\.sql: name it/);
    expect(problems.join("\n")).toMatch(
      /00042_padded\.sql: four digits below 10000/,
    );
    expect(problems).toHaveLength(4);
  });

  test("a new file on a milestone branch is in that milestone's block", () => {
    const root = tmp("mycity-num-");
    put(root, "migrations/1000_leave.sql", MIG("SELECT 1;", "SELECT 1;"));
    put(root, "migrations/1010_later.sql", MIG("SELECT 1;", "SELECT 1;"));
    put(root, "migrations/1005_new.sql", MIG("SELECT 1;", "SELECT 1;"));
    const changes = [{ path: "migrations/1005_new.sql", status: "A" }];
    const onM1 = numbers.check({ root, branch: "m1/leave", changes });
    expect(onM1.problems).toEqual([]);
    expect(onM1.notes[0]).toMatch(
      /1005_new\.sql is numbered below 1010_later\.sql/,
    );
    const onM3 = numbers.check({ root, branch: "m3/payroll", changes });
    expect(onM3.problems[0]).toMatch(
      /M3 branch, so a new migration is numbered 3000 to 3999/,
    );
  });
});

describe("migration idempotency", () => {
  test("each rule, and the guards that satisfy it", () => {
    const sql = MIG(
      [
        "CREATE TABLE leave_type (id uuid);",
        "CREATE TABLE IF NOT EXISTS leave_ok (id uuid);",
        "CREATE INDEX leave_type_idx ON leave_type (id);",
        "CREATE INDEX CONCURRENTLY leave_c ON leave_type (id);",
        "ALTER TABLE leave_ok ADD COLUMN days int;",
        "ALTER TABLE leave_ok ADD CONSTRAINT leave_days CHECK (days > 0);",
        "CREATE TYPE leave_state AS ENUM ('a');",
        "CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;",
        "INSERT INTO leave_ok (id) VALUES (gen_random_uuid());",
        "INSERT INTO leave_ok (id) VALUES (gen_random_uuid()) ON CONFLICT DO NOTHING;",
        "-- CREATE TABLE in a comment is not a statement",
        "COMMENT ON TABLE leave_ok IS 'CREATE TABLE in a string is not either';",
      ].join("\n"),
      "DROP TABLE leave_type;\nDROP TABLE IF EXISTS leave_ok;",
    );
    expect(idem.violations(sql).map((v) => v.rule)).toEqual([
      "create-table",
      "create-index",
      "index-concurrently",
      "add-column",
      "add-constraint",
      "create-type",
      "create-function",
      "insert-without-conflict",
      "drop",
    ]);
  });

  test("a dollar-quoted body is the author's guard, and a self-dropping temp table is new each run", () => {
    const sql = MIG(
      [
        "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'st') THEN CREATE TYPE st AS ENUM ('a'); END IF; END $$;",
        "CREATE OR REPLACE FUNCTION g() RETURNS trigger AS $fn$ BEGIN INSERT INTO audit_x VALUES (1); RETURN NEW; END $fn$ LANGUAGE plpgsql;",
        "CREATE TEMP TABLE stage_rows (n int) ON COMMIT DROP;",
        "INSERT INTO stage_rows VALUES (1);",
      ].join("\n"),
      "DROP FUNCTION IF EXISTS g();",
    );
    expect(idem.violations(sql)).toEqual([]);
    expect(
      idem.violations(sql.replace(" ON COMMIT DROP", "")).map((v) => v.rule),
    ).toEqual(["insert-without-conflict"]);
  });

  test("a merged migration that changed, moved or went is refused", () => {
    const root = tmp("mycity-idem-");
    put(
      root,
      "migrations/0001_a.sql",
      MIG("CREATE TABLE IF NOT EXISTS a (id int);", "DROP TABLE IF EXISTS a;"),
    );
    const ok = idem.check({
      root,
      changes: [{ path: "migrations/0001_a.sql", status: "A" }],
    });
    expect(ok.problems).toEqual([]);
    const edited = idem.check({
      root,
      changes: [
        { path: "migrations/0001_a.sql", status: "M" },
        { path: "migrations/0002_b.sql", status: "D" },
        { path: "src/x.js", status: "M" },
      ],
    });
    expect(edited.problems).toHaveLength(2);
    expect(edited.problems[0]).toMatch(
      /0001_a\.sql: a merged migration was edited/,
    );
    expect(edited.problems[1]).toMatch(/was deleted/);
  });
});

describe("migration reversibility", () => {
  test("a complete file passes", () => {
    const text = MIG(
      "CREATE TABLE IF NOT EXISTS leave_type (id uuid);\nALTER TABLE leave_type ADD COLUMN IF NOT EXISTS label text;",
      "ALTER TABLE leave_type DROP COLUMN IF EXISTS label;\nDROP TABLE IF EXISTS leave_type;",
    );
    expect(rev.review(text, "1000_leave.sql")).toEqual([]);
  });

  test("an empty DOWN, a reasonless declaration, and an object DOWN forgets", () => {
    expect(
      rev.review(
        MIG("CREATE TABLE IF NOT EXISTS a (id int);", ""),
        "1_a.sql",
      )[0],
    ).toMatch(/DOWN section has no statements/);
    expect(
      rev.review(MIG("SELECT 1;", "-- just a note"), "1_a.sql")[0],
    ).toMatch(/no statements/);
    expect(
      rev.review(MIG("SELECT 1;", "-- IRREVERSIBLE:"), "1_a.sql")[0],
    ).toMatch(/needs the reason/);
    expect(
      rev.review(
        MIG("SELECT 1;", "-- IRREVERSIBLE: rows merged, sources gone"),
        "1_a.sql",
      ),
    ).toEqual([]);
    const forgot = rev.review(
      MIG(
        "CREATE TABLE IF NOT EXISTS a (id int);\nCREATE TABLE IF NOT EXISTS b (id int);\nALTER TABLE a ADD COLUMN IF NOT EXISTS note text;\nCREATE OR REPLACE FUNCTION a_fn() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;",
        "DROP TABLE IF EXISTS a;",
      ),
      "1_a.sql",
    );
    expect(forgot).toEqual([
      "migrations/1_a.sql: UP creates table b, and DOWN never names it",
      "migrations/1_a.sql: UP creates function a_fn, and DOWN never names it",
      "migrations/1_a.sql: UP creates column note, and DOWN never names it",
    ]);
    expect(rev.review("CREATE TABLE a (id int);", "1_a.sql")[0]).toMatch(
      /needs a "-- UP" line/,
    );
  });

  test("a destructive step says what is lost, on the line, above it, or in the header", () => {
    const bare = MIG(
      "ALTER TABLE a DROP COLUMN IF EXISTS legacy;\nDELETE FROM a WHERE x;",
      "SELECT 1;",
    );
    expect(rev.review(bare, "1_a.sql")).toEqual([
      expect.stringMatching(/1_a\.sql:2 DROP COLUMN with no "-- DESTRUCTIVE/),
      expect.stringMatching(/1_a\.sql:3 DELETE FROM/),
    ]);
    const marked = MIG(
      "-- DESTRUCTIVE: legacy unused since 1004, checked empty\nALTER TABLE a DROP COLUMN IF EXISTS legacy;\nDELETE FROM a WHERE x; -- DESTRUCTIVE: test rows only",
      "SELECT 1;",
    );
    expect(rev.review(marked, "1_a.sql")).toEqual([]);
    expect(
      rev.review(`-- DESTRUCTIVE: whole file reshapes a\n${bare}`, "1_a.sql"),
    ).toEqual([]);
    const inFunction = MIG(
      "CREATE OR REPLACE FUNCTION purge() RETURNS void AS $$ DELETE FROM a; $$ LANGUAGE sql;",
      "DROP FUNCTION IF EXISTS purge();",
    );
    expect(rev.review(inFunction, "1_a.sql")).toEqual([]);
  });
});

describe("day-first dates", () => {
  const scan = (src, rel) => dates.scanSource(src, rel).map((p) => p.rule);

  test("backend: dates for people go through the day-first helper", () => {
    expect(
      scan(
        'const s = d.toLocaleDateString("en-GB");',
        "src/modules/leave/x.js",
      ),
    ).toEqual(["own-date-format"]);
    expect(
      scan(
        "const s = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long' }).format(d);",
        "src/x.js",
      ),
    ).toEqual(["own-date-format"]);
    expect(
      scan(
        'const p = new Intl.DateTimeFormat("en-CA", { day: "2-digit" }).formatToParts(d);',
        "src/shared/spreadsheet/x.js",
      ),
    ).toEqual([]);
    expect(
      scan(
        'const s = d.toLocaleDateString("en-GB");',
        "src/shared/time/day-first.js",
      ),
    ).toEqual([]);
    expect(
      scan(
        'const m = d.toLocaleDateString("en-GB", { month: "long" });',
        "src/x.js",
      ),
    ).toEqual([]);
    expect(scan("const n = total.toLocaleString();", "src/x.js")).toEqual([]);
    expect(scan('const f = "MM/DD/YYYY";', "src/x.js")).toEqual([
      "month-first-literal",
    ]);
    expect(
      scan(
        '// @date-format:foreign the bank sends MM/DD/YYYY\nconst f = "MM/DD/YYYY";',
        "src/x.js",
      ),
    ).toEqual([]);
  });

  test("paper: ISO days are for the wire, not for what a person opens", () => {
    expect(
      scan(
        "const s = d.toISOString().slice(0, 10);",
        "src/shared/documents/render.js",
      ),
    ).toEqual(["iso-date-on-paper"]);
    expect(scan('const f = "yyyy-mm-dd";', "src/services/mail/x.js")).toEqual([
      "iso-date-on-paper",
    ]);
    expect(
      scan(
        "const s = d.toISOString().slice(0, 10);",
        "src/shared/import/engine.js",
      ),
    ).toEqual([]);
    expect(
      scan(
        "// @date-format:filename a file name cannot hold /\nconst n = d.toISOString().slice(0, 10);",
        "src/shared/spreadsheet/x.js",
      ),
    ).toEqual([]);
  });

  test("frontend: native date inputs and floating or month-first locales", () => {
    expect(scan('<input type="date" />', "app/src/x.tsx")).toEqual([
      "native-date-input",
    ]);
    expect(scan("d.toLocaleDateString()", "app/src/x.tsx")).toEqual([
      "floating-locale",
    ]);
    expect(scan('d.toLocaleDateString("en-US")', "app/src/x.tsx")).toEqual([
      "month-first-locale",
    ]);
    expect(scan('d.toLocaleDateString("en-GB")', "app/src/x.tsx")).toEqual([]);
    expect(scan("d.toLocaleDateString()", "tests/x.test.js")).toEqual([]);
    expect(scan('const f = "MM/DD/YYYY";', "tests/x.test.js")).toEqual([
      "month-first-literal",
    ]);
  });

  test("the repository is day-first", () => {
    expect(dates.check().problems).toEqual([]);
  });
});

describe("money", () => {
  test("which names are money", () => {
    for (const n of [
      "gross_monthly",
      "netPay",
      "row.amount",
      "costNgn",
      "paye",
      "item.unit_price",
    ])
      expect(money.isMoneyName(n)).toBe(true);
    for (const n of [
      "tax_rate",
      "amountCount",
      "pages",
      "total",
      "network",
      "payload",
      "fee_id",
      "tokens",
    ])
      expect(money.isMoneyName(n)).toBe(false);
  });

  test("JavaScript numbers on money", () => {
    const js = [
      "const g = parseFloat(row.gross_monthly);",
      "const n = Number(input.amount);",
      "const r = Math.round(salary * 100) / 100;",
      "const s = cost.toFixed(2);",
      "const t = gross + allowance;",
      "net -= tax;",
      'const line = "Total: " + amount;',
      "const ok = m.money(row.gross_monthly).plus(m.money(row.allowance));",
      "if (amount > 0 && pages.length - 1 > 0) count += 1;",
      "const q = `SELECT gross_monthly::float FROM employee`;",
      "// @money:ok a count of fee rows, not naira",
      "const k = fees + 1;",
    ].join("\n");
    const hits = money.scanJs(js);
    expect(hits.map((h) => `${h.line}:${h.rule}`)).toEqual([
      "1:float-parse",
      "2:float-parse",
      "3:float-round",
      "3:number-math",
      "4:to-fixed",
      "5:number-math",
      "6:number-math",
      "7:number-math",
      "10:sql-float",
    ]);
  });

  test("migrations: money columns are numeric(18,2)", () => {
    const sql = [
      "CREATE TABLE IF NOT EXISTS payslip (",
      "  payslip_id uuid PRIMARY KEY,",
      "  gross_monthly numeric(18,2) NOT NULL,",
      "  net_pay numeric(12,2),",
      "  tax_rate numeric(5,2),",
      "  bonus integer,",
      "  paye_amount numeric",
      ");",
      "ALTER TABLE payslip ADD COLUMN IF NOT EXISTS pension_ngn double precision;",
    ].join("\n");
    expect(money.scanSql(sql).map((h) => `${h.line}:${h.text}`)).toEqual([
      "4:net_pay numeric(12,2)",
      "6:bonus integer",
      "7:paye_amount numeric",
      "9:pension_ngn double precision",
    ]);
  });

  test("the repository keeps money out of JavaScript numbers", () => {
    expect(money.check().problems).toEqual([]);
  });
});

describe("module catalogue", () => {
  const CAT = {
    MODULES: ["people", "payroll", "settings"],
    ACTIONS: ["view", "create", "edit"],
  };

  test("enforced keys are read from the three helpers; unknown keys and variables fail", () => {
    const root = tmp("mycity-cat-");
    put(
      root,
      "src/modules/people/people.routes.js",
      [
        'route(router, "get", "/", c, requirePermission("people", "view"), ctl.list);',
        'route(router, "get", "/x", c, requireAnyPermission([["payroll", "view"], ["people", "edit"]]), ctl.x);',
        'mountResource(router, { controller: ctl, module: "people", contract });',
        'route(router, "get", "/y", c, requirePermission("perfomance", "view"), ctl.y);',
        'route(router, "get", "/z", c, requirePermission("people", "update"), ctl.z);',
        'route(router, "get", "/w", c, requirePermission(key, \'view\'), ctl.w);',
        '// requirePermission("ghost", "view") in a comment is not a route',
        'const msg = "add requirePermission(key, action)";',
      ].join("\n"),
    );
    put(
      root,
      "src/modules/people/people.test.js",
      'requirePermission("ghost", "view");',
    );
    const r = catalogue.check({ root, catalog: CAT });
    expect(r.enforced).toEqual(["payroll", "people"]);
    expect(r.problems).toEqual([
      "src/modules/people/people.routes.js:6 names its permission through a variable; write the key and action as string literals",
      'src/modules/people/people.routes.js:4 "perfomance" is not a module in shared/access/access.catalog.js',
      'src/modules/people/people.routes.js:5 "update" is not an action (view, create, edit)',
    ]);
    expect(r.notes).toEqual(["catalogue keys no route enforces yet: settings"]);
    expect(
      catalogue.check({ root, catalog: CAT, exact: true }).problems,
    ).toContain("catalogue keys no route enforces yet: settings");
  });
});

describe("production environment references", () => {
  test("names, blocks, expressions and production secrets", () => {
    const yml = [
      "# environment: production in a comment is fine",
      "jobs:",
      "  a:",
      "    environment: production",
      "  b:",
      "    environment:",
      "      name: production",
      "      url: https://hub.mycityapp.io",
      "  c:",
      "    environment: ${{ inputs.target }}",
      "  d:",
      "    environment: staging",
      "    steps:",
      "      - run: deploy",
      "        env:",
      "          KEY: ${{ secrets.PROD_SSH_KEY }}",
      "          OTHER: ${{ secrets.STAGING_SSH_KEY }}",
    ].join("\n");
    expect(prodRefs.scanWorkflow(yml).map((h) => h.line)).toEqual([
      4, 7, 10, 16,
    ]);
  });

  test("release.yml and rollback.yml are the two allowed; the repository is clean", () => {
    const root = tmp("mycity-wf-");
    put(
      root,
      ".github/workflows/release.yml",
      "jobs:\n  deploy:\n    environment: production\n",
    );
    put(
      root,
      ".github/workflows/rollback.yml",
      "jobs:\n  back:\n    environment: production\n",
    );
    put(
      root,
      ".github/workflows/hotfix.yml",
      "jobs:\n  go:\n    environment: 'production'\n",
    );
    expect(prodRefs.check({ root }).problems).toEqual([
      ".github/workflows/hotfix.yml:3 names the production environment",
    ]);
    expect(prodRefs.check().problems).toEqual([]);
  });
});

describe("shell scripts and JavaScript parse", () => {
  const hasBash = spawnSync("bash", ["--version"]).status === 0;

  test("CRLF, a missing interpreter line, a script that does not parse, and broken JavaScript", () => {
    const root = tmp("mycity-sh-");
    put(root, "ops/ok.sh", "#!/usr/bin/env bash\nset -euo pipefail\necho ok\n");
    put(root, "ops/crlf.sh", "#!/usr/bin/env bash\r\necho hi\r\n");
    put(root, "ops/noshebang.sh", "echo hi\n");
    put(root, "ops/empty.sh", "");
    put(root, "ops/deploy-gate", "#!/bin/bash\nif then fi\n");
    put(root, "scripts/ok.js", "#!/usr/bin/env node\n'use strict';\nreturn;\n");
    put(root, "scripts/esm.mjs", "export const a = 1;\n");
    put(root, "src/broken.js", "const a = ;\n");
    const r = shell.check({ root, bash: hasBash, inCi: false });
    const text = r.problems.join("\n");
    expect(text).toMatch(/ops\/crlf\.sh: Windows line endings/);
    expect(text).toMatch(
      /ops\/noshebang\.sh: the first line is the interpreter/,
    );
    expect(text).toMatch(/src\/broken\.js: does not parse/);
    expect(text).not.toMatch(/ok\.sh|ok\.js|esm\.mjs|empty\.sh/);
    if (hasBash) expect(text).toMatch(/ops\/deploy-gate: bash -n/);
    expect(r.notes.join("\n")).toMatch(
      /empty, not written yet: ops\/empty\.sh/,
    );
  });

  test("without bash the parse step is a note locally and a failure in CI", () => {
    const root = tmp("mycity-sh-");
    put(root, "ops/ok.sh", "#!/usr/bin/env bash\necho ok\n");
    expect(
      shell.check({ root, bash: false, inCi: false }).notes.join("\n"),
    ).toMatch(/bash -n skipped/);
    expect(
      shell.check({ root, bash: false, inCi: true }).problems.join("\n"),
    ).toMatch(/bash is not on the PATH/);
  });
});
