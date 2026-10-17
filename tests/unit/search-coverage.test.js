"use strict";
/**
 * The search coverage gate's reach checks (scripts/check/search-coverage.js): a screen,
 * an entity type or a screen's New action that ⌘K cannot find fails, unless it carries
 * `// search:none <reason>`. Run against a small fixture repository, and against this one.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const gate = require("../../scripts/check/search-coverage");

const ROOT = path.resolve(__dirname, "..", "..");

function write(root, file, text) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

/** A repository with two screens, three entity types and the catalogues search reads. */
function fixture({ routeMap, screens, actions, shell, features = {}, modules = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mycity-reach-"));
  write(root, "src/shared/route-map.js", routeMap);
  write(root, "src/shared/search/screens.js", screens);
  write(root, "src/shared/search/actions.js", actions);
  write(root, "app/src/shell/catalogue.ts", shell);
  for (const [file, text] of Object.entries(features)) write(root, file, text);
  for (const [file, text] of Object.entries(modules)) write(root, file, text);
  return root;
}

const ROUTE_MAP = `module.exports = {
  SCREENS: { people: ["employees", "leave"] },
  ENTITY_ROUTES: (() => {
const ENTITY_ROUTES = {
  employee: 1,
  // search:none not built yet (src/modules/leave)
  leave_request: 1,
  task: 1, // search:none not built yet (src/modules/tasks)
};
return ENTITY_ROUTES;
  })(),
};
`;
const SCREENS = `module.exports = { SCREENS: [
  { module: "people", tab: "employees", label: "Employees", words: [] },
  { module: "people", tab: "leave", label: "Leave", words: [] },
] };`;
const ACTIONS = `module.exports = { ACTIONS: [{ key: "add_employee", label: "Add Employee" }] };`;
const SHELL = `export const MODULES = [{ key: "people", label: "People", tabs: [t("Employees", "employees"), t("Leave", "leave")] }];`;

describe("search coverage: reach", () => {
  test("a repository where search reaches everything passes", () => {
    const root = fixture({
      routeMap: ROUTE_MAP,
      screens: SCREENS,
      actions: ACTIONS,
      shell: SHELL,
      features: { "app/src/features/people/Employees.tsx": 'useScreenAction(can ? { label: "Add Employee", onSelect: add } : null);' },
    });
    const r = gate.reach({ root, types: ["employee"] });
    expect([...r.screens, ...r.types, ...r.actions]).toEqual([]);
    expect(r.counts).toEqual({ screens: 2, types: 3, actions: 1 });
    expect(r.exempt.map((e) => e.what)).toEqual(["type leave_request", "type task"]);
  });

  test("fails a screen with no entry, a label that drifted, and an entry for no screen", () => {
    const root = fixture({
      routeMap: ROUTE_MAP.replace('["employees", "leave"]', '["employees", "leave", "devices"]'),
      screens: SCREENS.replace('label: "Leave"', 'label: "Leave Requests"').replace("] };", '{ module: "people", tab: "gone", label: "Gone", words: [] },\n] };'),
      actions: ACTIONS,
      shell: SHELL,
    });
    const r = gate.reach({ root, types: ["employee"] });
    expect(r.screens).toEqual([
      'people.leave: search calls it "Leave Requests", the shell "Leave"',
      expect.stringMatching(/^people\.devices: not in src\/shared\/search\/screens\.js/),
      "people.gone: in src/shared/search/screens.js but not a screen in the route map",
    ]);
  });

  test("a screen can be kept out, with a reason", () => {
    const root = fixture({
      routeMap: `// search:none people.leave found from Employees, never on its own\n${ROUTE_MAP}`,
      screens: SCREENS.replace('  { module: "people", tab: "leave", label: "Leave", words: [] },\n', ""),
      actions: ACTIONS,
      shell: SHELL,
    });
    const r = gate.reach({ root, types: ["employee"] });
    expect(r.screens).toEqual([]);
    expect(r.exempt[0]).toEqual({ what: "screen people.leave", reason: "found from Employees, never on its own" });
  });

  test("fails a type nobody declares, a stale marker, a marker with no reason, and 'not built yet' once it is built", () => {
    const root = fixture({
      routeMap: ROUTE_MAP.replace("  employee: 1,", "  employee: 1, // search:none later\n  department: 1,").replace(
        "task: 1, // search:none not built yet (src/modules/tasks)",
        "task: 1, // search:none not built yet (src/modules/tasks)\n  role: 1, // search:none roles are picked inside Settings",
      ),
      screens: SCREENS,
      actions: ACTIONS,
      shell: SHELL,
      modules: { "src/modules/tasks/tasks.controller.js": "module.exports = {};", "src/modules/tasks/tasks.repo.js": "module.exports = {};" },
    });
    const r = gate.reach({ root, types: ["employee", "role"] });
    expect(r.types).toEqual([
      "employee: a provider declares it, so remove its search:none in route-map.js",
      expect.stringMatching(/^department: no search provider declares it/),
      "task: src/modules/tasks is built now; give it a provider, or a real reason",
      "role: a provider declares it, so remove its search:none in route-map.js",
    ]);
  });

  test("fails a New action search does not list, or whose label is not written out", () => {
    const root = fixture({
      routeMap: ROUTE_MAP,
      screens: SCREENS,
      actions: ACTIONS,
      shell: SHELL,
      features: {
        "app/src/features/people/Leave.tsx": 'useScreenAction({ label: "New Leave", onSelect: open });\nuseScreenAction({ label: words, onSelect: open });',
        "app/src/features/people/Kept.tsx": '// search:none a draft screen nobody reaches yet\nuseScreenAction({ label: "Draft Thing", onSelect: open });',
        "app/src/features/people/Bare.tsx": 'useScreenAction({ label: "Bare Thing", onSelect: open }); // search:none',
      },
    });
    const r = gate.reach({ root, types: ["employee"] });
    expect(r.actions).toEqual([
      "app/src/features/people/Bare.tsx:1: search:none needs a reason",
      expect.stringMatching(/^app\/src\/features\/people\/Leave\.tsx:1: "New Leave" is not in src\/shared\/search\/actions\.js/),
      expect.stringMatching(/^app\/src\/features\/people\/Leave\.tsx:2: write the label out/),
    ]);
    expect(r.exempt.map((e) => e.what)).toContain("action at app/src/features/people/Kept.tsx:2");
  });

  test("this repository passes", () => {
    const backend = gate.check();
    const r = gate.reach({ root: ROOT, types: backend.types });
    expect([...r.screens, ...r.types, ...r.actions]).toEqual([]);
  });

  test("the shell's labels and the calls are read from source", () => {
    expect(gate.shellLabels('{ key: "home", tabs: [t("Overview", "overview")] }, { key: "ess", tabs: [t("My Leave", "my-leave")] }')).toEqual({
      home: { overview: "Overview" },
      ess: { "my-leave": "My Leave" },
    });
    expect(gate.screenActionCalls('a\nuseScreenAction(x ? { label: "A", onSelect: () => f(1) } : null);')).toEqual([
      { line: 1, args: 'x ? { label: "A", onSelect: () => f(1) } : null' },
    ]);
  });
});
