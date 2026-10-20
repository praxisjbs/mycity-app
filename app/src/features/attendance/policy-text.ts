import type { PolicyMode, PolicyRule, PolicySettings, PolicyVersionState } from "@mycity/contract/contract.gen.ts";

/**
 * The attendance policy in words (docs/guides/attendance.md §6.15, §10): one sentence for each rule
 * and mode, with the values People set filled in, so a changed value changes the sentence. Staff
 * read these on Policy Updates; Settings · Attendance Policy names the same rules. The server sends
 * the values, never prose.
 */

/** A rule's name, as Settings shows it and a change is listed. */
export const RULE_LABEL: Record<PolicyRule, string> = {
  grace_minutes: "Grace Minutes",
  office_geofence_mode: "Office Check",
  home_geofence_mode: "Home Check",
  site_geofence_mode: "Field Site Check",
  device_mode: "Device Check",
  max_accuracy_m: "GPS Accuracy",
  home_radius_m: "Home Radius",
};

export const MODE_LABEL: Record<PolicyMode, string> = { off: "Off", warn: "Warn", block: "Block" };

/** A version's state as a pill. */
export const VERSION_STATE: Record<PolicyVersionState, { tone: "ok" | "info" | "neutral"; text: string }> = {
  in_force: { tone: "ok", text: "In Force" },
  waiting: { tone: "info", text: "Waiting" },
  past: { tone: "neutral", text: "Replaced" },
  withdrawn: { tone: "neutral", text: "Withdrawn" },
};

const minutes = (n: number) => `${n} minute${n === 1 ? "" : "s"}`;
const metres = (n: number) => `${n} m`;

/** A rule's value as a person reads it: 10 minutes, Block, 100 m. */
export function ruleValue(rule: PolicyRule, s: PolicySettings): string {
  switch (rule) {
    case "grace_minutes":
      return minutes(s.grace_minutes);
    case "max_accuracy_m":
      return metres(s.max_accuracy_m);
    case "home_radius_m":
      return metres(s.home_radius_m);
    default:
      return MODE_LABEL[s[rule]];
  }
}

/** The sections the policy is read in, each with the rules that decide its sentences. */
export const POLICY_SECTIONS: ReadonlyArray<{ title: string; rules: readonly PolicyRule[] }> = [
  { title: "Clocking In", rules: ["grace_minutes"] },
  { title: "At the Office", rules: ["office_geofence_mode"] },
  { title: "Working From Home", rules: ["home_geofence_mode", "home_radius_m"] },
  { title: "At a Field Site", rules: ["site_geofence_mode"] },
  { title: "Your Location", rules: ["max_accuracy_m"] },
  { title: "Your Devices", rules: ["device_mode"] },
];

function grace(s: PolicySettings): string[] {
  return s.grace_minutes > 0
    ? [`You have a grace period of ${minutes(s.grace_minutes)} after your resumption time. A clock-in after it counts as late.`]
    : ["There is no grace period. A clock-in after your resumption time counts as late."];
}

function office(mode: PolicyMode): string[] {
  if (mode === "off") return ["At the office, your location is recorded with each clock-in and clock-out. Nothing is flagged."];
  if (mode === "warn") return ["At the office, a clock-in outside your office's radius is accepted and sent to People for review."];
  return ["At the office, a clock-in outside your office's radius is refused. Clock in again from inside it."];
}

function home(mode: PolicyMode, radius: number): string[] {
  if (mode === "off") return ["Working from home, your location is recorded with each clock-in and clock-out. Nothing is flagged."];
  const away = `Working from home, a clock-in more than ${metres(radius)} from your approved home`;
  return [
    mode === "warn" ? `${away} is accepted and sent for review.` : `${away} is refused.`,
    "Until People approve your home, your clock-ins are sent for review.",
  ];
}

function site(mode: PolicyMode): string[] {
  if (mode === "off") return ["At a field site or client visit, your location is recorded with each clock-in. Nothing is flagged."];
  if (mode === "warn") return ["At a field site or client visit, a clock-in outside the site's radius is accepted and sent for review."];
  return ["At a field site or client visit, a clock-in outside the site's radius is refused."];
}

function location(s: PolicySettings): string[] {
  const checked = [s.office_geofence_mode, s.home_geofence_mode, s.site_geofence_mode].some((m) => m !== "off");
  return [
    `Your phone's location must be accurate to within ${metres(s.max_accuracy_m)}. A weaker reading cannot confirm where you are.`,
    ...(checked ? ["When your location cannot be confirmed, your clock-in is sent to People for review."] : []),
  ];
}

function device(mode: PolicyMode): string[] {
  if (mode === "off") return ["You can clock in from any device. Each device you use is recorded."];
  if (mode === "warn") return ["A clock-in from a device not registered on My Devices is accepted and sent for review."];
  return ["A clock-in from a device not registered on My Devices is refused. Register it first."];
}

/** Each section's sentences for these rules, and whether `changed` touches it. */
export function policySentences(s: PolicySettings, changed: readonly PolicyRule[] = []) {
  const text: Record<string, string[]> = {
    "Clocking In": grace(s),
    "At the Office": office(s.office_geofence_mode),
    "Working From Home": home(s.home_geofence_mode, s.home_radius_m),
    "At a Field Site": site(s.site_geofence_mode),
    "Your Location": location(s),
    "Your Devices": device(s.device_mode),
  };
  return POLICY_SECTIONS.map((sec) => ({
    title: sec.title,
    sentences: text[sec.title],
    changed: sec.rules.some((r) => changed.includes(r)),
  }));
}
