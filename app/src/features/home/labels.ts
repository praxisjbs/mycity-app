import alerts from "@mycity/contract/schemas/alerts.js";
import type { HomeActivityItem, HomeAlert, HomeAlertRule, HomeRosterStatus } from "@mycity/contract/contract.gen.ts";
import { formatCount, plural, todayIso } from "@mycity/ui";
import { moduleByKey } from "@/shell/catalogue";

/**
 * The words Home shows for the API's values (docs/guides/home.md §10.1). The server sends
 * keys and figures; the screen words them here, once, so the Overview, Team and Alerts say
 * the same thing and the screen gates read every word.
 */
type Tone = "ok" | "warn" | "err" | "info" | "neutral";

/** A person's status today on the shared attendance roster. */
export const ROSTER_STATUS: Record<HomeRosterStatus, { tone: Tone; text: string }> = {
  on_site: { tone: "ok", text: "On Site" },
  remote: { tone: "ok", text: "Remote" },
  late: { tone: "warn", text: "Late" },
  not_in: { tone: "neutral", text: "Not In" },
  on_leave: { tone: "info", text: "On Leave" },
  absent: { tone: "err", text: "Absent" },
};

const someone = (name: string | null) => name ?? "Someone";

/**
 * Activity Today, one line per event the server's allow-list sends
 * (src/modules/dashboard/dashboard.activity.js). A key with no line here is not shown:
 * the server may list an event before the screen has words for it, and a raw key never
 * reaches a person.
 */
const ACTIVITY: Record<string, (e: HomeActivityItem) => string> = {
  "employee.created": (e) => `${someone(e.subject)} joined`,
  "leave_request.approved": (e) => `Leave approved for ${someone(e.subject)}`,
  "leave_request.recorded": (e) => `Leave recorded for ${someone(e.subject)}`,
  "attendance.review_required": (e) => `Punch needs review for ${someone(e.subject)}`,
  "recognition.posted": (e) => (e.subject ? `${someone(e.actor_name)} recognised ${e.subject}` : `${someone(e.actor_name)} posted a recognition`),
  "celebration.posted": (e) => `Celebrating ${someone(e.subject)}`,
};

/** The line Activity Today shows for an event, or null for a key it has no words for. */
export function activityLine(e: HomeActivityItem): string | null {
  const line = ACTIVITY[e.event_key];
  return line ? line(e) : null;
}

/* ------------------------------------------------------------------ *
 * Alerts (home.md §6 Alerts, §10.1)
 * ------------------------------------------------------------------ */

/** An alert's or a rule's severity. */
export const SEVERITY: Record<HomeAlert["severity"], { tone: Tone; text: string }> = {
  high: { tone: "err", text: "High" },
  medium: { tone: "warn", text: "Medium" },
  low: { tone: "info", text: "Low" },
};

/** The category chips, by the contract's categories (HOME_ALERT_CATEGORIES). */
export const ALERT_CATEGORY: Record<string, string> = {
  attendance: "Attendance",
  approval: "Approvals",
  document: "Documents",
  people: "People",
  partnership: "Partnerships",
  budget: "Budgets",
  recruitment: "Recruitment",
};

/**
 * The help on Over By: the list's column header, each phone card's label. A count raises its
 * alert on reaching the threshold (home.md §6 Alerts), so the help says what +0 means.
 */
export const OVER_BY_HELP = "How far the count is past its rule's threshold: +0 over 3 means it reached 3, +1 means 4. A deadline alert shows the days left instead.";

/**
 * A figure from the wire's decimal string, as people read it: "4.00" is 4, "2.50" is 2.5,
 * with thousands grouped. Read from the digits, never through a float.
 */
export function figure(value: string): string {
  const text = value.trim();
  const [whole, fraction = ""] = text.replace(/^[-+]/, "").split(".");
  const kept = fraction.replace(/0+$/, "");
  return `${text.startsWith("-") ? "-" : ""}${formatCount(Number(whole))}${kept ? `.${kept}` : ""}`;
}

const days = (value: string) => `${figure(value)} ${Number(value) === 1 ? "day" : "days"}`;

export type MetricKey = keyof typeof alerts.HOME_ALERT_METRICS;

/**
 * Each metric a rule can watch (HOME_ALERT_METRICS, in the New Rule form's order): its name,
 * and how a rule on it reads ("3 late in 30 days", "30 days before expiry").
 */
