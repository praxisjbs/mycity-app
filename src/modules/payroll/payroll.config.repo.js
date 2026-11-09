"use strict";
/**
 * The payroll setting as it stood on a date (docs/guides/payroll.md §4.2, §6.11). It is effective-dated
 * (`shared/db/effective-dated`): read here with `versionOn`, written with `addVersion` by the settings
 * route (PR 5). With no row the run is simple, the pay day is the default 30 and bank details are a
 * warning; nothing is seeded (A26), so the defaults below are the whole of "no setting".
 *
 *   settingOn(db, date)   the version in force on a date, or the defaults
 *   payDayOf(setting)     the pay day, 30 when none is set
 *
 * A run reads the setting on its period's first day, so the mode a month was computed in is the mode of
 * that month, whenever it is computed (§6.11 rule 2).
 */
const effective = require("../../shared/db/effective-dated");

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

module.exports = { DEFAULT_PAY_DAY, DEFAULTS, settingOn, payDayOf };
