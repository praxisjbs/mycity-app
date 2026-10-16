"use strict";
/**
 * The one write that follows every business write (README §6.4, SYSTEM_ARCHITECTURE §6).
 *
 *   await atomically(client, async () => {
 *     const row = await repo.insert(client, data);
 *     await emit(client, {
 *       key: EVENTS.EMPLOYEE_CREATED,
 *       entity: { type: "employee", id: row.employee_id },
 *       actor,                               // req.user, or null for the system
 *       after: row,
 *     });
 *     return row;
 *   });
 *
 * One call, inside the caller's transaction, writes three rows in one statement:
 *
 *   event_log      what happened: key, module, entity, actor, payload
 *   audit_ledger   who did it, from where, and the record before and after
 *   event_outbox   the follow-on work, claimed by the worker only after COMMIT
 *
 * So a rolled-back save leaves no event, no audit row and no follow-on work, and a
 * committed one always has all three. Nothing else happens here: notifications,
 * approvals, PDFs, mail, search and realtime are outbox handlers
 * (shared/events/outbox.js) that run after commit, in the worker.
 *
 * The event:
 *
 *   key        required; declared with defineEvents() (shared/events/catalogue.js)
 *   entity     required; { type, id } of the record it is about. type is snake_case
 *              ("employee", "expense"); id is the record's primary key
 *   actor      req.user (or withActor(req) to add the client IP), a user id string, or
 *              null when the system acts (a scheduler, a timeout). Defaults to the
 *              request context's user
 *   before     the record before a change (omit on create)
 *   after      the record after (omit on delete)
 *   payload    the small set of facts the handlers need (ids, amounts, a state). It
 *              is what the outbox hands each handler; keep rows out of it
 *   module     overrides the catalogue's module (the approval engine passes the
 *              definition's module)
 *   metadata   free facts for the Audit Log line ({ count: 12 } for a bulk change)
 *   dedup_key  at most one outbox row per key, for an emit that a retry may repeat
 *
 * Credentials never reach the ledger: any key that names a password, secret, token,
 * hash or encrypted value is replaced with "<redacted>" in before and after. Salary,
 * bank and personal fields ARE kept, because an auditor needs them; the Audit Log
 * reader masks them per caller (shared/rbac/field-mask.js).
 *
 * Tables and columns written (migration 0030; BACKEND_STRUCTURE §11.1):
 *   event_log     event_id, event_key, module_key, entity_type, entity_id, actor_user_id,
 *                 payload, request_id, import_batch_id, occurred_at
 *   audit_ledger  event_id, occurred_at, actor_user_id, actor_name, actor_email, actor_ip,
 *                 action, module_key, entity_type, entity_id, before, after,
 *                 changed_fields, is_sensitive, metadata, request_id, import_batch_id
 *   event_outbox  event_id, event_key, dedup_key (status, attempts, next_attempt_at
 *                 and the rest take their defaults)
 */
const requestContext = require("../../config/request-context");
const { inTransaction } = require("../db/tx");
const catalogue = require("./catalogue");
const metrics = require("../observability/metrics");

const ENTITY_TYPE_RE = /^[a-z][a-z0-9_]*$/;

/** Payloads stay small: the outbox carries them to every handler on every retry. */
const PAYLOAD_MAX_BYTES = 16 * 1024;

/** A key naming a credential. Matched on the key name, at any depth. */
const CREDENTIAL_KEY =
  /(password|passwd|secret|token|api_key|private_key|_hash$|_enc$|^otp$|mfa)/i;

/**
 * jsonb parameters are always stringified here. node-postgres turns a JS array
 * into a Postgres ARRAY literal, not JSON, so a before/after that is a list
 * (a set of grants) would fail to parse as jsonb.
 */
const json = (v) => (v === null || v === undefined ? null : JSON.stringify(v));

/** Copy with credential values replaced, at any depth. Dates and other values pass as is. */
function redact(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] =
      CREDENTIAL_KEY.test(k) && v !== null && v !== undefined
        ? "<redacted>"
        : redact(v, depth + 1);
  }
  return out;
}

const same = (a, b) =>
  JSON.stringify(a === undefined ? null : a) ===
  JSON.stringify(b === undefined ? null : b);

/** Top-level keys whose value differs between before and after, sorted. */
function changedFields(before, after) {
  if (
    !before ||
    !after ||
    typeof before !== "object" ||
    typeof after !== "object"
  )
    return null;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => !same(before[k], after[k])).sort();
}