export const METRIC: Record<MetricKey, { label: string; reads: (threshold: string, windowDays: number | null) => string }> = {
  late_arrivals: { label: "Late Arrivals", reads: (t, w) => `${figure(t)} late in ${plural(w ?? 0, "day")}` },
  missing_clock_out: { label: "Missing Clock-Outs", reads: (t, w) => `${figure(t)} missing in ${plural(w ?? 0, "day")}` },
  approval_ageing: { label: "Approval Ageing", reads: (t) => `Waiting ${days(t)}` },
  document_expiry: { label: "Document Expiry", reads: (t) => `${days(t)} before expiry` },
  confirmation_due: { label: "Confirmation Due", reads: (t) => `${days(t)} before confirmation` },
  contract_ending: { label: "Contract Ending", reads: (t) => `${days(t)} before it ends` },
  partner_inactivity: { label: "Partner Inactivity", reads: (t) => `${days(t)} without contact` },
  budget_threshold: { label: "Budget Threshold", reads: (t) => `${figure(t)}% spent` },
  recruitment_sla: { label: "Recruitment SLA", reads: (t) => `${days(t)} at one stage` },
};

/** A metric the contract still lists. A rule kept from before the list may name one it lacks. */
export const isMetric = (metric: string): metric is MetricKey => Object.hasOwn(alerts.HOME_ALERT_METRICS, metric);

/** The metrics, as the New Rule form offers them. */
export const METRIC_OPTIONS = (Object.keys(alerts.HOME_ALERT_METRICS) as MetricKey[]).map((m): [MetricKey, string] => [m, METRIC[m].label]);

/** A rule's threshold as a person reads it; a metric no longer listed shows its number alone. */
export const ruleLine = (rule: Pick<HomeAlertRule, "metric" | "threshold" | "window_days">) =>
  isMetric(rule.metric) ? METRIC[rule.metric].reads(rule.threshold, rule.window_days) : figure(rule.threshold);

/** Alert Sources: one bar per metric, a metric no longer listed counted under Other. */
export function sourceRows(sources: Array<{ metric: string; count: number }>): Array<{ label: string; count: number }> {
  const merged = new Map<string, number>();
  for (const s of sources) {
    const label = isMetric(s.metric) ? METRIC[s.metric].label : "Other";
    merged.set(label, (merged.get(label) ?? 0) + s.count);
  }
  return [...merged].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/** Who holds a grant, by its action: "people.approve" is held by People's approvers. */
const HOLDERS: Record<string, string> = {
  view: "Viewers",
  create: "Creators",
  edit: "Editors",
  delete: "Deleters",
  approve: "Approvers",
  export: "Exporters",
};

/** Who Can Clear, from a rule's grant (`<module>.<action>`): "people.approve" reads People Approvers. */
export function whoClears(permissionKey: string): string {
  const [module = "", action = ""] = permissionKey.split(".");
  const name = moduleByKey(module)?.label ?? module.charAt(0).toUpperCase() + module.slice(1);
  return `${name} ${HOLDERS[action] ?? action}`;
}

/**
 * What Who Can Clear offers: the grant each metric clears with unless a rule says otherwise
 * (HOME_ALERT_METRICS), each once in the metric list's order, and the rule's own grant when
 * it is another, in the server's words for it when they are to hand.
 */
export function clearerOptions(current: string, currentWords?: string): Array<[string, string]> {
  const options = [...new Set(Object.values(alerts.HOME_ALERT_METRICS).map((m) => m.permission_key))].map((k): [string, string] => [k, whoClears(k)]);
  if (current && !options.some(([k]) => k === current)) options.push([current, currentWords ?? whoClears(current)]);
  return options;
}

/**
 * Over By in the list: "+1" past a count's threshold, the days left before a deadline
 * ("12 days left"), Due Today on the day itself (the server's 0), and Expired once the date
 * has passed (below 0) (home.md §6 Alerts).
 */
export function overByText(a: Pick<HomeAlert, "over_by" | "over_by_kind">): string | null {
  if (a.over_by === null) return null;
  if (a.over_by_kind === "days_left") {
    const left = Number(a.over_by);
    return left < 0 ? "Expired" : left === 0 ? "Due Today" : `${days(a.over_by)} left`;
  }
  if (a.over_by_kind === "over") return `+${figure(a.over_by)}`;
  return figure(a.over_by);
}

/** Over By in the alert's sheet, with the threshold it is past: "+1 over 3". */
export function overByDetail(a: Pick<HomeAlert, "over_by" | "over_by_kind" | "threshold">): string | null {
  const text = overByText(a);
  return text !== null && a.over_by_kind === "over" ? `${text} over ${figure(a.threshold)}` : text;
}

/** How long an alert has been open, in Lagos days: Today, 1 day, 9 days. */
export function ageOf(raisedAt: string, now = new Date()): string {
  const open = Math.round((Date.parse(todayIso(now)) - Date.parse(todayIso(new Date(raisedAt)))) / 86_400_000);
  return open <= 0 ? "Today" : plural(open, "day");
}
