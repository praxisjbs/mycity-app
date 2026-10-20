"use strict";
/**
 * Every event key the system emits, declared once, with what it means.
 *
 * A module declares its keys in `<module>.events.js` and gets back constants, so
 * a typo is `undefined` at the call site, which emit() refuses at once:
 *
 *   const { defineEvents } = require("../../shared/events/catalogue");
 *
 *   const EVENTS = defineEvents("people", {
 *     "employee.created": { summary: "An employee record was created" },
 *     "employee.reporting_line_changed": { summary: "A line manager changed" },
 *   });
 *
 *   EVENTS.EMPLOYEE_CREATED                  // "employee.created"
 *   EVENTS.EMPLOYEE_REPORTING_LINE_CHANGED   // "employee.reporting_line_changed"
 *
 * What an entry carries:
 *
 *   module     the permission key (shared/access/access.catalog.js) the event belongs to.
 *              It is stored on event_log and audit_ledger, filters the Audit Log, and is the
 *              default audience for notifications about it.
 *   summary    one line a person reads in the Audit Log.
 *   security   a change to who can do what (roles, grants, field visibility, sessions,
 *              users). The audit row is marked sensitive and the people who watch access
 *              changes are told, whatever their preferences (shared/notifications/fanout.js).
 *   sensitive  the audit row carries personal data (salary, bank, a query letter). Marked so
 *              the Audit Log reader masks it for people without the field grant.
 *
 * Key format: lower snake_case segments joined by dots, at least two segments, the
 * first naming the thing ("employee", "workflow", "home"). The first segment also picks
 * the notification category (shared/notifications/categories.js).
 *
 * Declaring the same key twice is allowed only with the same module (an events file
 * required by both the API and the worker, or the shared layer and a module both
 * naming a key they share). Two modules claiming one key fail at load.
 */
const catalog = require("../access/access.catalog");

const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** key → frozen { key, module, summary, security, sensitive } */
const ENTRIES = new Map();

/** "employee.reporting_line_changed" → "EMPLOYEE_REPORTING_LINE_CHANGED" */
function constantOf(key) {
  return key.replace(/\./g, "_").toUpperCase();
}

function checkEntry(moduleKey, key, meta) {
  const where = `defineEvents(${moduleKey}) "${key}"`;
  if (!KEY_RE.test(key))
    throw new Error(
      `${where}: an event key is dotted lower snake_case, e.g. "employee.created"`,
    );
  if (!meta || typeof meta !== "object")
    throw new Error(`${where}: give { summary }`);
  if (typeof meta.summary !== "string" || meta.summary.trim() === "")
    throw new Error(`${where}: summary is required`);
  if (meta.summary.includes("\u2014"))
    throw new Error(`${where}: no em dashes in copy a person reads`);
  for (const k of Object.keys(meta)) {
    if (!["summary", "security", "sensitive"].includes(k))
      throw new Error(`${where}: unknown option "${k}"`);
  }
}

/**
 * Declare a module's event keys.
 * @param {string} moduleKey  one of the 15 permission keys
 * @param {Record<string, {summary: string, security?: boolean, sensitive?: boolean}>} events
 * @returns {Readonly<Record<string, string>>}  CONSTANT_NAME → key
 */
function defineEvents(moduleKey, events) {
  if (!catalog.isModule(moduleKey)) {
    throw new Error(
      `defineEvents: "${moduleKey}" is not a module key (shared/access/access.catalog.js)`,
    );
  }
  if (!events || typeof events !== "object")
    throw new Error("defineEvents: give an object of key → { summary }");

  const constants = {};
  for (const [key, meta] of Object.entries(events)) {
    checkEntry(moduleKey, key, meta);
    const existing = ENTRIES.get(key);
    if (existing && existing.module !== moduleKey) {
      throw new Error(
        `defineEvents: "${key}" is already declared by module "${existing.module}"`,
      );
    }
    if (!existing) {
      ENTRIES.set(
        key,
        Object.freeze({
          key,
          module: moduleKey,
          summary: meta.summary.trim(),
          security: meta.security === true,
          sensitive: meta.sensitive === true,
        }),
      );
    }
    constants[constantOf(key)] = key;
  }
  return Object.freeze(constants);
}

/** The entry for a key, or null. */
function get(key) {
  return ENTRIES.get(key) || null;
}

function has(key) {
  return ENTRIES.has(key);
}

/** The entry for a key; throws naming the key when it was never declared. */
function require_(key) {
  const entry = ENTRIES.get(key);
  if (!entry) {
    throw new Error(
      `event "${key}" is not declared; add it to the module's <module>.events.js with defineEvents()`,
    );
  }
  return entry;
}

/** Every declared entry, sorted by key (the Audit Log's filter list, the docs). */
function all() {
  return [...ENTRIES.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/*
 * Keys the shared layer itself emits. Declared here so they exist before any module
 * loads; modules that react to them only subscribe.
 */

/** The approval engine (shared/workflow). The entity is the record under approval. */
const WORKFLOW = defineEvents("settings", {
  "workflow.opened": { summary: "An approval was started" },
  "workflow.advanced": { summary: "An approval moved to its next stage" },
  "workflow.completed": { summary: "An approval finished" },
  "workflow.changes_requested": { summary: "An approver asked for changes" },
  "workflow.escalated": {
    summary: "An approval passed its time limit and was escalated",
  },
  "workflow.cancelled": { summary: "An approval was withdrawn" },
  "workflow.reminded": { summary: "An approval still waiting was brought back to its approvers" },
});

/** The alert engine (shared/alerts). Home owns the screen and the tables. */
const ALERTS = defineEvents("home", {
  "home.alert_raised": { summary: "An alert was raised" },
  "home.alert_cleared": { summary: "An alert was cleared or dismissed" },
  "home.alert_escalated": {
    summary: "A high alert was left open too long and escalated",
  },
});

module.exports = {
  defineEvents,
  get,
  has,
  require: require_,
  all,
  constantOf,
  KEY_RE,
  WORKFLOW,
  ALERTS,
};
