"use strict";
/**
 * What the Praxis AI action suites share (tests/integration/ai-actions-*.test.js,
 * ai-cards.test.js; docs/guides/praxis-ai.md §6.11): people made as the first administrator is
 * made, their logins, requests as each of them, Gemini answering from a script, the outbox
 * drained as the worker would, and the three ways a session confirms it is the person
 * (the password, the PIN, a passkey) for a card of a sensitive class.
 *
 * Every suite that uses it mocks ../../src/jobs/queues itself (jest hoists the mock per file)
 * and sets GEMINI_API_KEY before requiring the app, so no provider is ever reached.
 */
const request = require("supertest");
const { config } = require("../../../src/config/env");
const { pool } = require("../../../src/config/db");
const { atomically } = require("../../../src/shared/db/tx");
const { createAdmin } = require("../../../scripts/db/create-admin");
const outbox = require("../../../src/shared/events/outbox");
const settings = require("../../../src/shared/integrations/settings");
const jobs = require("../../../src/services/ai/jobs");
const governance = require("../../../src/services/ai/governance");
const gemini = require("../../../src/services/ai/vendors/gemini");
const { softAuthenticator } = require("../../helpers/soft-authenticator");

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0] || null;

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** Forget what the AI layer cached between tests (the chain, the caps, the settings). */
function fresh() {
  jobs.forget();
  governance.forgetCaps();
  settings.forget();
}

/** Gemini answering from a script, one reply a call, keeping what it was sent. */
function script(...replies) {
  const sent = [];
  jest.spyOn(gemini, "complete").mockImplementation(async (r) => {
    sent.push(r);
    const next = replies.shift();
    if (!next) throw new Error("the script ran out");
    return { usage: { input_tokens: 300, output_tokens: 40 }, model: r.model, ...next };
  });
  return sent;
}
const callRead = (name, args = {}, id = "call-1") => ({ text: "", toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }], finish_reason: "tool_calls" });
const say = (draft) => ({ text: JSON.stringify({ table: null, route: null, prefill: null, more: false, action: null, overview: null, ...draft }), toolCalls: [], finish_reason: "stop" });

/** A sample employee, complete enough for createAdmin. */
const sample = (first, last, email, job, department = "HR & Operations") => ({
  first_name: first,
  last_name: last,
  work_email: email,
  phone: "08031234567",
  job_title: job,
  department_name: department,
  start_date: "2026-01-05",
  employment_type: "full_time",
  work_pattern: "remote",
});

/**
 * The app's people and their requests. `people(specs)` makes each as the first administrator
 * is made and signs them in; `as(who)` sends requests as them; `ask` and `press` carry an
 * Idempotency-Key as the screen does.
 */
function harness(app) {
  const people = {};
  const tokens = {};
  const passwords = {};
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.74.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };
  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", nextIp());
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path) => auth(request(app).post(`/api/v1${path}`)),
      put: (path) => auth(request(app).put(`/api/v1${path}`)),
      patch: (path) => auth(request(app).patch(`/api/v1${path}`)),
      delete: (path) => auth(request(app).delete(`/api/v1${path}`)),
    };
  };
  /**
   * @param {Array<{who: string, first: string, last: string, email: string, job: string, role: string, ceo?: boolean, password: string, department?: string}>} specs
   */
  async function makePeople(specs) {
    await tx(async (client) => {
      for (const s of specs) {
        people[s.who] = await createAdmin(client, { employee: sample(s.first, s.last, s.email, s.job, s.department), role_code: s.role, is_ceo: s.ceo === true }, s.password, { allowAdditional: true });
        passwords[s.who] = s.password;
      }
    });
    await drain();
    for (const s of specs) {
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", nextIp()).send({ email: s.email, password: s.password });
      if (res.status !== 200) throw new Error(`${s.email} could not sign in: ${res.status} ${JSON.stringify(res.body)}`);
      tokens[s.who] = res.body.access_token;
      const u = await one("SELECT u.user_id, u.employee_id FROM app_user u WHERE u.email = $1", [s.email]);
      people[s.who] = { ...people[s.who], ...u, email: s.email };
    }
    return people;
  }
  const ask = (who, body) => as(who).post("/ai/ask").set("Idempotency-Key", `ask-${Date.now()}-${Math.random()}`).send(body);
  const press = (who, id, body = {}) => as(who).post(`/ai/cards/${id}/confirm`).set("Idempotency-Key", `press-${Date.now()}-${Math.random()}`).send(body);
  /** The session last proved who it is ten minutes ago: a sensitive card is refused until Confirm It's You. */
  const stale = (who) => q("UPDATE user_session SET issued_at = now() - interval '10 minutes', reauthenticated_at = NULL WHERE user_id = $1", [people[who].user_id]);
  /** Confirm It's You with the password. */
  const confirmPassword = async (who) => {
    const res = await as(who).post("/security/confirm").send({ method: "password", password: passwords[who] });
    if (res.status !== 200) throw new Error(`confirm with the password: ${res.status} ${JSON.stringify(res.body)}`);
  };
  /** Set a PIN, then Confirm It's You with it. */
  const confirmPin = async (who, pin = "4071") => {
    const set = await as(who).post("/security/pin").send({ pin });
    if (![200, 201].includes(set.status)) throw new Error(`set the PIN: ${set.status} ${JSON.stringify(set.body)}`);
    const res = await as(who).post("/security/confirm").send({ method: "pin", pin });
    if (res.status !== 200) throw new Error(`confirm with the PIN: ${res.status} ${JSON.stringify(res.body)}`);
  };
  /** Add a passkey on a software authenticator, then Confirm It's You by signing with it. */
  const confirmPasskey = async (who) => {
    const device = softAuthenticator({ origin: config.WEBAUTHN_ORIGIN, rpId: config.WEBAUTHN_RP_ID });
    const start = await as(who).post("/security/passkeys/options").send({});
    if (start.status !== 200) throw new Error(`passkey options: ${start.status} ${JSON.stringify(start.body)}`);
    const added = await as(who).post("/security/passkeys").send({ challenge_token: start.body.challenge_token, credential: device.create(start.body.options) });
    if (added.status !== 201) throw new Error(`add the passkey: ${added.status} ${JSON.stringify(added.body)}`);
    const begin = await as(who).post("/security/confirm/options").send({});
    if (begin.status !== 200) throw new Error(`confirm options: ${begin.status} ${JSON.stringify(begin.body)}`);
    const res = await as(who).post("/security/confirm").send({ method: "passkey", challenge_token: begin.body.challenge_token, credential: device.get(begin.body.options) });
    if (res.status !== 200) throw new Error(`confirm with the passkey: ${res.status} ${JSON.stringify(res.body)}`);
  };
  return { people, tokens, as, makePeople, ask, press, stale, confirmPassword, confirmPin, confirmPasskey, nextIp };
}

module.exports = { q, one, drain, tx, fresh, script, callRead, say, sample, harness };
