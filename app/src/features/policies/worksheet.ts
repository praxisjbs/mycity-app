import type { AttendanceRules, DeductionMethod, OvertimeApproval, OvertimeMethod, RulePeriod } from "@mycity/contract/contract.gen.ts";
import { toMoneyString } from "@mycity/ui";
import { COUNT_RULES, DEDUCTION_RULES, HOURS_RULES, NUMBER_RULES, type CountRule, type DeductionRule, type VisibleRule } from "./labels";

/**
 * The Attendance worksheet's values and its rules (docs/guides/attendance.md §6.15): one flat form
 * value per control, so each control and its error sit on one field. A nested rule's figure is
 * named by its path with underscores (`late_rule_count`, `overtime_after_minutes`, a weekday's
 * `hours_2_starts_at`), and a contract error on `rules.late_rule.count` lands on the field of the
 * same name. Numbers are kept as typed, so the contract refuses a blank one.
 */

export type WorksheetValues = Record<string, string | boolean>;

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const asNumber = (s: unknown) => (String(s ?? "").trim() === "" ? Number.NaN : Number(s));
const asText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const asMoney = (s: unknown) => (String(s ?? "").trim() === "" ? null : toMoneyString(String(s)));
const moneyText = (m: string | null | undefined) => (m ? m.replace(/\.00$/, "") : "");

/** The form values the worksheet shows for a version's rules. */
export function worksheetValues(r: AttendanceRules): WorksheetValues {
  const v: WorksheetValues = {};
  for (const k of NUMBER_RULES) v[k] = asText(r[k]);
  for (const k of ["office_geofence_mode", "home_geofence_mode", "site_geofence_mode", "device_mode"] as const) v[k] = r[k];
  v.hours_on = Array.isArray(r.hours);
  for (const i of DAYS) {
    const d = r.hours?.[i];
    v[`hours_${i}_working`] = d ? d.working : i < 5;
    v[`hours_${i}_starts_at`] = d?.starts_at ?? (i < 5 ? "09:00" : "");
    v[`hours_${i}_ends_at`] = d?.ends_at ?? (i < 5 ? "17:00" : "");
  }
  for (const k of COUNT_RULES) {
    const rule = r[k];
    v[`${k}_on`] = rule.on;
    v[`${k}_count`] = asText(rule.count);
    v[`${k}_period`] = rule.period;
    v[`${k}_alert`] = rule.alert;
    v[`${k}_query`] = rule.query;
    if ((HOURS_RULES as readonly string[]).includes(k)) v[`${k}_hours`] = asText((rule as { hours?: number | null }).hours);
  }
  for (const k of DEDUCTION_RULES) {
    v[`${k}_on`] = r[k].on;
    v[`${k}_method`] = r[k].method;
    v[`${k}_amount`] = moneyText(r[k].amount);
  }
  v.absence_deduction_on = r.absence_deduction.on;
  v.home_location_on = r.home_location.on;
  const o = r.overtime;
  v.overtime_on = o.on;
  v.overtime_after_minutes = asText(o.after_minutes);
  v.overtime_approval = o.approval;
  v.overtime_method = o.method;
  v.overtime_multiplier = asText(o.multiplier);
  v.overtime_amount = moneyText(o.amount);
  v.overtime_rest_day_multiplier = asText(o.rest_day_multiplier);
  v.overtime_monthly_cap_hours = asText(o.monthly_cap_hours);
  return v;
}

/** The rules the worksheet's values make, over `base` (any rule the worksheet does not show stays). */
export function worksheetRules(base: AttendanceRules, v: WorksheetValues): AttendanceRules {
  const count = (k: CountRule) => ({
    on: v[`${k}_on`] === true,
    count: asNumber(v[`${k}_count`]),
    period: v[`${k}_period`] as RulePeriod,
    alert: v[`${k}_alert`] === true,
    query: v[`${k}_query`] === true,
  });
  const hoursOf = (k: CountRule) => (String(v[`${k}_hours`] ?? "").trim() === "" ? null : asNumber(v[`${k}_hours`]));
  const deduction = (k: DeductionRule) => {
    const method = v[`${k}_method`] as DeductionMethod;
    return { on: v[`${k}_on`] === true, method, amount: method === "pro_rata" ? null : asMoney(v[`${k}_amount`]) };
  };
  const otMethod = v.overtime_method as OvertimeMethod;
  return {
    ...base,
    grace_minutes: asNumber(v.grace_minutes),
    early_grace_minutes: asNumber(v.early_grace_minutes),
    home_radius_m: asNumber(v.home_radius_m),
    max_accuracy_m: asNumber(v.max_accuracy_m),
    clock_out_reminder_minutes: asNumber(v.clock_out_reminder_minutes),
    system_clock_out_after_minutes: asNumber(v.system_clock_out_after_minutes),
    office_geofence_mode: v.office_geofence_mode as AttendanceRules["office_geofence_mode"],
    home_geofence_mode: v.home_geofence_mode as AttendanceRules["home_geofence_mode"],
    site_geofence_mode: v.site_geofence_mode as AttendanceRules["site_geofence_mode"],
    device_mode: v.device_mode as AttendanceRules["device_mode"],
    hours:
      v.hours_on === true
        ? DAYS.map((i) => {
            const working = v[`hours_${i}_working`] === true;
            return {
              weekday: i + 1,
              working,
              starts_at: working ? String(v[`hours_${i}_starts_at`] ?? "") || null : null,
              ends_at: working ? String(v[`hours_${i}_ends_at`] ?? "") || null : null,
            };
          })
        : null,
    late_rule: { ...count("late_rule"), hours: hoursOf("late_rule") },
    late_deduction: deduction("late_deduction"),
    early_rule: { ...count("early_rule"), hours: hoursOf("early_rule") },
    early_deduction: deduction("early_deduction"),
    absence_rule: count("absence_rule"),
    absence_deduction: { on: v.absence_deduction_on === true },
    home_location: { on: v.home_location_on === true },
    forgotten_rule: count("forgotten_rule"),
    location_rule: count("location_rule"),
    overtime: {
      on: v.overtime_on === true,
      after_minutes: asNumber(v.overtime_after_minutes),
      approval: v.overtime_approval as OvertimeApproval,
      method: otMethod,
      multiplier: asNumber(v.overtime_multiplier),
      amount: otMethod === "per_hour" ? asMoney(v.overtime_amount) : null,
      rest_day_multiplier: asNumber(v.overtime_rest_day_multiplier),
      monthly_cap_hours: asNumber(v.overtime_monthly_cap_hours),
    },
  };
}

/**
 * The worksheet field a contract error on the rules belongs to: `rules.late_rule.count` is
 * `late_rule_count`, `rules.hours.2.starts_at` is `hours_2_starts_at`; an error on the hours as a
 * whole sits on Monday's Working.
 */
export function fieldOfRulePath(path: ReadonlyArray<PropertyKey>): string {
  const parts = path.map(String);
  if (parts[0] === "hours" && parts.length === 1) return "hours_0_working";
  return parts.join("_");
}

/** A value with its keys in one order, so two of the same rule compare equal however they were built. */
const sorted = (x: unknown): unknown =>
  Array.isArray(x) ? x.map(sorted) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)])) : x;

/** Whether a rule's value differs from the newest version's: its Changed pill. */
export const ruleChanged = (rule: VisibleRule, newest: AttendanceRules | null, now: AttendanceRules) =>
  newest ? JSON.stringify(sorted(newest[rule])) !== JSON.stringify(sorted(now[rule])) : false;
