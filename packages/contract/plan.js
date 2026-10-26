"use strict";
/**
 * The delivery plan (FRONTEND_FOUNDATION F14): what has shipped, read one way and decided by
 * one rule for the staff app, the public site and the API. A screen opens on staging once its
 * PROGRESS row has API ticked, and in production once API, UI and Mobile are all ticked. Until
 * then the app shows Coming Soon, and the API leaves it out of every list that would offer it
 * (Need You, ⌘K, Home's cards), so a page of 25 never counts a row nobody may open.
 *
 *   docs/PROGRESS.md                          each screen's milestone (M column) and its API, UI
 *                                             and Mobile ticks
 *   docs/MyCity-ERP-Documents/MILESTONES.md   §4's table: each milestone's name and demo date
 *
 * The app's build reads the plan (packages/ui/vite.shared.js deliveryPlan) and writes the one it
 * was built with beside itself (app/dist/delivery-plan.json). A release carries the app and not
 * the docs, so the API decides from that very file (src/shared/delivery-plan.js).
 *
 *   const plan = require("@mycity/contract/plan");
 *   const p = plan.readPlan((rel) => fs.readFileSync(path.join(root, rel), "utf8"));
 *   plan.screenOpens(p.screens[plan.planKey("expenses", "approvals")] ?? null, "staging", "full")
 */

/** PROGRESS.md's section heading for each module key: a screen's key is "<section>|<tab slug>". */
const SECTIONS = Object.freeze({
  home: "Home",
  workspace: "My Workspace",
  ess: "Employee Self-Service",
  community: "Staff Community",
  mailbox: "Mailbox",
  people: "People",
  performance: "Performance",
  queries: "Queries & Sanctions",
  recruitment: "Recruitment",
  payroll: "Payroll",
  partnerships: "Partnerships",
  expenses: "Expenses",
  knowledge: "Knowledge Hub",
  praxis_ai: "Praxis AI",
  ai_control: "AI Control",
  settings: "Settings",
});

const MONTH = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/**
 * The plan from the two docs, read through `read(repo-relative path) → text`. Screens are keyed
 * "<section>|<slug>": the PROGRESS heading ("Employee Self-Service", "Public site") and the
 * backticked slug or path in the row. Throws when the plan cannot be read, so a build never
 * ships without one.
 * @param {(rel: string) => string} read
 * @returns {{milestones: Array<{key: string, n: number, name: string, demo: string|null}>,
 *            screens: Record<string, {m: string, api: boolean, delivered: boolean}>}}
 */
