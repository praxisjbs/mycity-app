"use strict";
/**
 * The Attendance policy as a rules policy (docs/guides/attendance.md §6.15; docs/guides/policies.md
 * §6.1): its rules are the contract's AttendanceRules, this module enforces them, and this file
 * gives the policies module what it needs to show them: the sections and sentences staff read, the
 * lines a change is listed by, and the values a first draft suggests.
 *
 * VISIBLE is the rules the worksheet and the sentences show. A rule joins it in the PR that makes it
 * do something (§1.2), so nobody is shown a switch, or told a rule, that nothing enforces yet: since
 * PR 3, every rule. The worksheet's words (app/src/features/policies/labels.ts) and the mock's
 * (app/src/api/mock/modules/policies.ts) are kept the same as these.
 */
const c = require("@mycity/contract");
const { formatNaira } = require("../../shared/money/money");
const types = require("../policies/policies.types");

/**
 * The rules shown, in the worksheet's order (§6.15): every rule, now that each does something (PR 3
 * enforced the hours and schedules, the consequence rules, the deductions, overtime and the clock
 * prompts beside PR 1's clock checks).
 */
const VISIBLE = Object.freeze([
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
  "home_location",
  "home_geofence_mode",
  "site_geofence_mode",
  "home_radius_m",
  "max_accuracy_m",
  "device_mode",
  "clock_out_reminder_minutes",
  "system_clock_out_after_minutes",
]);

/** A rule's name, as the worksheet shows it and a change is listed. */
const RULE_LABEL = Object.freeze({
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
  home_location: "Home Location",
  home_geofence_mode: "Home Check",
  site_geofence_mode: "Temporary Site Check",
  home_radius_m: "Home Radius",
  max_accuracy_m: "GPS Accuracy",
  device_mode: "Device Check",
  clock_out_reminder_minutes: "Clock-Out Reminder",
  system_clock_out_after_minutes: "System Clock-Out",
});

