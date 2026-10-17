"use strict";
/**
 * ⌘K's actions: things a person does in one step from anywhere (docs/guides/foundation.md
 * §6.7). Each opens the screen where it is done, already asked to start it:
 *
 *   ?action=new        the screen's New action (useScreenAction in app/src/shell/screen-action.tsx
 *                      runs it when the screen opens with this in its address)
 *   ?action=<word>     another action the screen names (useUrlAction): password, pin
 *   ?importer=<key>    Settings, Imports opens its wizard on that importer
 *
 * `run` is for an action with no screen of its own, which the app does itself: Clock In
 * or Out (the clock sheet) and Mark All Read (the bell).
 *
 * Every screen's New action is here: the search coverage gate fails a
 * `useScreenAction({ label })` in the app whose label is not an action below, unless the
 * call carries `// search:none <reason>`.
 *
 * `need` is the grant the action needs, [module, action]; the reader must also be shown
 * the screen it opens (shared/search/screens.js tabVisible). Mark All Read needs nothing:
 * the bell is everyone's own.
 */
const routeMap = require("../route-map");
const catalog = require("../access/access.catalog");

const RUNS = new Set(["clock", "read_all"]);

/**
 * @param {string} key  snake_case, unique
 * @param {string} label  Verb Noun, at most 3 words, as the screen's button reads
 * @param {{screen?: string, params?: Record<string, string>, run?: string, need?: [string, string]|null, words?: string[]}} opts
 */
function a(key, label, { screen = null, params = {}, run = null, need, words = [] }) {
  const [module, tab] = screen ? screen.split(".") : [null, null];
  return Object.freeze({
    key,
    label,
    module,
    tab,
    params: Object.freeze({ ...params }),
    run,
    need: need === undefined ? (module ? [module, "view"] : null) : need,
    words: Object.freeze(words),
  });
}

const ACTIONS = Object.freeze([
  a("add_employee", "Add Employee", {
    screen: "people.employees",
    params: { action: "new" },
    need: ["people", "create"],
    words: ["new employee", "new staff", "hire", "onboard someone", "create employee"],
  }),
  a("add_role", "Add Role", {
    screen: "people.organogram",
    params: { action: "new" },
    need: ["people", "edit"],
    words: ["open role", "vacant seat", "new seat", "vacancy on the organogram"],
  }),
  a("import_staff", "Import Staff", {
    screen: "settings.imports",
    params: { importer: "employees" },
    need: ["people", "create"],
    words: ["import employees", "staff sheet", "upload staff", "staff spreadsheet"],
  }),
  a("start_import", "Start Import", {
    screen: "settings.imports",
    params: { action: "new" },
    need: ["settings", "view"],
    words: ["import", "upload spreadsheet", "new import"],
  }),
  a("invite_user", "Invite User", {
    screen: "settings.users",
    params: { action: "new" },
    need: ["settings", "create"],
    words: ["invite", "send invite", "new login", "add user", "give access"],
  }),
  a("new_role", "New Role", {
    screen: "settings.roles-and-permissions",
    params: { action: "new" },
    need: ["settings", "create"],
    words: ["create role", "add role", "role", "permissions"],
  }),
  a("new_holiday", "New Holiday", {
    screen: "settings.organisation",
    params: { action: "new" },
    need: ["settings", "create"],
    words: ["public holiday", "add holiday", "holiday", "day off for everyone"],
  }),
  a("clock_in", "Clock In", {
    screen: "ess.my-attendance",
    run: "clock",
    words: ["clock out", "punch in", "check in", "check out", "start work", "attendance"],
  }),
  a("request_leave", "Request Leave", {
    screen: "ess.my-leave",
    params: { action: "new" },
    need: ["ess", "create"],
    words: ["leave", "apply for leave", "holiday", "vacation", "time off", "day off", "sick leave"],
  }),
  a("change_password", "Change Password", {
    screen: "ess.my-security",
    params: { action: "password" },
    words: ["password", "new password", "update password"],
  }),
  a("set_pin", "Set PIN", {
    screen: "ess.my-security",
    params: { action: "pin" },
    words: ["pin", "change pin", "unlock pin", "quick unlock"],
  }),
  a("mark_all_read", "Mark All Read", {
    run: "read_all",
    need: null,
    words: ["notifications", "read all", "clear notifications", "bell"],
  }),
]);

/** The link an action opens, or null for one the app runs itself with no screen. */
function linkOf(action) {
  if (!action.module) return null;
  return routeMap.screenPath(action.module, action.tab, { params: action.params });
}

/** Refuse a broken catalogue when this file loads, as the route map does. */
function check() {
  const keys = new Set();
  const labels = new Set();
  for (const x of ACTIONS) {
    if (!/^[a-z][a-z0-9_]*$/.test(x.key)) throw new Error(`search actions: "${x.key}" is not snake_case`);
    if (keys.has(x.key)) throw new Error(`search actions: "${x.key}" twice`);
    if (labels.has(x.label)) throw new Error(`search actions: the label "${x.label}" twice`);
    keys.add(x.key);
    labels.add(x.label);
    if (x.module) linkOf(x); // throws for a screen that is not in the route map
    if (x.run && !RUNS.has(x.run)) throw new Error(`search actions: ${x.key} runs "${x.run}"`);
    if (!x.module && !x.run) throw new Error(`search actions: ${x.key} opens a screen or runs something`);
    if (x.need && (!catalog.isModule(x.need[0]) || !catalog.isAction(x.need[1])))
      throw new Error(`search actions: ${x.key} needs [module, action], got ${JSON.stringify(x.need)}`);
  }
}
check();

module.exports = { ACTIONS, linkOf };
