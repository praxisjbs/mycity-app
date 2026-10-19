"use strict";
/**
 * Field-level visibility: the fourth layer of a grant (module → action → scope → field).
 *
 * A role can be given a module and still not see some of what is in it: a payroll
 * officer sees pay but not a home address, a line manager sees their team but not
 * their salaries. Settings, Roles & Permissions stores that as rows in
 * field_visibility (role_id, field_key, visibility 'masked'); grants-cache reads them.
 * This file applies them to what leaves the API.
 *
 *   const { maskForUser } = require("../../shared/rbac/field-mask");
 *
 *   // controller, on a read that can carry restricted fields
 *   get: async (req, res) => ok(res, await maskForUser(pool, req.user, await service.get(id, scopeOf(req)))),
 *
 * Apply it at the boundary (controllers, exports, import previews, AI reads), never
 * in a service: payroll's own computation needs the real salary.
 *
 * How it masks:
 *  - Each field key below governs a set of property names. A masked key sets those
 *    properties to null wherever they appear, at any depth, so a salary nested in a
 *    payslip summary inside an employee 360 is caught too. Null, not deleted: the
 *    response keeps the shape its contract describes (restricted fields are
 *    nullable in the contract for exactly this reason).
 *  - The CEO is never masked.
 *  - A person's OWN record is not masked from them. Employee Self-Service is the
 *    caller's own data and its controllers do not call this. Elsewhere, a screen
 *    that shows one employee checks `row.employee_id === req.user.employee_id` and
 *    skips the mask for that row.
 *  - Keys never written from data: "__proto__", "constructor" and "prototype" are
 *    dropped, and the copy is built with Object.fromEntries so no setter can run.
 *
 * Adding a restricted field is one line here, plus making it nullable in the
 * contract. A new KEY appears on the Roles & Permissions screen automatically
 * (FIELD_KEYS); nothing is masked until an administrator says so.
 */
const grantsCache = require("./grants-cache");

/** field_visibility.field_key → label, and the response property names it governs. */
const FIELDS = Object.freeze({
  "employee.salary": {
    label: "Salary and pay",
    props: [
      "salary",
      "base_salary",
      "basic_salary",
      "gross_pay",
      "net_pay",
      "monthly_gross",
      "annual_gross",
      "gross_monthly",
      "net_monthly",
      "total_allowances",
      "total_deductions",
      "salary_grade_amount",
    ],
  },
  "employee.bank": {
    label: "Bank details",
    props: [
      "bank_name",
      "bank_code",
      "account_number",
      "bank_account_number",
      "account_name",
      "bvn",
    ],
  },
  "employee.personal": {
    label: "Personal details",
    props: [
      "date_of_birth",
      "home_address",
      "home_latitude",
      "home_longitude",
      "residential_address",
      "personal_email",
      "personal_phone",
      "marital_status",
      "state_of_origin",
      "lga_of_origin",
      "nin",
      "next_of_kin_name",
      "next_of_kin_phone",
      "next_of_kin_relationship",
      "next_of_kin_address",
      "emergency_contact_name",
      "emergency_contact_phone",
      "emergency_contact_relationship",
    ],
  },
  "employee.statutory": {
    label: "Tax and pension numbers",
    props: [
      "tax_id",
      "tin",
      "pension_pin",
      "pension_administrator",
      "nhf_number",
      "nsitf_number",
    ],
  },
});

/** For the Roles & Permissions screen and for validating a field_visibility write. */
const FIELD_KEYS = Object.freeze(
  Object.entries(FIELDS).map(([key, f]) => ({ key, label: f.label })),
);

const isFieldKey = (key) => Object.prototype.hasOwnProperty.call(FIELDS, key);

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** The property names masked for a set of field keys. Unknown keys mask nothing. */
function maskedPropsFor(maskedKeys = []) {
  const props = new Set();
  for (const k of maskedKeys)
    if (isFieldKey(k)) for (const p of FIELDS[k].props) props.add(p);
  return props;
}

/** Copy of `value` with every property in `props` set to null, at any depth. */
function applyMask(value, props, depth = 0) {
  if (
    depth > 12 ||
    value === null ||
    typeof value !== "object" ||
    value instanceof Date
  )
    return value;
  if (Array.isArray(value))
    return value.map((v) => applyMask(v, props, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !UNSAFE_KEYS.has(k))
      .map(([k, v]) => [
        k,
        props.has(k) ? null : applyMask(v, props, depth + 1),
      ]),
  );
}

/** Mask `data` for a caller who may not see `maskedKeys`. No keys: returned unchanged. */
function maskData(data, maskedKeys = []) {
  const props = maskedPropsFor(maskedKeys);
  return props.size === 0 ? data : applyMask(data, props);
}

/**
 * The caller's masked field keys (30-second cache). The CEO has none.
 * @param {{query: Function}} client
 * @param {{user_id: string, is_ceo?: boolean}} user
 * @returns {Promise<string[]>}
 */
async function maskedKeysFor(client, user) {
  if (!user || !user.user_id || user.is_ceo === true) return [];
  return grantsCache.getMaskedFieldKeys(client, user.user_id);
}

/**
 * Mask `data` (a record, a page envelope, a list) for the caller.
 * @param {{query: Function}} client
 * @param {{user_id: string, is_ceo?: boolean}} user  req.user
 * @param {*} data
 */
async function maskForUser(client, user, data) {
  const keys = await maskedKeysFor(client, user);
  return maskData(data, keys);
}

/** May the caller see this field key? For hiding a column on an export. */
async function canSee(client, user, fieldKey) {
  return !(await maskedKeysFor(client, user)).includes(fieldKey);
}

module.exports = {
  FIELDS,
  FIELD_KEYS,
  isFieldKey,
  maskedPropsFor,
  applyMask,
  maskData,
  maskedKeysFor,
  maskForUser,
  canSee,
};