function readPlan(read) {
  const ms = read("docs/MyCity-ERP-Documents/MILESTONES.md");
  const year = Number((/\b(20\d\d)\b/.exec(ms) || [])[1]) || new Date().getFullYear();
  const head = ms.indexOf("| M | Milestone |");
  if (head < 0) throw new Error("plan: the milestone table (| M | Milestone |) is missing from MILESTONES.md");
  const milestones = [];
  for (const line of ms.slice(head).split("\n").slice(2)) {
    if (!line.startsWith("|")) break;
    const c = line.split("|").map((x) => x.replace(/\*/g, "").trim());
    const n = Number(c[1]);
    const d = /(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.exec(c[5]);
    milestones.push({ key: `M${n}`, n, name: c[2], demo: d ? `${year}-${MONTH[d[2]]}-${d[1].padStart(2, "0")}` : null });
  }
  /* "with M1": a milestone demonstrated alongside another takes its date. */
  for (const m of milestones) if (!m.demo) m.demo = (milestones.find((x) => x.n === m.n + 1) || {}).demo || null;
  const screens = {};
  let section = "";
  for (const line of read("docs/PROGRESS.md").split("\n")) {
    if (line.startsWith("### ")) section = line.slice(4).split(" · ")[0].trim();
    const r = /^\|\s*\d+\s*\|[^|]*\|\s*`([^`]+)`\s*\|\s*(M\d+)\s*\|[^|]*\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|/.exec(line);
    if (r) screens[`${section}|${r[1]}`] = { m: r[2], api: r[3] === "☑", delivered: [r[3], r[4], r[5]].every((t) => t === "☑") };
  }
  if (Object.keys(screens).length < 50) throw new Error("plan: could not read the screens from docs/PROGRESS.md");
  return { milestones, screens };
}

/**
 * The rule for where a build or the API runs: `mock` for the in-browser mock (laptops and CI
 * only), `staging` on a staging host or a dev server, `production` otherwise.
 * @param {{mode?: string, dev: boolean, environment: "staging"|"other"}} options
 * @returns {"production"|"staging"|"mock"}
 */
function openRule({ mode, dev, environment }) {
  if (mode === "mock") return "mock";
  if (environment === "staging" || dev) return "staging";
  return "production";
}

const mNum = (key) => Number(key.slice(1));

/**
 * The milestone being delivered now: the earliest one with screens that is neither past its
 * demo day nor fully ticked.
 * @param {ReturnType<typeof readPlan>} plan
 * @param {string} today  ISO, Lagos
 */
function currentMilestone(plan, today) {
  const rows = Object.values(plan.screens);
  const planned = plan.milestones.filter((m) => m.n >= 1 && rows.some((r) => r.m === m.key));
  const done = (m) => (!!m.demo && m.demo < today) || rows.filter((r) => r.m === m.key).every((r) => r.delivered);
  return planned.find((m) => !done(m)) || planned[planned.length - 1];
}

/**
 * Does a screen open under a rule? A screen missing from the plan opens only in mock mode.
 * @param {{m: string, api: boolean, delivered: boolean}|null} screen
 * @param {"production"|"staging"|"mock"} rule
 * @param {"full"|"delivered"} view  the Prototype View switch, in mock mode only
 * @param {{n: number}} [current]
 */
function screenOpens(screen, rule, view, current) {
  if (rule === "production") return !!(screen && screen.delivered);
  if (rule === "staging") return !!(screen && screen.api);
  if (view === "full" || !screen) return true;
  return screen.delivered || !current || mNum(screen.m) <= current.n;
}

/** A screen's key in the plan: "<PROGRESS section>|<tab slug>". */
const planKey = (moduleKey, tab) => `${SECTIONS[moduleKey]}|${tab}`;

/**
 * The screen a link lands on: "/expenses?tab=approvals&id=…" is Expenses, Approvals; null for
 * a link that is not a screen.
 * @param {string} href
 * @param {(segment: string) => string} moduleKeyOf  the path's segment as a module key ("praxis-ai" → "praxis_ai")
 */
function screenOfLink(href, moduleKeyOf) {
  const found = /^\/([a-z][a-z-]*)(?:\?([^#]*))?/.exec(String(href));
  if (!found) return null;
  return { moduleKey: moduleKeyOf(found[1] || ""), tab: new URLSearchParams(found[2] || "").get("tab") };
}

/**
 * The module and link answers from the one screen rule, for a whole list at once: a module
 * opens when any of its tabs does; a link opens as the screen it lands on does, and a link
 * outside the app's screens is never held back.
 * @param {(moduleKey: string, tab: string) => boolean} screen
 * @param {(moduleKey: string) => string[]|undefined} tabsOf  a module's tab slugs; undefined when it is no module
 * @param {(segment: string) => string} moduleKeyOf
 */
function opensFrom(screen, tabsOf, moduleKeyOf) {
  const module = (moduleKey) => (tabsOf(moduleKey) || []).some((tab) => screen(moduleKey, tab));
  const link = (href) => {
    const at = screenOfLink(href, moduleKeyOf);
    if (!at || !tabsOf(at.moduleKey)) return true;
    return at.tab ? screen(at.moduleKey, at.tab) : module(at.moduleKey);
  };
  return { screen, module, link };
}

module.exports = { SECTIONS, readPlan, openRule, currentMilestone, screenOpens, planKey, screenOfLink, opensFrom };
