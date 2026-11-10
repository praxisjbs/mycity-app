"use strict";
/**
 * The payroll setting as it stood on a date (docs/guides/payroll.md §4.2, §6.11). It is effective-dated
 * (`shared/db/effective-dated`): read here with `versionOn`, written with `addVersion` by the settings
 * route (PR 5). With no row the run is simple, the pay day is the default 30 and bank details are a
 * warning; nothing is seeded (A26), so the defaults below are the whole of "no setting".
 *
 *   settingOn(db, date)   the version in force on a date, or the defaults
 *   payDayOf(setting)     the pay day, 30 when none is set
 *   payDateOf(setting, period)   the day a month is paid: the pay day, or the month's last day when it is past
 *   payDateFor(db, period)       the same, with the setting in force on the month's last day
 *   nextPayDate(db, today, isPaid)  the next pay date on or after today whose run is not paid
 *
 * A run reads the setting on its period's first day, so the mode a month was computed in is the mode of
 * that month, whenever it is computed (§6.11 rule 2).
 */
const effective = require("../../shared/db/effective-dated");
const { AppError } = require("../../shared/errors");
const lagos = require("../../shared/time/lagos");

/** The pay day when MyCity has set none (§13.1 item 24): shown on Configurations as "30 (default)". */
const DEFAULT_PAY_DAY = 30;

/** What "no setting" means: simple mode, the default pay day, bank details a warning, no conventions. */
const DEFAULTS = Object.freeze({
  payroll_setting_id: null,
  advanced_enabled: false,
  pay_day: null,
  require_bank_details: false,
  paye_basis: null,
  pension_reduces_taxable: null,
  nhf_reduces_taxable: null,
  effective_from: null,
  effective_to: null,
});

const COLUMNS = `payroll_setting_id, advanced_enabled, pay_day, require_bank_details, paye_basis,
  pension_reduces_taxable, nhf_reduces_taxable, effective_from::text AS effective_from,
  effective_to::text AS effective_to`;

/**
 * The version of the setting in force on `date` (YYYY-MM-DD), or the defaults.
 * @param {{query: Function}} db
 * @param {string} date
 */
async function settingOn(db, date) {
  const row = await effective.versionOn(db, { table: "payroll_setting", key: { scope: "organisation" }, on: date, columns: COLUMNS });
  return row ? { ...row, pay_day: row.pay_day === null ? null : Number(row.pay_day) } : { ...DEFAULTS };
}

/** The pay day of a setting: its own, or the default 30. */
const payDayOf = (setting) => (setting && setting.pay_day ? setting.pay_day : DEFAULT_PAY_DAY);

/**
 * The day a month is paid (§6.11 rule 1): the pay day, or the month's last day when the pay day is past it
 * (30 pays on 28 or 29 February, 31 on 30 April). A plain calendar date: a Sunday or a holiday keeps its date,
 * because MyCity's CEO transfers by hand (§13.2 item 23).
 * @param {{pay_day?: number|null}} setting
 * @param {string} period  a month's first day
 */
