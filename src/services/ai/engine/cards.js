"use strict";
/**
 * The rules of an action card (docs/guides/praxis-ai.md §6.11; decisions 10, 11, 16, 20), with
 * nothing of MyCity in them: what a draft becomes, which fields a card shows, when it may be
 * pressed, how each risk class is confirmed, how long it lives.
 *
 *   cards.draft({ key, values, suggested, check, context, now })
 *     → { ok, values, problems, records, expires_at, ... } or null when the card is refused
 *   cards.fieldsOf(jsonSchema, labels)   the card's fields from the input schema
 *   cards.confirmOf(risk)                "press" or "fresh_sign_in"
 *   cards.assertPressable(card, now)     throws an EngineError naming why not
 *   cards.statusOf(card, now)            `expired` for a shown card past its time
 */
const { EngineError } = require("./errors");

/** The risk classes; the four after standard need a fresh sign-in (decision 11). */
const RISKS = Object.freeze(["standard", "approval", "money", "payroll", "delete"]);
const SENSITIVE = Object.freeze(new Set(["approval", "money", "payroll", "delete"]));
/** How long a card may be pressed after it was drawn. */
const TTL_MS = 30 * 60 * 1000;
/** How recently the session must have confirmed it is the person, for a sensitive class. */
const CONFIRM_WINDOW_SECONDS = 5 * 60;
/** Records one press may touch, at most. */
const BULK_MAX = 25;
const STATUSES = Object.freeze(["shown", "confirmed", "done", "failed", "cancelled", "expired"]);

const confirmOf = (risk) => (SENSITIVE.has(risk) ? "fresh_sign_in" : "press");

/** A field's label from its name when the manifest gives none: "due_on" reads "Due On". */
const humanise = (name) =>
  String(name)
    .replace(/_id$/, "")
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

/** One JSON Schema node, unwrapped from an `anyOf` with null or the blank string a form may leave. */
function nodeOf(p) {
  if (p && Array.isArray(p.anyOf)) {
    const real = p.anyOf.filter((x) => x && x.type !== "null" && x.const !== "" && !(Array.isArray(x.enum) && x.enum.length === 1 && x.enum[0] === ""));
    return real.length === 1 ? real[0] : p;
  }
  return p || {};
}

function kindOf(name, p) {
  const node = nodeOf(p);
  if (node.enum) return "choice";
  if (node.type === "array") return "list";
  if (node.type === "boolean") return "boolean";
  if (node.type === "number" || node.type === "integer") return "number";
  if (node.format === "uuid" || /_id$/.test(name)) return "id";
  if (node.format === "date-time") return "datetime";
  if (node.pattern === "^\\d{4}-\\d{2}-\\d{2}$" || node.format === "date") return "date";
  if (node.pattern && /\\d\{2\}\$/.test(node.pattern) && /(amount|salary|ngn|price|fee|cost|total|budget|pay)/i.test(name)) return "money";
  if (node.type === "string") return "text";
  return "other";
}

/** A text this long or longer is written in a box of several lines (a message, a note, a reason). */
const LONG_TEXT = 300;

/**
 * The card's fields from the action's input schema (JSON Schema, structured.jsonSchemaOf).
 * @param {object} jsonSchema
 * @param {Record<string, string>} [labels]
 * @returns {Array<{name: string, label: string, kind: string, required: boolean, options: string[]|null, long: boolean}>}
 */
function fieldsOf(jsonSchema, labels = {}) {
  const props = (jsonSchema && jsonSchema.properties) || {};
  const required = new Set((jsonSchema && jsonSchema.required) || []);
  return Object.entries(props)
    .slice(0, 40)
    .map(([name, p]) => {
      const node = nodeOf(p);
      const kind = kindOf(name, p);
      return {
        name,
        label: labels[name] || humanise(name),
        kind,
        required: required.has(name),
        options: node.enum ? node.enum.map(String).slice(0, 50) : null,
        long: kind === "text" && (node.maxLength === undefined || node.maxLength >= LONG_TEXT),
      };
    });
}

