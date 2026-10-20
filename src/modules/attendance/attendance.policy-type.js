"use strict";
/**
 * The Attendance policy as a rules policy (docs/guides/attendance.md §6.15; docs/guides/policies.md
 * §6.1): its rules are the contract's AttendanceRules, this module enforces them, and this file
 * gives the policies module what it needs to show them: the sections and sentences staff read, the
 * lines a change is listed by, and the values a first draft suggests.
 *
 * VISIBLE is the rules the worksheet and the sentences show. A rule joins it in the PR that makes it
 * do something (§1.2), so nobody is shown a switch, or told a rule, that nothing enforces yet.
 */
const c = require("@mycity/contract");
const types = require("../policies/policies.types");

/** The rules shown today, in the worksheet's order (PR 1: the clock checks that are enforced). */
const VISIBLE = Object.freeze([
  "grace_minutes",
  "office_geofence_mode",
  "home_geofence_mode",
  "site_geofence_mode",
  "home_radius_m",
  "max_accuracy_m",
  "device_mode",
]);

/** A rule's name, as the worksheet shows it and a change is listed. */
const RULE_LABEL = Object.freeze({
  grace_minutes: "Grace Minutes",
  office_geofence_mode: "Office Check",
  home_geofence_mode: "Home Check",
  site_geofence_mode: "Field Site Check",
  home_radius_m: "Home Radius",
  max_accuracy_m: "GPS Accuracy",
  device_mode: "Device Check",
});

const MODE_LABEL = Object.freeze({ off: "Off", warn: "Flag", block: "Refuse" });

const minutes = (n) => `${n} minute${n === 1 ? "" : "s"}`;
const metres = (n) => `${n} m`;

/** A rule's value as a person reads it: 10 minutes, Flag, 150 m. */
function ruleValue(rule, r) {
  if (rule === "grace_minutes") return minutes(r.grace_minutes);
  if (rule === "max_accuracy_m" || rule === "home_radius_m") return metres(r[rule]);
  return MODE_LABEL[r[rule]] || String(r[rule]);
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

function grace(r) {
  return r.grace_minutes > 0
    ? [`You have a grace period of ${minutes(r.grace_minutes)} after your resumption time. A clock-in after it counts as late.`]
    : ["There is no grace period. A clock-in after your resumption time counts as late."];
}

function office(mode) {
  if (mode === "off") return ["At the office, your location is recorded with each clock-in and clock-out. Nothing is flagged."];
  if (mode === "warn") return ["At the office, a clock-in outside your office's radius is accepted and sent to People for review."];
  return ["At the office, a clock-in outside your office's radius is refused, and People see it. Clock in again from inside it."];
}

function home(mode, radius) {
  if (mode === "off") return ["Working from home, your location is recorded with each clock-in and clock-out. Nothing is flagged."];
  const away = `Working from home, a clock-in more than ${metres(radius)} from your approved home`;
  return [
    mode === "warn" ? `${away} is accepted and sent for review.` : `${away} is refused, and People see it.`,
    "Until People approve your home, your clock-ins are sent for review.",
  ];
}

function site(mode) {
  if (mode === "off") return ["At a field site or client visit, your location is recorded with each clock-in. Nothing is flagged."];
  if (mode === "warn") return ["At a field site or client visit, a clock-in outside the site's radius is accepted and sent for review."];
  return ["At a field site or client visit, a clock-in outside the site's radius is refused, and People see it."];
}

function location(r) {
  const checked = [r.office_geofence_mode, r.home_geofence_mode, r.site_geofence_mode].some((m) => m !== "off");
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
  { key: "clocking_in", title: "Clocking In", rules: ["grace_minutes"], text: (r) => grace(r) },
  { key: "office", title: "At the Office", rules: ["office_geofence_mode"], text: (r) => office(r.office_geofence_mode) },
  {
    key: "home",
    title: "Working From Home",
    rules: ["home_geofence_mode", "home_radius_m"],
    text: (r) => home(r.home_geofence_mode, r.home_radius_m),
  },
  { key: "site", title: "At a Field Site", rules: ["site_geofence_mode"], text: (r) => site(r.site_geofence_mode) },
  { key: "location", title: "Your Location", rules: ["max_accuracy_m"], text: (r) => location(r) },
  { key: "devices", title: "Your Devices", rules: ["device_mode"], text: (r) => device(r.device_mode) },
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

/** The rules a first draft starts from: the defaults, with the values the meetings suggested. */
function suggestions() {
  return { ...c.attendance.AttendanceRules.parse({}), grace_minutes: 5, device_mode: "warn" };
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

module.exports = { VISIBLE, RULE_LABEL, MODE_LABEL, ruleValue, changed, changeLines, sections, suggestions };
