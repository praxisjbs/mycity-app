import type {
  AttendanceRule,
  DeductionMethod,
  OvertimeApproval,
  OvertimeMethod,
  PolicyKind,
  PolicyMode,
  PolicyState,
  RulePeriod,
  VersionState,
  WorkPattern,
} from "@mycity/contract/contract.gen.ts";
import { formatDate } from "@mycity/ui";

/**
 * The words policies are shown with (docs/guides/policies.md §10): states, types and, for the
 * Attendance worksheet, each rule's label and value. The server sends values, never these words.
 */

type Tone = "ok" | "info" | "warn" | "neutral";

export const POLICY_STATE: Record<PolicyState, { tone: Tone; text: string }> = {
  draft: { tone: "neutral", text: "Draft" },
  awaiting_approval: { tone: "info", text: "Awaiting Approval" },
  waiting: { tone: "info", text: "Starts Soon" },
  in_force: { tone: "ok", text: "In Force" },
  archived: { tone: "neutral", text: "Archived" },
};

export const VERSION_STATE: Record<VersionState, { tone: Tone; text: string }> = {
  in_force: { tone: "ok", text: "In Force" },
  waiting: { tone: "info", text: "Waiting" },
  past: { tone: "neutral", text: "Replaced" },
  withdrawn: { tone: "neutral", text: "Withdrawn" },
  awaiting_approval: { tone: "info", text: "Awaiting Approval" },
};

/** A version's state, a waiting one with its first day. */
export const versionPill = (state: VersionState, from: string) =>
  state === "waiting" ? { tone: "info" as const, text: `Starts ${formatDate(from)}` } : VERSION_STATE[state];

export const KIND_LABEL: Record<PolicyKind, string> = { document: "Document", attendance: "Attendance" };

export const PATTERN_LABEL: Record<WorkPattern, string> = { on_site: "On-Site", hybrid: "Hybrid", remote: "Remote" };

/**
 * The Attendance rules the worksheet shows: every rule, now that each does something
 * (attendance.policy-type.js VISIBLE, in the same order). A rule joins in the PR that makes it do
 * something.
 */
export const VISIBLE_RULES = [
  "hours",
  "grace_minutes",
  "late_rule",
  "late_deduction",
  "early_grace_minutes",
  "early_rule",
  "early_deduction",
  "absence_rule",
  "absence_deduction",
  "forgotten_rule",
  "location_rule",
  "overtime",
  "office_geofence_mode",
  "home_geofence_mode",
  "site_geofence_mode",
  "home_radius_m",
  "max_accuracy_m",
  "device_mode",
  "clock_out_reminder_minutes",
  "system_clock_out_after_minutes",
] as const satisfies readonly AttendanceRule[];
export type VisibleRule = (typeof VISIBLE_RULES)[number];
export type ModeRule = Extract<VisibleRule, `${string}_mode`>;
/** A rule that is one whole number. */
export type NumberRule = "grace_minutes" | "early_grace_minutes" | "home_radius_m" | "max_accuracy_m" | "clock_out_reminder_minutes" | "system_clock_out_after_minutes";
/** A rule counted over a period: N times (or H hours) in a week, a month or 30 days. */
export type CountRule = "late_rule" | "early_rule" | "absence_rule" | "forgotten_rule" | "location_rule";
/** A rule whose switch opens a deduction's method and amount. */
export type DeductionRule = "late_deduction" | "early_deduction";

export const NUMBER_RULES: readonly NumberRule[] = [
  "grace_minutes",
  "early_grace_minutes",
  "home_radius_m",
  "max_accuracy_m",
  "clock_out_reminder_minutes",
  "system_clock_out_after_minutes",
];
export const COUNT_RULES: readonly CountRule[] = ["late_rule", "early_rule", "absence_rule", "forgotten_rule", "location_rule"];
export const DEDUCTION_RULES: readonly DeductionRule[] = ["late_deduction", "early_deduction"];
/** The count rules that may also be reached by hours. */
export const HOURS_RULES: readonly CountRule[] = ["late_rule", "early_rule"];

export const RULE_LABEL: Record<VisibleRule, string> = {
  hours: "Company Hours",
  grace_minutes: "Grace Minutes",
  late_rule: "Late Arrivals",
  late_deduction: "Late Deduction",
  early_grace_minutes: "Early Grace Minutes",
  early_rule: "Early Departures",
  early_deduction: "Early Deduction",
  absence_rule: "Absences",
  absence_deduction: "Absence Deduction",
  forgotten_rule: "Forgotten Clock-Outs",
  location_rule: "Location Flags",
  overtime: "Overtime",
  office_geofence_mode: "Office Check",
  home_geofence_mode: "Home Check",
  site_geofence_mode: "Temporary Site Check",
  home_radius_m: "Home Radius",
  max_accuracy_m: "GPS Accuracy",
  device_mode: "Device Check",
  clock_out_reminder_minutes: "Clock-Out Reminder",
  system_clock_out_after_minutes: "System Clock-Out",
};