function payDateOf(setting, period) {
  const { first, last } = lagos.monthBounds(period);
  const day = Math.min(payDayOf(setting), Number(last.slice(8, 10)));
  return `${first.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

/**
 * A month's pay date, with the pay day in force at the month's end: a pay day changed from a date applies to
 * the months that end on or after it.
 * @param {{query: Function}} db
 * @param {string} period  a month's first day
 */
async function payDateFor(db, period) {
  return payDateOf(await settingOn(db, lagos.monthBounds(period).last), period);
}

/**
 * Next Payday on My Payslips: the first pay date on or after `today` (Lagos) of a month whose run is not yet
 * paid. A month whose run is paid has had its payday, whatever the day; the search runs at most 14 months on.
 * @param {{query: Function}} db
 * @param {string} today
 * @param {(period: string) => Promise<boolean>|boolean} isPaid  whether the month's run is paid
 * @returns {Promise<string|null>}
 */
async function nextPayDate(db, today, isPaid) {
  let period = lagos.monthBounds(today).first;
  for (let i = 0; i < 14; i += 1) {
    const date = await payDateFor(db, period);
    if (date >= today && !(await isPaid(period))) return date;
    period = lagos.addMonths(period, 1);
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Configurations (PR 5): the setting's versions, and the rule every configuration change keeps
 * ------------------------------------------------------------------ */

/** The three conventions of §6.12 rule 1: the accountant's choices, none with a default. */
const CONVENTIONS = Object.freeze(["paye_basis", "pension_reduces_taxable", "nhf_reduces_taxable"]);

/**
 * A configuration change starts today or later in Lagos, never earlier (§6.11 rule 3): the setting, a statutory rate,
 * a grade, a placement, a pay split. A locked run never changes, and a month already computed keeps its snapshot.
 * @param {string} date  the change's first day
 */
function assertNotPast(date) {
  if (date < lagos.today())
    throw new AppError("EFFECTIVE_IN_THE_PAST", "A change starts today or later", 422, { effective_from: ["Date too early"] });
}

/** A version with who made it and why, as Configurations shows it. */
const VERSION = `s.payroll_setting_id, s.advanced_enabled, s.pay_day, s.require_bank_details, s.paye_basis,
  s.pension_reduces_taxable, s.nhf_reduces_taxable, s.effective_from::text AS effective_from,
  s.effective_to::text AS effective_to, s.reason,
  CASE WHEN e.employee_id IS NULL THEN NULL ELSE btrim(e.first_name || ' ' || e.last_name) END AS changed_by_name`;
const VERSION_JOINS = `LEFT JOIN app_user u ON u.user_id = s.changed_by LEFT JOIN employee e ON e.employee_id = u.employee_id`;

const one = async (db, sql, params) => {
  const { rows } = await db.query(sql, params);
  return rows[0] ? { ...rows[0], pay_day: rows[0].pay_day === null ? null : Number(rows[0].pay_day) } : null;
};

/** The version in force on a day with its names, or null. */
function versionAt(db, date) {
  return one(db, `SELECT ${VERSION} FROM payroll_setting s ${VERSION_JOINS} WHERE ${effective.asOf("s", 1)}`, [date]);
}

/** The first version that starts after a day, or null: Configurations' `next`. */
function versionAfter(db, date) {
  return one(
    db,
    `SELECT ${VERSION} FROM payroll_setting s ${VERSION_JOINS} WHERE s.effective_from > $1::date ORDER BY s.effective_from LIMIT 1`,
    [date],
  );
}

/** The latest version, every version locked for the rest of the transaction: a change merges onto it. */
async function lockLatest(client) {
  await client.query(`SELECT 1 FROM payroll_setting WHERE scope = 'organisation' FOR UPDATE`);
  return one(client, `SELECT ${VERSION} FROM payroll_setting s ${VERSION_JOINS} ORDER BY s.effective_from DESC LIMIT 1`, []);
}

/** Whether the advanced option is on in any version, now, before or from a later day (§6.11 rule 4). */
async function hasBeenOn(db) {
  const { rows } = await db.query(`SELECT EXISTS (SELECT 1 FROM payroll_setting WHERE advanced_enabled) AS has_been`);
  return rows[0].has_been === true;
}

/** The columns a version of the setting may write. */
const WRITABLE = [...CONVENTIONS, "advanced_enabled", "pay_day", "require_bank_details", "changed_by", "reason"];

/**
 * A new version of the setting from a day, or the change joined onto that day's version (shared/db/effective-dated
 * `replace`). The service has merged the values and kept the rules.
 * @param {import("pg").PoolClient} client
 * @param {string} from
 * @param {object} data  every column of WRITABLE
 */
function writeVersion(client, from, data) {
  return effective.addVersion(client, { table: "payroll_setting", key: { scope: "organisation" }, from, data, writable: WRITABLE, replace: true });
}

module.exports = {
  DEFAULT_PAY_DAY,
  DEFAULTS,
  CONVENTIONS,
  settingOn,
  payDayOf,
  payDateOf,
  payDateFor,
  nextPayDate,
  assertNotPast,
  versionAt,
  versionAfter,
  lockLatest,
  hasBeenOn,
  writeVersion,
};
