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
 * or Out (the clock sheet), Mark All Read, Notification Settings, Turn On Notifications and
 * Send Test Notification (the bell, docs/guides/notifications.md §9), the theme and density the person
 * prefers, Install App (the app drops it where the browser cannot install), Refresh Screen and
 * Reload App (the pull and the refresh button's two depths, FRONTEND_FOUNDATION F28) and Sign Out.
 *
 * Every screen's New action is here: the search coverage gate fails a
 * `useScreenAction({ label })` in the app whose label is not an action below, unless the
 * call carries `// search:none <reason>`.
 *
 * `need` is the grant the action needs, [module, action]; the reader must also be shown
 * the screen it opens (shared/search/screens.js tabVisible). Mark All Read needs nothing:
 * the bell is everyone's own. `capability` is the authority it needs on top (README §5.2),
 * where its screen opens to more people than may take it: the Alerts tab opens to whoever
 * may clear alerts, New Rule only to those who may manage the rules; New Report needs
 * `home.reports`, as its tab does.
 */
const routeMap = require("../route-map");
const catalog = require("../access/access.catalog");

const RUNS = new Set([
  "clock",
  "read_all",
  "notify_settings",
  "notify_on",
  "notify_test",
  "theme_dark",
  "theme_light",
  "density",
  "text_size",
  "install",
  "refresh",
  "reload",
  "sign_out",
]);

/**
 * @param {string} key  snake_case, unique
 * @param {string} label  Verb Noun, at most 3 words, as the screen's button reads
 * @param {{screen?: string, params?: Record<string, string>, run?: string, need?: [string, string]|null,
 *          capability?: string|null, words?: string[]}} opts
 */
function a(key, label, { screen = null, params = {}, run = null, need, capability = null, words = [] }) {
  const [module, tab] = screen ? screen.split(".") : [null, null];
  return Object.freeze({
    key,
    label,
    module,
    tab,
    params: Object.freeze({ ...params }),
    run,
    need: need === undefined ? (module ? [module, "view"] : null) : need,
    capability,
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
    need: ["people", "create"],
    words: ["open role", "vacant seat", "new seat", "vacancy on the organogram"],
  }),
  a("add_department", "Add Department", {
    screen: "people.departments",
    params: { action: "new" },
    need: ["people", "create"],
    words: ["new department", "new function", "new team", "create department", "add function"],
  }),
  a("add_worksite", "Add Worksite", {
    screen: "people.worksites",
    params: { action: "new" },
    need: ["people", "create"],
    words: ["worksite", "office", "geofence", "new office", "clock-in location"],
  }),
  a("add_temporary_site", "Add Temporary Site", {
    screen: "people.worksites",
    params: { action: "temporary-site" },
    need: ["people", "approve"],
    words: ["temporary site", "send people out", "field assignment", "client site", "out of station"],
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
  a("new_rule", "New Rule", {
    screen: "home.alerts",
    params: { action: "new" },
    need: ["home", "view"],
    capability: "alerts.manage",
    words: ["alert rule", "new alert", "create rule", "threshold", "warn me when"],
  }),
  a("new_report", "New Report", {
    screen: "home.reports",
    params: { action: "new" },
    need: ["home", "view"],
    capability: "home.reports",
    words: ["report", "build report", "schedule report", "attendance report", "send me a report"],
  }),
  a("new_policy", "New Policy", {
    screen: "knowledge.policies",
    params: { action: "new" },
    need: ["knowledge", "create"],
    capability: "policies.manage",
    words: ["policy", "write a policy", "company policy", "handbook", "attendance policy"],
  }),
  a("raise_query", "Raise a Query", {
    screen: "queries.queries",
    params: { action: "new" },
    need: ["queries", "create"],
    words: ["query", "issue a query", "query letter", "discipline", "misconduct", "explain in writing"],
  }),
  a("clock_in", "Clock In", {
    screen: "ess.my-attendance",
    run: "clock",
    words: ["clock out", "punch in", "check in", "check out", "start work", "attendance"],
  }),
  a("register_device", "Register This Device", {
    screen: "ess.my-devices",
    params: { action: "new" },
    words: ["device", "my phone", "clock-in device", "new phone", "trusted device"],
  }),
  a("new_task", "New Task", {
    screen: "workspace.tasks",
    params: { action: "new" },
    need: ["workspace", "create"],
    words: ["task", "add task", "create task", "to do", "todo", "set a task", "assign work"],
  }),
  // A commitment is a task marked as one (docs/guides/performance.md §6.11): New Task with it ticked.
  a("new_commitment", "New Commitment", {
    screen: "workspace.tasks",
    params: { action: "commitment" },
    need: ["workspace", "create"],
    words: ["commitment", "commitments", "monthly commitment", "set my commitments", "priority for the month"],
  }),
  a("new_project", "New Project", {
    screen: "workspace.projects",
    params: { action: "new" },
    need: ["workspace", "create"],
    words: ["project", "start a project", "new project", "workstream"],
  }),
  // Performance (docs/guides/performance.md §9).
  a("new_goal", "New Goal", {
    screen: "performance.goals",
    params: { action: "new" },
    need: ["performance", "create"],
    words: ["objective", "key result", "okr", "organisational goal", "set a goal"],
  }),
  a("set_up_quarter", "Set Up Quarter", {
    screen: "performance.goals",
    params: { action: "quarter" },
    need: ["performance", "create"],
    capability: "performance.manage",
    words: ["quarter", "new quarter", "next quarter", "open the quarter", "scoring rules", "rating bands", "section weights"],
  }),
  a("report_month", "Report Month", {
    screen: "performance.goals",
    params: { action: "report" },
    need: ["performance", "edit"],
    capability: "goals.function",
    words: ["monthly report", "report the month", "key result update", "okr update", "function report"],
  }),
  a("new_scorecard", "New Scorecard", {
    screen: "performance.targets",
    params: { action: "new" },
    need: ["performance", "create"],
    words: ["scorecard", "targets", "draft a scorecard", "set targets"],
  }),
  a("open_round", "Open Round", {
    screen: "performance.reviews",
    params: { action: "new" },
    need: ["performance", "create"],
    capability: "performance.manage",
    words: ["review round", "monthly round", "open the month", "start reviews", "review cycle"],
  }),
  a("start_check_in", "Start Check-In", {
    screen: "ess.my-performance",
    params: { check_in: "1" },
    need: ["ess", "view"],
    words: ["check in", "check-in", "monthly update", "self review", "self rating", "do my check-in", "review"],
  }),
  a("new_kpi", "New KPI", {
    screen: "performance.kpis",
    params: { action: "new" },
    need: ["performance", "create"],
    capability: "goals.function",
    words: ["kpi", "operational kpi", "indicator"],
  }),
  a("new_event", "New Event", {
    screen: "workspace.calendar",
    params: { action: "new" },
    need: ["workspace", "create"],
    words: ["event", "meeting", "book a meeting", "calendar", "schedule a meeting"],
  }),
  a("new_conversation", "New Conversation", {
    screen: "praxis_ai.ask",
    params: { action: "new" },
    need: ["praxis_ai", "create"],
    words: ["ask praxis ai", "ask ai", "new question", "start a conversation", "assistant"],
  }),
  a("request_leave", "Request Leave", {
    screen: "ess.my-leave",
    params: { action: "new" },
    need: ["ess", "create"],
    words: ["leave", "apply for leave", "holiday", "vacation", "time off", "day off", "sick leave"],
  }),
  // A temporary site from Home's sheet, for anyone (attendance.md §6.11); it replaced New Request
  // and New Assignment in attendance's PR 4.
  a("add_work_site", "Add Work Site", {
    screen: "home.overview",
    params: { action: "work-site" },
    words: ["work site", "temporary site", "work elsewhere", "work location", "client visit", "training", "out of station", "field work", "temporary home"],
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
  a("notification_settings", "Notification Settings", {
    run: "notify_settings",
    need: null,
    words: ["notifications", "push", "alerts on my phone", "email notices", "mute", "sound"],
  }),
  a("turn_on_notifications", "Turn On Notifications", {
    run: "notify_on",
    need: null,
    words: ["push", "phone notifications", "enable notifications", "allow notifications"],
  }),
  a("send_test_notification", "Send Test Notification", {
    run: "notify_test",
    need: null,
    words: ["test push", "test notification", "check notifications"],
  }),
  a("theme_dark", "Use Dark Theme", {
    run: "theme_dark",
    need: null,
    words: ["dark mode", "dark", "night mode", "theme"],
  }),
  a("theme_light", "Use Light Theme", {
    run: "theme_light",
    need: null,
    words: ["light mode", "light", "day mode", "theme"],
  }),
  a("density", "Change Density", {
    run: "density",
    need: null,
    words: ["compact", "comfortable", "spacing", "bigger rows", "smaller rows"],
  }),
  a("text_size", "Change Text Size", {
    run: "text_size",
    need: null,
    words: ["text size", "font size", "bigger text", "larger text", "smaller text", "zoom", "readability"],
  }),
  a("install_app", "Install App", {
    run: "install",
    need: null,
    words: ["install", "add to home screen", "app", "download app"],
  }),
  a("refresh_screen", "Refresh Screen", {
    run: "refresh",
    need: null,
    words: ["refresh", "reload data", "update", "latest", "pull to refresh", "fresh numbers"],
  }),
  a("reload_app", "Reload App", {
    run: "reload",
    need: null,
    words: ["reload", "restart", "restart app", "hard refresh", "start again"],
  }),
  a("sign_out", "Sign Out", {
    run: "sign_out",
    need: null,
    words: ["log out", "logout", "sign off", "exit"],
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
    if (x.capability !== null && !catalog.isCapability(x.capability))
      throw new Error(`search actions: ${x.key} needs "${x.capability}", which is not a catalogued capability`);
  }
}
check();

module.exports = { ACTIONS, linkOf };