/**
 * The actor fields for the ledger. Accepts req.user, withActor(req), a user id, or null.
 * @returns {{user_id: string|null, name: string|null, email: string|null, ip: string|null}}
 */
function actorOf(actor) {
  if (actor === undefined) {
    return {
      user_id: requestContext.getUserId(),
      name: null,
      email: null,
      ip: null,
    };
  }
  if (actor === null)
    return { user_id: null, name: null, email: null, ip: null };
  if (typeof actor === "string")
    return { user_id: actor, name: null, email: null, ip: null };
  return {
    user_id: actor.user_id || null,
    name: actor.display_name || actor.name || null,
    email: actor.email || null,
    ip: actor.ip || null,
  };
}

/**
 * req.user plus the client IP, for the ledger's "from where".
 * @param {import("express").Request} req
 */
function withActor(req) {
  return { ...(req && req.user ? req.user : {}), ip: (req && req.ip) || null };
}

function check(event) {
  if (!event || typeof event !== "object")
    throw new Error("emit: give an event object");
  if (!event.key) {
    // A missing key is a caller bug (usually a misspelt constant). Saying so here
    // beats a NOT NULL violation that reads like a problem with the user's input.
    throw new Error(
      `emit: key is required (entity ${event.entity ? event.entity.type : "?"})`,
    );
  }
  const entry = catalogue.require(event.key);
  const entity = event.entity;
  if (
    !entity ||
    !ENTITY_TYPE_RE.test(String(entity.type || "")) ||
    entity.id === undefined ||
    entity.id === null ||
    entity.id === ""
  ) {
    throw new Error(
      `emit(${event.key}): entity { type, id } is required; type is snake_case`,
    );
  }
  if (
    event.payload !== undefined &&
    (event.payload === null ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload))
  ) {
    throw new Error(`emit(${event.key}): payload is an object`);
  }
  return entry;
}

/**
 * Record an event, its audit entry and its follow-on work, in the caller's transaction.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {object} event  see the file header
 * @returns {Promise<{event_id: string, occurred_at: Date}>}
 */
async function emit(client, event) {
  const entry = check(event);
  if (!inTransaction(client)) {
    throw new Error(
      `emit(${event.key}) must run inside atomically(): the event commits or rolls back with the change`,
    );
  }

  const payload = event.payload || {};
  const payloadJson = JSON.stringify(payload);
  if (Buffer.byteLength(payloadJson) > PAYLOAD_MAX_BYTES) {
    throw new Error(
      `emit(${event.key}): payload is over ${PAYLOAD_MAX_BYTES} bytes; carry ids, not rows`,
    );
  }

  const actor = actorOf(event.actor);
  const before = event.before === undefined ? null : redact(event.before);
  const after = event.after === undefined ? null : redact(event.after);
  const moduleKey = event.module || entry.module;
  const requestId = requestContext.getRequestId();
  const importBatchId = requestContext.getImportBatchId();

  const { rows } = await client.query(
    `WITH ev AS (
       INSERT INTO event_log
         (event_key, module_key, entity_type, entity_id, actor_user_id, payload, request_id, import_batch_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       RETURNING event_id, occurred_at
     ), au AS (
       INSERT INTO audit_ledger
         (event_id, occurred_at, actor_user_id, actor_name, actor_email, actor_ip, action, module_key,
          entity_type, entity_id, before, after, changed_fields, is_sensitive, metadata, request_id,
          import_batch_id)
       SELECT ev.event_id, ev.occurred_at, $5, $9, $10, $11, $1, $2,
              $3, $4, $12::jsonb, $13::jsonb, COALESCE($14::text[], '{}'), $15, $16::jsonb, $7,
              $8
         FROM ev
     ), ob AS (
       INSERT INTO event_outbox (event_id, event_key, dedup_key)
       SELECT ev.event_id, $1, $17 FROM ev
       ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
     )
     SELECT event_id, occurred_at FROM ev`,
    [
      event.key,
      moduleKey,
      event.entity.type,
      String(event.entity.id),
      actor.user_id,
      payloadJson,
      requestId,
      importBatchId,
      actor.name,
      actor.email,
      actor.ip,
      json(before),
      json(after),
      changedFields(event.before, event.after),
      entry.security || entry.sensitive,
      json(event.metadata || {}),
      event.dedup_key || null,
    ],
  );

  metrics.inc(
    "mycity_events_emitted_total",
    { module: moduleKey },
    1,
    "Events emitted, by module.",
  );
  return rows[0];
}

module.exports = {
  emit,
  withActor,
  redact,
  changedFields,
  actorOf,
  PAYLOAD_MAX_BYTES,
};
