import alerts from "@mycity/contract/schemas/alerts.js";
import type reports from "@mycity/contract/schemas/reports.js";
import type {
  HomeActivityItem,
  HomeAlert,
  HomeAlertRule,
  HomeReportRecipient,
  HomeReportRunStatus,
  HomeReportSchedule,
  HomeReportStatus,
  HomeRosterStatus,
} from "@mycity/contract/contract.gen.ts";
import { formatCount, plural, todayIso } from "@mycity/ui";
import { moduleByKey } from "@/shell/catalogue";

/**
 * The words Home shows for the API's values (docs/guides/home.md §10.1). The server sends
 * keys and figures; the screen words them here, once, so the Overview, Team, Alerts and
 * Reports say the same thing and the screen gates read every word.
 */
type Tone = "ok" | "warn" | "err" | "info" | "neutral";

/** A person's status today on the shared attendance roster. */
export const ROSTER_STATUS: Record<HomeRosterStatus, { tone: Tone; text: string }> = {
  on_site: { tone: "ok", text: "On Site" },
  remote: { tone: "ok", text: "Remote" },
  field: { tone: "ok", text: "Field" },
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

/* ------------------------------------------------------------------ *
 * Reports (home.md §6 Reports, §10.1)
 * ------------------------------------------------------------------ */

/** A source a report runs, as the contract lists them (HOME_REPORT_SOURCES). */
export type ReportSourceKey = keyof typeof reports.HOME_REPORT_SOURCES;

/** What each source reports on, by the contract's sources (HOME_REPORT_SOURCES, in the form's order). */
export const REPORT_SOURCE: Record<ReportSourceKey, string> = {
  daily_attendance: "Daily Attendance",
  leave: "Leave",
  open_alerts: "Open Alerts",
  headcount: "Headcount",
  tasks: "Tasks",
  partnerships: "Partnerships",
  expenses: "Expenses",
  recruitment: "Recruitment",
  overview: "Overview",
};

/** A source's name; one the contract no longer lists reads as Other, never as its key. */
export const sourceName = (key: string): string => (Object.hasOwn(REPORT_SOURCE, key) ? REPORT_SOURCE[key as ReportSourceKey] : "Other");

/** A report's pill: running on its schedule, paused, or run only when someone asks. */
export const REPORT_STATUS: Record<HomeReportStatus, { tone: Tone; text: string }> = {
  scheduled: { tone: "ok", text: "Scheduled" },
  paused: { tone: "warn", text: "Paused" },
  on_demand: { tone: "info", text: "On Demand" },
};

/** An archived report's pill, where a link opens one: it neither changes nor runs. */
export const REPORT_ARCHIVED = { tone: "neutral", text: "Archived" } as const satisfies { tone: Tone; text: string };

/** A run whose file is there, in a run's sheet, where Download is its own button. */
export const RUN_DONE = { tone: "ok", text: "Done" } as const satisfies { tone: Tone; text: string };

/** A run whose file is not there to download: still being made, failed, or not made for its recipient. */
export const RUN_STATUS: Record<Exclude<HomeReportRunStatus, "done">, { tone: Tone; text: string }> = {
  pending: { tone: "info", text: "Pending" },
  failed: { tone: "err", text: "Failed" },
  skipped: { tone: "neutral", text: "Skipped" },
};

/** A leave request's status, for the Leave source's filter (the contract's LeaveStatus). */
export const LEAVE_STATUS: Record<"submitted" | "approved" | "rejected" | "cancelled", string> = {
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** A file's format, as people name it (HOME_REPORT_FORMATS). */
const REPORT_FORMAT: Record<string, string> = { pdf: "PDF", xlsx: "XLSX" };
export const formatName = (format: string): string => REPORT_FORMAT[format] ?? format.toUpperCase();

/** Weekdays as the recurrence rule numbers them: 1 is Monday, 7 is Sunday. */
const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The short names the form's Days offer, Monday first. */
export const WEEKDAY_SHORT = WEEKDAY.map((d) => d.slice(0, 3));

/** The ISO weekday of a date: 1 Monday to 7 Sunday. */
export const isoWeekday = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** "Mondays", "Mondays and Fridays", "Mondays, Wednesdays and Fridays". */
function joined(words: string[]): string {
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The days a weekly rule runs on: a run of days reads as one span ("Monday to Friday"). */
function weekdays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  const span = sorted.length > 2 && sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (span) return `${WEEKDAY[sorted[0] - 1]} to ${WEEKDAY[sorted[sorted.length - 1] - 1]}`;
  return joined(sorted.map((d) => `${WEEKDAY[d - 1]}s`));
}

/** 1st, 2nd, 3rd, 4th, 11th, 21st. */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/**
 * A schedule as the report card reads it: "Every working day at 18:00", "Mondays and Fridays
 * at 08:00", "Monthly on the last day at 17:00", "Every 2 weeks on Mondays at 08:00". A weekly
 * rule with no days runs on its start date's weekday, a monthly one on its start date's day,
 * as the recurrence rule reads them (src/shared/time/recurrence.js).
 */
export function scheduleLine(s: Pick<HomeReportSchedule, "recurrence" | "starts_on" | "run_time">): string {
  const r = s.recurrence;
  const every = r.interval && r.interval > 1 ? r.interval : 1;
  let when: string;
  if (r.freq === "daily") {
    const unit = r.working_days_only ? "working day" : "day";
    when = every === 1 ? `Every ${unit}` : `Every ${every} days${r.working_days_only ? ", working days only" : ""}`;
  } else if (r.freq === "weekly") {
    const days = weekdays(r.by_weekday ?? [isoWeekday(s.starts_on)]);
    if (every === 1) when = days;
    else when = days === "Every day" ? `Every day, every ${every} weeks` : `Every ${every} weeks on ${days}`;
  } else {
    const day = r.by_month_day ?? Number(s.starts_on.slice(8, 10));
    const on = day === -1 ? "the last day" : `the ${ordinal(day)}`;
    when = every === 1 ? `Monthly on ${on}` : `Every ${every} months on ${on}`;
  }
  return `${when} at ${s.run_time}`;
}

/** Who a schedule goes to: two names, then how many more ("Ada Obi, Tolu Ade and 3 more"). */
export function audienceLine(audience: Array<Pick<HomeReportRecipient, "display_name">>): string | null {
  const names = audience.map((a) => a.display_name);
  if (names.length === 0) return null;
  if (names.length <= 3) return joined(names);
  return `${names.slice(0, 2).join(", ")} and ${formatCount(names.length - 2)} more`;
}