/** What each rule decides, behind its label. */
export const RULE_HELP: Record<VisibleRule, string> = {
  hours: "The hours everyone works unless their own schedule says otherwise. Off: the working week in Settings, Organisation.",
  grace_minutes: "Minutes after the start before a clock-in counts as late. Once past it, lateness counts from the start.",
  late_rule: "How many late arrivals, or late hours, in a period before People are alerted or a query is raised. The count then starts again.",
  late_deduction: "Each late day becomes a pending deduction People may waive.",
  early_grace_minutes: "Minutes before the end someone may leave without it counting as leaving early.",
  early_rule: "How many early departures, or hours left early, in a period before People are alerted or a query is raised.",
  early_deduction: "Each early departure becomes a pending deduction People may waive.",
  absence_rule: "How many absent days in a period before People are alerted or a query is raised.",
  absence_deduction: "Each absent day becomes a pending deduction of a day's pay.",
  forgotten_rule: "System Clock-Outs and days with no clock-out, counted over a period.",
  location_rule: "Clock-ins outside a place of work that still stand, counted over a period.",
  overtime: "Minutes worked past the end, and every minute on a day not worked, paid as approved.",
  office_geofence_mode: "A clock-in outside the office's radius. Flag: accepted and sent to People to review. Refuse: not accepted.",
  home_geofence_mode: "A clock-in away from an approved home. Flag: accepted and sent to People to review. Refuse: not accepted.",
  site_geofence_mode: "A clock-in outside a temporary site's addresses. Flag: accepted and sent to People to review. Refuse: not accepted. A check-in outside them is flagged under either.",
  home_radius_m: "How far from an approved home a clock-in still counts as at home. At least 150 m.",
  max_accuracy_m: "A phone reading less accurate than this cannot confirm where someone is.",
  device_mode: "A clock-in from a device the person has not registered. Flag: accepted and sent to People to review. Refuse: not accepted.",
  clock_out_reminder_minutes: "How often someone still clocked in after the end is reminded to clock out.",
  system_clock_out_after_minutes: "How long after the end the system clocks someone out. Their hours count to the end.",
};

export const MODE_LABEL: Record<PolicyMode, string> = { off: "Off", warn: "Flag", block: "Refuse" };

/** The modes a new version may set: a home and a temporary site are never Off. */
export const MODES_FOR: Record<ModeRule, readonly PolicyMode[]> = {
  office_geofence_mode: ["off", "warn", "block"],
  home_geofence_mode: ["warn", "block"],
  site_geofence_mode: ["warn", "block"],
  device_mode: ["off", "warn", "block"],
};

export const PERIOD_LABEL: Record<RulePeriod, string> = { week: "Week", month: "Month", days_30: "30 Days" };
export const METHOD_LABEL: Record<DeductionMethod, string> = { pro_rata: "Pro-Rata by Minute", per_hour: "Fixed per Hour", per_day: "Fixed per Day" };
export const APPROVAL_LABEL: Record<OvertimeApproval, string> = {
  manager_after: "Line Manager After",
  pre_approved: "Pre-Approved",
  automatic: "Automatic",
};
export const OVERTIME_METHOD_LABEL: Record<OvertimeMethod, string> = { multiplier: "Multiple of Hourly Rate", per_hour: "Fixed per Hour" };
export const WEEKDAY_LABEL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** The worksheet's cards, each with its rules, in order (attendance.md §6.15). */
export const WORKSHEET: ReadonlyArray<{ title: string; rules: readonly VisibleRule[] }> = [
  { title: "Working Hours", rules: ["hours"] },
  { title: "Lateness", rules: ["grace_minutes"] },
  { title: "Late Arrivals", rules: ["late_rule", "late_deduction"] },
  { title: "Early Departure", rules: ["early_grace_minutes", "early_rule", "early_deduction"] },
  { title: "Absence", rules: ["absence_rule", "absence_deduction"] },
  { title: "Forgotten Clock-Outs", rules: ["forgotten_rule"] },
  { title: "Location Flags", rules: ["location_rule"] },
  { title: "Overtime", rules: ["overtime"] },
  { title: "Location Checks", rules: ["office_geofence_mode", "home_geofence_mode", "site_geofence_mode", "home_radius_m", "max_accuracy_m"] },
  { title: "Devices", rules: ["device_mode"] },
  { title: "Clock Prompts", rules: ["clock_out_reminder_minutes", "system_clock_out_after_minutes"] },
];