/**
 * What the model's action becomes before anyone sees it: the values the schema takes, filled
 * from the context screen where a field is empty and the screen holds a record, parsed, with
 * problems kept by field; the records it touches; its expiry.
 *
 * @param {object} q
 * @param {object} q.action      the manifest's action (key, input shape keys, bulk, risk)
 * @param {string[]} q.fieldNames  the input schema's field names
 * @param {object} q.values      what the model gave
 * @param {boolean} [q.suggested]
 * @param {{ok: boolean, values: object, problems: object, records: Array}} q.checked  authorise.checkAction's answer
 * @param {{id?: string}|null} [q.context]  the screen the question came from
 * @param {string[]} [q.recordFields]  fields of the input that name the context's record ("task_id")
 * @param {number} [q.now]
 */
function draft({ action, fieldNames, values, suggested = false, checked, now = Date.now() }) {
  const known = new Set(fieldNames);
  const kept = {};
  for (const [k, v] of Object.entries(values && typeof values === "object" ? values : {})) if (known.has(k) && v !== undefined) kept[k] = v;
  return {
    action_key: action.key,
    risk: action.risk,
    confirm: confirmOf(action.risk),
    bulk: action.bulk,
    values: checked.ok ? checked.values : kept,
    problems: checked.problems || {},
    records: (checked.records || []).slice(0, BULK_MAX),
    suggested: Boolean(suggested),
    status: "shown",
    expires_at: new Date(now + TTL_MS).toISOString(),
  };
}

/** A context screen's record filled into the one id field that is still empty, when the input has one. */
function fillFromContext(values, fieldNames, context) {
  if (!context || !context.id) return values;
  const idFields = fieldNames.filter((f) => /_id$/.test(f) && !/^(member|attendee)_ids?$/.test(f));
  if (idFields.length !== 1 || values[idFields[0]]) return values;
  return { ...values, [idFields[0]]: context.id };
}

/** The status a card reads as now: `expired` once a shown card is past its time. */
function statusOf(card, now = Date.now()) {
  if (card.status === "shown" && new Date(card.expires_at).getTime() <= now) return "expired";
  return card.status;
}

/** Why a card may not be pressed, as an EngineError; nothing when it may. */
function assertPressable(card, now = Date.now()) {
  const status = statusOf(card, now);
  if (status === "shown") return;
  const why = {
    expired: ["CARD_EXPIRED", "This card has expired. Ask again to draw it afresh.", 409],
    done: ["CARD_DONE", "This was already done.", 409],
    failed: ["CARD_DONE", "This card was already pressed.", 409],
    confirmed: ["CARD_RUNNING", "This is already running.", 409],
    cancelled: ["CARD_CANCELLED", "This card was cancelled.", 409],
  }[status] || ["CARD_NOT_OPEN", "This card cannot be pressed.", 409];
  throw new EngineError(why[0], why[1], why[2]);
}

/** Why a card may not be edited or cancelled: only a shown, unexpired one may. */
function assertOpen(card, now = Date.now()) {
  if (statusOf(card, now) !== "shown") throw new EngineError("CARD_NOT_OPEN", "This card is no longer open.", 409);
}

/**
 * Whether a sensitive card's press is confirmed: the session proved who it is within the window.
 * @param {string} risk
 * @param {number|null} provedAgoSeconds  seconds since the session signed in or confirmed; null for unknown
 */
function confirmed(risk, provedAgoSeconds) {
  if (!SENSITIVE.has(risk)) return true;
  return typeof provedAgoSeconds === "number" && provedAgoSeconds >= 0 && provedAgoSeconds <= CONFIRM_WINDOW_SECONDS;
}

module.exports = {
  RISKS,
  SENSITIVE,
  STATUSES,
  TTL_MS,
  CONFIRM_WINDOW_SECONDS,
  BULK_MAX,
  LONG_TEXT,
  confirmOf,
  humanise,
  fieldsOf,
  draft,
  fillFromContext,
  statusOf,
  assertPressable,
  assertOpen,
  confirmed,
};
