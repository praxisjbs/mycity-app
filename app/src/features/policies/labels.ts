import type { AttendanceRule, AttendanceRules, PolicyKind, PolicyMode, PolicyState, VersionState, WorkPattern } from "@mycity/contract/contract.gen.ts";
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
 * The Attendance rules the worksheet shows: the ones something enforces today
 * (attendance.policy-type.js VISIBLE). A rule joins in the PR that makes it do something.
 */
export const VISIBLE_RULES = [
  "grace_minutes",
  "office_geofence_mode",
  "home_geofence_mode",
  "site_geofence_mode",
  "home_radius_m",
  "max_accuracy_m",
  "device_mode",
] as const satisfies readonly AttendanceRule[];
export type VisibleRule = (typeof VISIBLE_RULES)[number];
export type ModeRule = Extract<VisibleRule, `${string}_mode`>;
export type NumberRule = Exclude<VisibleRule, ModeRule>;

export const RULE_LABEL: Record<VisibleRule, string> = {
  grace_minutes: "Grace Minutes",
  office_geofence_mode: "Office Check",
  home_geofence_mode: "Home Check",
  site_geofence_mode: "Temporary Site Check",
  home_radius_m: "Home Radius",
  max_accuracy_m: "GPS Accuracy",
  device_mode: "Device Check",
};

/** What each rule decides, behind its label. */
export const RULE_HELP: Record<VisibleRule, string> = {
  grace_minutes: "Minutes after the start of the day before a clock-in counts as late.",
  office_geofence_mode: "A clock-in outside the office's radius. Flag: accepted and sent to People to review. Refuse: not accepted.",
  home_geofence_mode: "A clock-in away from an approved home. Flag: accepted and sent to People to review. Refuse: not accepted.",
  site_geofence_mode: "A clock-in outside a temporary site's addresses. Flag: accepted and sent to People to review. Refuse: not accepted. A check-in outside them is flagged under either.",
  home_radius_m: "How far from an approved home a clock-in still counts as at home. At least 150 m.",
  max_accuracy_m: "A phone reading less accurate than this cannot confirm where someone is.",
  device_mode: "A clock-in from a device the person has not registered. Flag: accepted and sent to People to review. Refuse: not accepted.",
};

export const MODE_LABEL: Record<PolicyMode, string> = { off: "Off", warn: "Flag", block: "Refuse" };

/** The modes a new version may set: a home and a temporary site are never Off. */
export const MODES_FOR: Record<ModeRule, readonly PolicyMode[]> = {
  office_geofence_mode: ["off", "warn", "block"],
  home_geofence_mode: ["warn", "block"],
  site_geofence_mode: ["warn", "block"],
  device_mode: ["off", "warn", "block"],
};

/** The worksheet's cards, each with its rules, in order. */
export const WORKSHEET: ReadonlyArray<{ title: string; rules: readonly VisibleRule[] }> = [
  { title: "Lateness", rules: ["grace_minutes"] },
  { title: "Location Checks", rules: ["office_geofence_mode", "home_geofence_mode", "site_geofence_mode", "home_radius_m", "max_accuracy_m"] },
  { title: "Devices", rules: ["device_mode"] },
];

/** A rule's value as a person reads it: 10 minutes, Flag, 150 m. */
export function ruleValue(rule: VisibleRule, r: AttendanceRules): string {
  if (rule === "grace_minutes") return `${r.grace_minutes} minute${r.grace_minutes === 1 ? "" : "s"}`;
  if (rule === "home_radius_m" || rule === "max_accuracy_m") return `${r[rule]} m`;
  return MODE_LABEL[r[rule]];
}
