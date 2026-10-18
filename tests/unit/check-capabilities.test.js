"use strict";
/**
 * The capabilities gate (scripts/check/capabilities.js): a capability the code checks
 * that is not catalogued, a catalogued one no reference seed inserts, a seeded one the
 * catalogue lacks, and a malformed catalogue entry all fail. Run against small fixture
 * repositories, and against this one.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const gate = require("../../scripts/check/capabilities");

function write(root, file, text) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

const CODE = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;
const entry = (code, module = "home") => ({ code, module, label: "A Label", description: "What it allows." });
const catalog = (entries) => ({ MODULES: ["home", "community"], CAPABILITY_CODE: CODE, CAPABILITY_CATALOG: entries });

const SEED = `-- Capabilities.
-- UP
INSERT INTO capability (code, name, description)
VALUES
  ('home.team', 'View Team', 'Open the team''s tab; and more.'),
  ('alerts.clear', 'Clear Alerts', 'Clear an alert.')
ON CONFLICT (code) DO NOTHING;
-- DOWN
DELETE FROM capability WHERE code IN ('home.team', 'alerts.clear');
`;

/** A repository whose seeds insert home.team and alerts.clear, plus the given files. */
function fixture(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mycity-caps-"));
  write(root, "seeds/reference/0449_seed_caps.sql", SEED);
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  return root;
}

describe("capabilities: the checks in the code", () => {
  test("literal codes in the three helpers are read, in src/ and app/src/, comments and declarations aside", () => {
    const r = gate.usesIn(
      [
        'route(router, "get", "/team", c, requirePermission("home", "view"), requireCapability("home.team"), ctl.team);',
        'route(router, "get", "/alerts", c, requirePermission("home", "view"), requireAnyCapability(["alerts.clear", "alerts.manage"]), ctl.list);',
        'if (hasCapability(me, "home.reports")) show();',
        "function hasCapability(reader, code) { return reader.capabilities.includes(code); }",
        '// requireCapability("ghost.code") in a comment is not a check',
        'const msg = "call requireCapability(code)";',
        "requireCapability(code);",
        'requireAnyCapability([code, "alerts.clear"]);',
      ].join("\n"),
    );
    expect(r.uses).toEqual([
      { code: "home.team", line: 1 },
      { code: "alerts.clear", line: 2 },
      { code: "alerts.manage", line: 2 },
      { code: "alerts.clear", line: 8 },
      { code: "home.reports", line: 3 },
    ]);
    expect(r.dynamic).toEqual([7, 8]);
  });

  test("a clean repository passes", () => {
    const root = fixture({
      "src/modules/dashboard/dashboard.routes.js": 'requirePermission("home", "view"), requireCapability("home.team"), ctl.team;',
      "app/src/shell/access.ts": 'export function hasCapability(me: Me, code: string) { return me.is_ceo; }\nhasCapability(me, "alerts.clear");',
    });
    const r = gate.check({ root, catalog: catalog([entry("home.team"), entry("alerts.clear")]) });
    expect(r).toEqual({ problems: [], catalogued: 2, checks: 2 });
  });

  test("an uncatalogued code fails wherever it is checked; a variable fails anywhere; tests are not read", () => {
    const root = fixture({
      "src/modules/dashboard/dashboard.routes.js": 'requirePermission("home", "view"), requireCapability("home.teams"), ctl.team;\nrequireCapability(code);',
      "app/src/features/home/index.tsx": 'const can = hasCapability(me, "alerts.manage");',
      "src/shared/search/search.service.js": "hasCapability(reader, x.capability);",
      "src/modules/dashboard/dashboard.test.js": 'requireCapability("ghost.code");',
      "app/src/shell/access.test.ts": 'hasCapability(me, "ghost.code");',
    });
    const r = gate.check({ root, catalog: catalog([entry("home.team"), entry("alerts.clear")]) });
    expect(r.problems).toEqual([
      "src/modules/dashboard/dashboard.routes.js:2 names its capability through a variable; write the code as a string literal",
      "src/modules/dashboard/dashboard.routes.js:1 \"home.teams\" is not a capability in shared/access/access.catalog.js",
      "src/shared/search/search.service.js:1 names its capability through a variable; write the code as a string literal",
      "app/src/features/home/index.tsx:1 \"alerts.manage\" is not a capability in shared/access/access.catalog.js",
    ]);
  });
});