const MODE_LABEL = Object.freeze({ off: "Off", warn: "Flag", block: "Refuse" });
const PERIOD_LABEL = Object.freeze({ week: "a week", month: "a month", days_30: "30 days" });
const METHOD_LABEL = Object.freeze({ pro_rata: "Pro-Rata by Minute", per_hour: "Fixed per Hour", per_day: "Fixed per Day" });
const APPROVAL_LABEL = Object.freeze({
  manager_after: "Line Manager After",
  pre_approved: "Pre-Approved",
  automatic: "Automatic",
});
const DAY_SHORT = Object.freeze(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
const DAY_LONG = Object.freeze(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);

const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;
const minutes = (n) => plural(n, "minute");
const metres = (n) => `${n} m`;
/** 1.5 times, 2 times */
const times = (n) => `${Number(n)} times`;
const naira = (amount) => formatNaira(amount);

/**
 * The company hours as runs of days with the same hours: [{from, to, working, starts_at, ends_at}],
 * Monday first. Pure.
 */
function runsOf(hours) {
  const runs = [];
  hours.forEach((d, i) => {
    const last = runs[runs.length - 1];
    const same = last && last.working === d.working && last.starts_at === d.starts_at && last.ends_at === d.ends_at;
    if (same) last.to = i;
    else runs.push({ from: i, to: i, working: d.working, starts_at: d.starts_at, ends_at: d.ends_at });
  });
  return runs;
}

/** "Mon to Fri 09:00 to 17:00, Sat 09:00 to 15:00, Sun Off" */
function hoursValue(hours) {
  if (!Array.isArray(hours)) return "The Working Week";
  return runsOf(hours)
    .map((r) => {
      const days = r.from === r.to ? DAY_SHORT[r.from] : `${DAY_SHORT[r.from]} to ${DAY_SHORT[r.to]}`;
      return r.working ? `${days} ${r.starts_at} to ${r.ends_at}` : `${days} Off`;
    })
    .join(", ");
}

/** "3 in a month or 5 hours, Alert, Raise Query"; Off. */
function countValue(rule) {
  if (!rule.on) return "Off";
  const hours = rule.hours ? ` or ${plural(rule.hours, "hour")}` : "";
  const does = [rule.alert ? "Alert" : null, rule.query ? "Raise Query" : null].filter(Boolean);
  return `${rule.count} in ${PERIOD_LABEL[rule.period]}${hours}${does.length ? `, ${does.join(", ")}` : ""}`;
}

/** "Pro-Rata by Minute", "Fixed per Hour, ₦2,000.00"; Off. */
function deductionValue(d) {
  if (!d.on) return "Off";
  return d.method === "pro_rata" || !d.amount ? METHOD_LABEL[d.method] : `${METHOD_LABEL[d.method]}, ${naira(d.amount)}`;
}

/** "After 30 minutes, Line Manager After, 1.5 times, 2 times on rest days, 20 hours a month"; Off. */
function overtimeValue(o) {
  if (!o.on) return "Off";
  const pay = o.method === "per_hour" ? `${o.amount ? naira(o.amount) : "a fixed amount"} an hour` : times(o.multiplier);
  return [
    `After ${minutes(o.after_minutes)}`,
    APPROVAL_LABEL[o.approval],
    pay,
    `${times(o.rest_day_multiplier)} on rest days`,
    `${plural(o.monthly_cap_hours, "hour")} a month`,
  ].join(", ");
}

/** A rule's value as a person reads it: 10 minutes, Flag, 150 m, 3 in a month, Off. */
function ruleValue(rule, r) {
  switch (rule) {
    case "hours":
      return hoursValue(r.hours);
    case "grace_minutes":
    case "early_grace_minutes":
    case "clock_out_reminder_minutes":
    case "system_clock_out_after_minutes":
      return minutes(r[rule]);
    case "max_accuracy_m":
    case "home_radius_m":
      return metres(r[rule]);
    case "late_rule":
    case "early_rule":
    case "absence_rule":
    case "forgotten_rule":
    case "location_rule":
      return countValue(r[rule]);
    case "late_deduction":
    case "early_deduction":
      return deductionValue(r[rule]);
    case "absence_deduction":
      return r.absence_deduction.on ? "A Day's Pay" : "Off";
    case "home_location":
      return r.home_location.on ? "On" : "Off";
    case "overtime":
      return overtimeValue(r.overtime);
    default:
      return MODE_LABEL[r[rule]] || String(r[rule]);
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The visible rules `after` changes against `before`; none against nothing. */
function changed(before, after) {
  if (!before) return [];
  return VISIBLE.filter((k) => !same(before[k], after[k]));
}

/** Those changes as lines: "Grace Minutes: 5 minutes to 10 minutes". */
function changeLines(before, after) {
  return changed(before, after).map((k) => `${RULE_LABEL[k]}: ${ruleValue(k, before)} to ${ruleValue(k, after)}`);
}

/** The company hours, a run of days a sentence: "Monday to Friday, 09:00 to 17:00." */
function companyHours(r) {
  const own = "Where your own work schedule differs, your schedule applies.";
  if (!Array.isArray(r.hours)) return ["Your hours are the company's working week.", own];
  return [
    ...runsOf(r.hours).map((run) => {
      const days = run.from === run.to ? DAY_LONG[run.from] : `${DAY_LONG[run.from]} to ${DAY_LONG[run.to]}`;
      return run.working ? `${days}, ${run.starts_at} to ${run.ends_at}.` : `${days}, no work.`;
    }),
    own,
  ];
}

function grace(r) {
  return r.grace_minutes > 0
    ? [
        `You have a grace period of ${minutes(r.grace_minutes)} after your start time.`,
        "A clock-in after it counts as late from your start time.",
      ]
    : ["There is no grace period. A clock-in after your start time counts as late."];
}

/** "3 late arrivals in a month, or 5 hours late, reach the limit." and what reaching it does. */
function limit(rule, what, hoursWhat = null) {
  if (!rule.on) return [`${what.many[0].toUpperCase()}${what.many.slice(1)} do not count toward a limit.`];
  const hoursText = rule.hours && hoursWhat ? `, or ${plural(rule.hours, "hour")} ${hoursWhat},` : "";
  const out = [`${plural(rule.count, what.one, what.many)} in ${PERIOD_LABEL[rule.period]}${hoursText} reach the limit.`];
  if (rule.alert && rule.query) out.push("People are alerted and a query is raised. The count then starts again.");
  else if (rule.alert) out.push("People are alerted. The count then starts again.");
  else if (rule.query) out.push("A query is raised. The count then starts again.");
  return out;
}

/** "Each late arrival is deducted from your pay by the minute." */
function deduction(d, what) {
  if (!d.on) return [`${what.many[0].toUpperCase()}${what.many.slice(1)} do not lead to a deduction.`];
  if (d.method === "pro_rata") return [`Each ${what.one} is deducted from your pay by the minute.`];
  if (d.method === "per_hour") return [`Each ${what.one} deducts ${naira(d.amount)} for every hour or part of one.`];
  return [`Each ${what.one} deducts ${naira(d.amount)}.`];
}

function early(r) {
  return r.early_grace_minutes > 0
    ? [`Leaving more than ${minutes(r.early_grace_minutes)} before your end time counts as leaving early.`]
    : ["Leaving before your end time counts as leaving early."];
}

function absence(r) {
  return [
    ...limit(r.absence_rule, { one: "absence", many: "absences" }),
    r.absence_deduction.on ? "Each absent day deducts a day's pay." : "Absences do not lead to a deduction.",
  ];
}

function overtime(o) {
  if (!o.on) return ["Overtime is not paid."];
  const pay =
    o.method === "per_hour"
      ? `It is paid at ${naira(o.amount)} an hour, and on rest days at ${times(o.rest_day_multiplier)} your hourly rate.`
      : `It is paid at ${times(o.multiplier)} your hourly rate, and ${times(o.rest_day_multiplier)} on rest days.`;
  const approval = {
    manager_after: "Your line manager confirms it after the day.",
    pre_approved: "Only overtime approved beforehand is paid.",
    automatic: "It is confirmed automatically.",
  }[o.approval];
  return [
    o.after_minutes > 0
      ? `Work more than ${minutes(o.after_minutes)} past your end time and every minute after it is overtime.`
      : "Every minute worked past your end time is overtime.",
    pay,
    approval,
    `At most ${plural(o.monthly_cap_hours, "hour")} of overtime are paid in a month.`,
  ];
}

function clockPrompts(r) {
  return [
    `Still clocked in after your end time, you are reminded to clock out every ${minutes(r.clock_out_reminder_minutes)}.`,
    `${minutes(r.system_clock_out_after_minutes)} after your end time, the system clocks you out. Your hours count to your end time.`,
  ];
}

function office(mode) {
  if (mode === "off") return ["At the office, your location is recorded with each clock-in and clock-out. Nothing is flagged."];
  if (mode === "warn") return ["At the office, a clock-in outside your office's radius is accepted and sent to People for review."];
  return ["At the office, a clock-in outside your office's radius is refused, and People see it. Clock in again from inside it."];
}

/** Working from home (§6.15): with Home Location off, no home is used and nothing is checked (§1.3). */
function home(on, mode, radius) {
  if (!on) return ["Working from home, your location is not checked."];
  if (mode === "off") return ["Working from home, your location is recorded with each clock-in and clock-out. Nothing is flagged."];
  const away = `Working from home, a clock-in more than ${metres(radius)} from your approved home`;
  return [
    mode === "warn" ? `${away} is accepted and sent for review.` : `${away} is refused, and People see it.`,
    "Until People approve your home, your clock-ins are sent for review.",
  ];
}

/** T14's fixed sentence, at the foot of the site section whatever its mode (§6.11, §6.15). */
const ELSEWHERE = "Working somewhere else? Add it from Home, or ask People.";

/** A temporary site's addresses and its check-ins (§6.11, §6.12): a check-in is never refused. */
function site(mode) {
  if (mode === "off")
    return ["At a temporary site, your location is recorded with each clock-in and check-in. Nothing is flagged.", ELSEWHERE];
  if (mode === "warn")
    return ["At a temporary site, a clock-in or check-in outside its addresses is accepted and sent for review.", ELSEWHERE];
  return [
    "At a temporary site, a clock-in outside its addresses is refused, and People see it.",
    "A check-in outside them is sent for review.",
    ELSEWHERE,
  ];
}

function location(r) {
  // A home's mode counts only while Home Location is on (§1.3).
  const modes = [r.office_geofence_mode, ...(r.home_location.on ? [r.home_geofence_mode] : []), r.site_geofence_mode];
  const checked = modes.some((m) => m !== "off");
  return [
    `Your phone's location must be accurate to within ${metres(r.max_accuracy_m)}. A weaker reading cannot confirm where you are.`,
    ...(checked ? ["When your location cannot be confirmed, your clock-in is sent to People for review."] : []),
  ];
}

function device(mode) {
  if (mode === "off") return ["You can clock in from any device. Each device you use is recorded."];
  if (mode === "warn") return ["A clock-in from a device not registered on My Devices is accepted and sent for review."];
  return ["A clock-in from a device not registered on My Devices is refused. Register it first."];
}

/** The sections staff read, each with the rules that decide its sentences. */
const SECTIONS = Object.freeze([
  { key: "hours", title: "Working Hours", rules: ["hours"], text: (r) => companyHours(r) },
  { key: "clocking_in", title: "Clocking In", rules: ["grace_minutes"], text: (r) => grace(r) },
  {
    key: "late",
    title: "Late Arrivals",
    rules: ["late_rule", "late_deduction"],
    text: (r) => [
      ...limit(r.late_rule, { one: "late arrival", many: "late arrivals" }, "late"),
      ...deduction(r.late_deduction, { one: "late arrival", many: "late arrivals" }),
    ],
  },
  {
    key: "early",
    title: "Leaving Early",
    rules: ["early_grace_minutes", "early_rule", "early_deduction"],
    text: (r) => [
      ...early(r),
      ...limit(r.early_rule, { one: "early departure", many: "early departures" }, "left early"),
      ...deduction(r.early_deduction, { one: "early departure", many: "early departures" }),
    ],
  },
  { key: "absence", title: "Absence", rules: ["absence_rule", "absence_deduction"], text: (r) => absence(r) },
  {
    key: "forgotten",
    title: "Forgotten Clock-Outs",
    rules: ["forgotten_rule"],
    text: (r) => [
      "A System Clock-Out, or a day with no clock-out, is a forgotten clock-out.",
      ...limit(r.forgotten_rule, { one: "forgotten clock-out", many: "forgotten clock-outs" }),
    ],
  },
  {
    key: "location_flags",
    title: "Location Flags",
    rules: ["location_rule"],
    text: (r) => [
      "A clock-in or clock-out outside your place of work is a location flag.",
      ...limit(r.location_rule, { one: "location flag", many: "location flags" }),
    ],
  },
  { key: "overtime", title: "Overtime", rules: ["overtime"], text: (r) => overtime(r.overtime) },
  { key: "office", title: "At the Office", rules: ["office_geofence_mode"], text: (r) => office(r.office_geofence_mode) },
  {
    key: "home",
    title: "Working From Home",
    rules: ["home_location", "home_geofence_mode", "home_radius_m"],
    text: (r) => home(r.home_location.on, r.home_geofence_mode, r.home_radius_m),
  },
  { key: "site", title: "At a Temporary Site", rules: ["site_geofence_mode"], text: (r) => site(r.site_geofence_mode) },
  { key: "location", title: "Your Location", rules: ["max_accuracy_m"], text: (r) => location(r) },
  { key: "devices", title: "Your Devices", rules: ["device_mode"], text: (r) => device(r.device_mode) },
  {
    key: "clock_prompts",
    title: "Clocking Out",
    rules: ["clock_out_reminder_minutes", "system_clock_out_after_minutes"],
    text: (r) => clockPrompts(r),
  },
]);

/** Each section's sentences for these rules, tagged when `changedKeys` touches the section. */
function sections(rules, changedKeys = []) {
  return SECTIONS.map((sec) => {
    const touched = sec.rules.some((k) => changedKeys.includes(k));
    return {
      key: sec.key,
      title: sec.title,
      sentences: sec.text(rules).map((text, i) => ({ key: `${sec.key}.${i}`, text, changed: touched })),
    };
  });
}

/** The company hours §6.15 suggests: Monday to Friday 09:00 to 17:00, Saturday 09:00 to 15:00, Sunday Off (A22). */
const SUGGESTED_HOURS = Object.freeze(
  [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    Object.freeze(
      weekday <= 5
        ? { weekday, working: true, starts_at: "09:00", ends_at: "17:00" }
        : weekday === 6
          ? { weekday, working: true, starts_at: "09:00", ends_at: "15:00" }
          : { weekday, working: false, starts_at: null, ends_at: null },
    ),
  ),
);

/**
 * The rules a first draft starts from (§6.15's Suggested column): the defaults with the suggested
 * hours, grace and figures. Every consequence rule, deduction and overtime stays off (T5), and so
 * does Home Location (§1.3, H2): People switch each on, and its figures are already filled in.
 */
function suggestions() {
  const r = c.attendance.AttendanceRules.parse({});
  return {
    ...r,
    hours: SUGGESTED_HOURS.map((d) => ({ ...d })),
    grace_minutes: 5,
    late_rule: { on: false, count: 3, period: "month", hours: 5, alert: true, query: true },
    late_deduction: { on: false, method: "pro_rata", amount: null },
    early_grace_minutes: 5,
    early_rule: { on: false, count: 3, period: "month", hours: null, alert: true, query: true },
    early_deduction: { on: false, method: "pro_rata", amount: null },
    absence_rule: { on: false, count: 2, period: "month", alert: true, query: true },
    absence_deduction: { on: false },
    forgotten_rule: { on: false, count: 3, period: "month", alert: true, query: false },
    location_rule: { on: false, count: 3, period: "month", alert: true, query: false },
    overtime: {
      on: false,
      after_minutes: 30,
      approval: "manager_after",
      method: "multiplier",
      multiplier: 1.5,
      amount: null,
      rest_day_multiplier: 2,
      monthly_cap_hours: 20,
    },
    device_mode: "warn",
    clock_out_reminder_minutes: 30,
    system_clock_out_after_minutes: 90,
  };
}

types.register("attendance", {
  title: "Attendance Policy",
  read: c.attendance.AttendanceRules,
  draft: c.attendance.AttendanceRulesDraft,
  suggestions,
  sections,
  changed,
  changeLines,
});

module.exports = {
  VISIBLE,
  RULE_LABEL,
  MODE_LABEL,
  SUGGESTED_HOURS,
  ruleValue,
  changed,
  changeLines,
  sections,
  suggestions,
};