describe("capabilities: the catalogue and the seeds", () => {
  test("a malformed or doubled entry fails", () => {
    const root = fixture();
    const r = gate.check({
      root,
      catalog: catalog([
        entry("home.team"),
        entry("alerts.clear"),
        entry("home.alerts.manage"),
        entry("Payroll.Run"),
        { code: "home.team", module: "dashboard", label: "", description: "x" },
      ]),
    });
    expect(r.problems).toEqual(
      expect.arrayContaining([
        'access.catalog.js: capability "home.alerts.manage" is not <area>.<authority>, two lower_snake segments',
        'access.catalog.js: capability "Payroll.Run" is not <area>.<authority>, two lower_snake segments',
        'access.catalog.js: capability "home.team" belongs to "dashboard", which is not a module key',
        'access.catalog.js: capability "home.team" needs a label and a description',
        'access.catalog.js: capability "home.team" is catalogued twice',
      ]),
    );
  });

  test("a catalogued code no seed inserts, and a seeded code the catalogue lacks, both fail", () => {
    const root = fixture();
    const r = gate.check({ root, catalog: catalog([entry("home.team"), entry("home.reports")]) });
    expect(r.problems).toEqual([
      'capability "home.reports" is catalogued but no seeds/reference/*.sql inserts it into capability',
      'seeds/reference/0449_seed_caps.sql: inserts capability "alerts.clear", which is not in shared/access/access.catalog.js',
    ]);
  });

  test("a later seed's UP that deletes a code takes it away; a DOWN never counts", () => {
    const root = fixture({
      "seeds/reference/1199_seed_retire.sql": "-- UP\nDELETE FROM capability WHERE code = 'alerts.clear';\n-- DOWN\nINSERT INTO capability (code, name) VALUES ('alerts.clear', 'Clear Alerts');\n",
    });
    const { seeded } = gate.seededCodes(path.join(root, "seeds", "reference"), root);
    expect([...seeded.keys()]).toEqual(["home.team"]);
    expect(seeded.get("home.team")).toBe("seeds/reference/0449_seed_caps.sql");
  });

  test("an insert whose codes cannot be read fails, and so does a seed without UP and DOWN", () => {
    const root = fixture({
      "seeds/reference/1199_seed_select.sql": "-- UP\nINSERT INTO capability (code, name) SELECT code, name FROM elsewhere;\n-- DOWN\nSELECT 1;\n",
      "seeds/reference/1299_seed_computed.sql": "-- UP\nINSERT INTO capability (name, code) VALUES ('Clear', lower('ALERTS.CLEAR'));\n-- DOWN\nSELECT 1;\n",
      "seeds/reference/1399_seed_broken.sql": "INSERT INTO capability (code, name) VALUES ('home.team', 'View Team');\n",
    });
    const r = gate.check({ root, catalog: catalog([entry("home.team"), entry("alerts.clear")]) });
    expect(r.problems).toEqual([
      "seeds/reference/1199_seed_select.sql: an INSERT INTO capability whose codes cannot be read; write each row's code as a literal in VALUES",
      "seeds/reference/1299_seed_computed.sql: an INSERT INTO capability whose codes cannot be read; write each row's code as a literal in VALUES",
      'seeds/reference/1399_seed_broken.sql: needs a "-- UP" line and a "-- DOWN" line',
    ]);
  });

  test("statements split on semicolons outside quotes, comments dropped", () => {
    expect(gate.statements("-- a note; still a note\nSELECT 'a;b'; SELECT 'it''s';\n")).toEqual(["SELECT 'a;b'", "SELECT 'it''s'"]);
  });
});

describe("capabilities: this repository", () => {
  test("every capability is catalogued and seeded, and every check names a catalogued code", () => {
    const r = gate.check();
    expect(r.problems).toEqual([]);
    expect(r.checks).toBeGreaterThan(0);
  });
});
