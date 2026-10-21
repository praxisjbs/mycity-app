"use strict";
/**
 * Settings · Integrations (docs/guides/integrations.md): the connections the ERP runs on,
 * their settings and keys, tested before they are saved and watched after.
 *
 *   list(query)            every connection of the registry, its state and source, 25 a page
 *   summary()              the connections counted by state, for the cards above the list
 *   get(code)              one connection: its settings in use, secrets as far as shown, the
 *                          last check, seven days of use
 *   save(code, body, by)   test what was typed, then keep it (§6.5)
 *   remove(code, by)       forget what was saved; the server file applies again
 *   test(code, body, by)   test the settings in use
 *   testEmail(by)          a real message to the tester, through system mail
 *   replaceKeys(by)        a new web push key pair
 *   models(code, query)    an AI connection's model list, 25 a page
 *   addModel(code, b, by)  Add Model; removeModel(code, id, by) takes one added by hand off
 *   syncRates(by, opts)    today's exchange rates, by Sync Rates or the job at midnight
 *   watch()                the worker's free tests every 15 minutes, and the daily limit
 *   purge()                old checks and use, nightly
 *
 * Rules (guide §6.4): a secret is never returned, logged, audited or put in a step; saving or
 * replacing one, removing saved settings and replacing keys need a fresh sign-in; a saved
 * password is never sent to a changed host, port or username. Tests run outside every
 * transaction; a save's writes run in one, with emit(), and bump the settings' version after
 * the commit so every process reads them within a second.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const { envelope, pageOf, PAGE_SIZE } = require("../../shared/http/paged");
const lagos = require("../../shared/time/lagos");
const encryption = require("../../services/secrets/encryption.service");
const providers = require("../../shared/integrations/providers");
const quota = require("../../shared/integrations/quota");
const settings = require("../../shared/integrations/settings");
const state = require("../../shared/integrations/state");
const fx = require("../../shared/money/fx");
const jobs = require("../../services/ai/jobs");
const security = require("../security/security.service");
const testers = require("./integrations.testers");
const repo = require("./integrations.repo");
const { EVENTS } = require("./integrations.events");

/** The share of a daily limit that warns IT (guide §6.9). */
const WARN_AT = 0.8;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (v) => (v ? new Date(v).toISOString() : null);
const known = (code) => (c.integrations.StepCode.safeParse(code).success ? code : "UNAVAILABLE");

/* ------------------------------------------------------------------ *
 * What the page reads
 * ------------------------------------------------------------------ */

/** A connection as the list shows it, from its definition, its row and the settings in use. */
function rowOf(def, row, inUse, unitsToday) {
  const unreadable = Boolean(inUse && inUse.unreadable.length);
  const status = row && (row.status === "ok" || row.status === "failing") ? row.status : "unchecked";
  let stateNow = "not_set";
  if (inUse) stateNow = unreadable ? "failing" : status;
  return {
    integration_connection_id: row ? row.integration_connection_id : null,
    code: def.code,
    display_name: def.name,
    group: def.group,
    state: stateNow,
    source: inUse ? inUse.source : "none",
    last_checked_at: row ? iso(row.last_checked_at) : null,
    last_error_code: unreadable ? "SECRET_UNREADABLE" : inUse && status === "failing" ? known(row.last_error_code) : null,
    daily_limit: def.limited && row && row.daily_limit ? Number(row.daily_limit) : null,
    plan: quota.planOf(def, row),
    units_today: Math.round((Number(unitsToday) || 0) * 100) / 100,
    watched: def.watched,
  };
}

/** Does a connection answer the search box? Its name, its code or its group. */
const matches = (def, q) => `${def.name} ${def.code} ${def.group} ${def.provider}`.toLowerCase().includes(String(q).toLowerCase());

/** Every connection of the registry as the list shows it, in the registry's order. */
async function everyRow() {
  const byCode = new Map((await repo.connections(pool, lagos.today())).map((r) => [r.code, r]));
  const out = [];
  for (const def of providers.PROVIDERS) {
    const row = byCode.get(def.code) || null;
    out.push(rowOf(def, row, await settings.of(def.code), row ? row.units_today : 0));
  }
  return out;
}

/** GET /integrations */
async function list(query) {
  const items = (await everyRow()).filter(
    (r) => (!query.group || r.group === query.group) && (!query.q || matches(providers.get(r.code), query.q)),
  );
  const { number, offset } = pageOf(query);
  return envelope(items.slice(offset, offset + PAGE_SIZE), number, items.length);
}

/** GET /integrations/summary: every connection counted by its state, whatever the list's filter. */
async function summary() {
  const all = await everyRow();
  const count = (s) => all.filter((r) => r.state === s).length;
  return { working: count("ok"), failing: count("failing"), unchecked: count("unchecked"), not_set: count("not_set") };
}

async function settingsView(def, inUse) {
  const v = inUse.values;
  switch (def.code) {
    case "mail_sender":
      return {
        code: def.code,
        host: v.host,
        port: v.port,
        security: v.security,
        username: v.username ?? null,
        from: v.from,
        reply_to: v.reply_to ?? null,
        per_hour: v.per_hour ?? null,
        local_domains: v.local_domains ?? null,
      };
    case "mailbox_server":
      return {
        code: def.code,
        imap_host: v.imap_host ?? null,
        imap_port: v.imap_port,
        smtp_host: v.smtp_host ?? null,
        smtp_port: v.smtp_port,
        per_person_per_hour: v.per_person_per_hour,
        sync_every_min: v.sync_every_min,
        live_connections: v.live_connections,
      };
    case "exchange_rates": {
      const t = await fx.newest();
      return {
        code: def.code,
        base: "USD",
        usd_ngn: t && t.usd_ngn ? String(t.usd_ngn) : null,
        rate_day: t ? t.day : null,
        fetched_at: t ? iso(t.fetched_at) : null,
        currencies: t ? Number(t.currencies) : 0,
      };
    }
    case "web_push": {
      const pair = inUse.secrets.vapid ? JSON.parse(inUse.secrets.vapid) : null;
      return {
        code: def.code,
        subject: v.subject,
        key_id: pair ? require("../../services/push/vapid").keyIdOf(pair.publicKey) : null,
      };
    }
    default: {
      if (!def.models) return { code: def.code };
      const counts = await repo.modelCounts(pool, def.code);
      return {
        code: def.code,
        in_use: await jobs.inUse(def.code, { db: pool }),
        models: counts ? counts.models : 0,
        available: counts ? counts.available : 0,
      };
    }
  }
}

/** What a person may see of a value: the last four of a key, a pair's id, nothing of a password. */
function hintOf(def, key, value) {
  const kind = (def.secrets.find((s) => s.key === key) || {}).hint;
  if (!value || kind === "none") return null;
  if (kind === "key_id") return require("../../services/push/vapid").keyIdOf(JSON.parse(value).publicKey);
  return String(value).slice(-4);
}

/** Each secret field's state. A secret from the server file shows where it is, never who set it. */
function secretsView(def, rows, inUse) {
  const stored = new Map(rows.map((r) => [r.key, r]));
  return def.secrets.map(({ key }) => {
    const fromHere = inUse && (inUse.source === "saved" || def.keptHere.includes(key)) ? stored.get(key) : null;
    if (fromHere && fromHere.set)
      return { key, set: true, hint: fromHere.hint ?? null, set_by_name: fromHere.set_by_name || null, set_at: iso(fromHere.set_at) };
    const value = inUse ? inUse.secrets[key] : null;
    return { key, set: Boolean(value), hint: value ? hintOf(def, key, value) : null, set_by_name: null, set_at: null };
  });
}

function checkView(r) {
  return {
    integration_check_id: r.integration_check_id,
    code: r.code,
    kind: r.kind,
    ok: r.ok,
    steps: (Array.isArray(r.steps) ? r.steps : []).map((s) => ({
      key: s.key,
      ok: s.ok === null || s.ok === undefined ? null : Boolean(s.ok),
      ms: Number.isFinite(s.ms) ? Math.max(0, Math.round(s.ms)) : null,
      code: s.code ? known(s.code) : null,
      found: Array.isArray(s.found) ? s.found.slice(0, 6) : [],
    })),
    error_code: r.error_code ? known(r.error_code) : null,
    checked_by: r.checked_by || null,
    checked_by_name: r.checked_by_name || null,
    created_at: iso(r.created_at),
  };
}

/** Seven days of use, oldest first, today last; a day with no use is zeros. */
async function weekOf(connectionId) {
  const today = lagos.today();
  const from = lagos.addDays(today, -6);
  const found = connectionId ? new Map((await repo.usageDays(pool, connectionId, from, today)).map((d) => [d.day, d])) : new Map();
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const day = lagos.addDays(from, i);
    const d = found.get(day);
    days.push({
      day,
      calls: d ? Number(d.calls) : 0,
      failures: d ? Number(d.failures) : 0,
      units: d ? Math.round(Number(d.units) * 100) / 100 : 0,
    });
  }
  return days;
}

/** GET /integrations/:code */
async function get(code) {
  const def = providers.get(code);
  const row = await repo.connection(pool, code);
  const inUse = await settings.of(code);
  const usage = await weekOf(row ? row.integration_connection_id : null);
  const last = row ? await repo.lastCheck(pool, row.integration_connection_id) : null;
  return {
    ...rowOf(def, row, inUse, usage[usage.length - 1].units),
    saved_at: row ? iso(row.saved_at) : null,
    saved_by_name: row && row.saved_at ? row.saved_by_name || null : null,
    settings: inUse ? await settingsView(def, inUse) : null,
    secrets: secretsView(def, await repo.secretStates(pool, code), inUse),
    last_check: last ? checkView(last) : null,
    usage,
  };
}

/** GET /integrations/:code/checks */
async function checks(code, query) {
  providers.get(code);
  const row = await repo.connection(pool, code);
  if (!row) return envelope([], pageOf(query).number, 0);
  const page = await repo.checkPage(pool, row.integration_connection_id, query);
  return { ...page, data: page.data.map(checkView) };
}

/* ------------------------------------------------------------------ *
 * A failed test, on the field it is about (guide §6.3)
 * ------------------------------------------------------------------ */

/** Which field a failing step lands on, per connection and step. */
function fieldOf(code, step) {
  const host = code === "mailbox_server" ? `${step.key}_host` : "host";
  const port = code === "mailbox_server" ? `${step.key}_port` : "port";
  switch (step.code) {
    case "SERVER_NOT_FOUND":
    case "TLS_FAILED":
    case "CERTIFICATE_MISMATCH":
      return host;
    case "NO_ANSWER":
      return port;
    case "AUTH_FAILED":
      return "password";
    case "SENDER_REFUSED":
      return "from";
    case "KEY_REFUSED":
    case "OVER_QUOTA":
      return "api_key";
    default:
      return null;
  }
}

/** At most four words on a field (FRONTEND_GUIDE §5.3). */
const FIELD_ERROR = {
  SERVER_NOT_FOUND: "Server not found",
  NO_ANSWER: "No answer on port",
  TLS_FAILED: "Secure connection failed",
  CERTIFICATE_MISMATCH: "Certificate name differs",
  AUTH_FAILED: "Password refused",
  SENDER_REFUSED: "Sender refused",
  KEY_REFUSED: "Key refused",
  OVER_QUOTA: "Over today's quota",
};

/** One line above the form's footer when no field is to blame. */
const GENERAL = {
  UNAVAILABLE: "The service is not answering. Try again shortly.",
  TIMEOUT: "The service did not answer in time.",
  MODEL_NOT_FOUND: "None of the models this connection needs is on the key's list.",
  RECIPIENT_REFUSED: "The mail server refused the recipient.",
  SECRET_UNREADABLE: "The saved key cannot be read. Type it again.",
  NOT_SET_UP: "Nothing is set up to test.",
};

function testFailed(code, steps) {
  const step = steps.find((s) => s.ok === false) || { code: "UNAVAILABLE" };
  const field = fieldOf(code, step);
  if (field && FIELD_ERROR[step.code])
    return new AppError("TEST_FAILED", "The test failed. Check the marked field.", 422, { [field]: [FIELD_ERROR[step.code]] });
  return new AppError("TEST_FAILED", GENERAL[step.code] || GENERAL.UNAVAILABLE, 422);
}

/* ------------------------------------------------------------------ *
 * Saving
 * ------------------------------------------------------------------ */

/** Is this secret needed for the settings typed? A sender with no username signs in to nothing. */
function needed(def, key, body) {
  if (def.code === "mail_sender") return key === "password" && Boolean(body.username);
  return !def.keptHere.includes(key);
}

/** PUT /integrations/:code */
async function save(code, body, actor) {
  const def = providers.get(code);
  if (body.code !== code)
    throw new AppError("VALIDATION_FAILED", "These settings are for another connection.", 422, { code: ["Wrong connection"] });

  const before = await repo.connection(pool, code);
  const storedAt = before ? iso(before.saved_at) : null;
  const stale = () => new AppError("STALE", "Someone else changed these settings. Reload them.", 409);
  if ((body.saved_at || null) !== storedAt) throw stale();

  const typed = {};
  for (const { key } of def.secrets) if (!def.keptHere.includes(key) && body[key]) typed[key] = body[key];
  if (Object.keys(typed).length) await security.assertFresh(pool, actor);

  const configuration = def.toConfiguration(body);
  const values = def.fromSaved(configuration);
  // Web push's pair is made the first time it is needed; a contact can be saved before then.
  if (def.code === "web_push") await require("../../services/push/vapid").keys();
  const inUse = await settings.of(code);
  const savedHere = inUse && inUse.source === "saved" ? inUse : null;

  // The secrets the test uses: typed, else the one saved here unless its destination moved.
  const moved = Boolean(savedHere) && def.destination.some((f) => String(savedHere.values[f] ?? "") !== String(values[f] ?? ""));
  const secrets = {};
  for (const { key } of def.secrets) {
    if (def.keptHere.includes(key)) {
      secrets[key] = inUse ? inUse.secrets[key] : null;
      continue;
    }
    if (typed[key]) secrets[key] = typed[key];
    else if (savedHere && savedHere.secrets[key] && !moved) secrets[key] = savedHere.secrets[key];
    else if (needed(def, key, body))
      throw new AppError("SECRET_REQUIRED", moved ? "Type the password again for the new server." : "This is needed.", 422, {
        [key]: [moved ? "Type the password again" : "Required"],
      });
    else secrets[key] = null;
  }

  const collect = {};
  const steps = await testers.run(code, { code, source: "saved", values, secrets, unreadable: [] }, {
    actor,
    forSave: true,
    collect,
  });
  const ok = testers.passed(steps);
  if (!ok) {
    // Recorded, so its steps are on the Checks list. The connection in use is unchanged,
    // so its state is too: these were only the typed settings.
    await tx(async (client) => {
      const id = await state.ensure(client, code);
      await repo.insertCheck(client, { connectionId: id, kind: "save", ok: false, steps, error_code: testers.firstFailure(steps), by: actor.user_id });
    });
    throw testFailed(code, steps);
  }

  const dailyLimit = def.limited ? body.daily_limit ?? null : null;
  const plan = def.limited ? body.plan || (before && before.plan) || def.plan : null;
  await tx(async (client) => {
    const locked = await repo.connectionForUpdate(client, code);
    if ((locked ? iso(locked.saved_at) : null) !== storedAt) throw stale();
    const row = await repo.saveConnection(client, {
      code,
      provider: def.provider,
      name: def.name,
      configuration,
      daily_limit: dailyLimit,
      plan,
      by: actor.user_id,
    });
    await keepFetched(client, code, collect);
    for (const [key, value] of Object.entries(typed))
      await repo.putSecret(client, {
        code,
        key,
        ciphertext: encryption.encrypt(value, { aad: providers.aadOf(code, key) }),
        hint: hintOf(def, key, value),
        by: actor.user_id,
      });
    // A secret the settings no longer use (a sender without a username) is not kept.
    for (const { key } of def.secrets)
      if (!def.keptHere.includes(key) && secrets[key] === null)
        await client.query("DELETE FROM integration_secret WHERE provider = $1 AND key = $2", [code, key]);
    await repo.insertCheck(client, { connectionId: row.integration_connection_id, kind: "save", ok: true, steps, error_code: null, by: actor.user_id });
    await state.set(client, code, { ok: true, at: new Date(), checked: true });
    await emit(client, {
      key: EVENTS.INTEGRATION_SAVED,
      entity: { type: "integration", id: row.integration_connection_id },
      actor,
      before:
        before && before.saved_at
          ? { configuration: before.configuration, daily_limit: before.daily_limit, plan: before.plan || null }
          : undefined,
      after: { configuration, daily_limit: dailyLimit, plan },
      payload: {
        code,
        integration_connection_id: row.integration_connection_id,
        secrets_replaced: Object.keys(typed),
      },
    });
  });
  await changed(code);
  return get(code);
}

/**
 * Keep what a passing test fetched, in the caller's transaction: an AI connection's model list
 * (which models the key can use), or Exchange Rates' table for today.
 */
async function keepFetched(client, code, collect) {
  const def = providers.get(code);
  if (def.models && Array.isArray(collect.models)) {
    // Aliases, Gemma and snapshots with a base model are left off, unless a chain uses them.
    const { kept, dropped } = require("../../services/ai/catalogue").trim(def.models, collect.models, await repo.chainedModels(client, def.models));
    await repo.keepModels(client, def.models, kept, dropped);
  }
  if (code === "exchange_rates" && collect.rates)
    await repo.putRates(client, { ...collect.rates, day: lagos.today() });
}

/** After a connection, its plan or its model list changed: every process reads them again. */
async function changed(code) {
  quota.forget(code);
  jobs.forget();
  await settings.bump();
}

/** DELETE /integrations/:code */
async function remove(code, actor) {
  const def = providers.get(code);
  await security.assertFresh(pool, actor);
  await tx(async (client) => {
    const row = await repo.connectionForUpdate(client, code);
    if (!row || !row.saved_at) throw new AppError("NOT_FOUND", "Nothing is saved here for this connection.", 404);
    await repo.clearSaved(client, code);
    await repo.dropSecrets(client, code, [...def.keptHere]);
    await emit(client, {
      key: EVENTS.INTEGRATION_REMOVED,
      entity: { type: "integration", id: row.integration_connection_id },
      actor,
      before: { configuration: row.configuration, daily_limit: row.daily_limit, plan: row.plan || null },
      payload: { code, integration_connection_id: row.integration_connection_id },
    });
  });
  await changed(code);
}

/* ------------------------------------------------------------------ *
 * Testing
 * ------------------------------------------------------------------ */

/**
 * Keep a check of the settings in use, and move the connection's state by it.
 * @param {{audit?: boolean}} opts  audit: a person pressed it (the worker's watch is not audited)
 */
async function record(code, kind, steps, actor, { moveState, audit, collect = {} }) {
  const ok = testers.passed(steps);
  const fetched = ok && (collect.models || collect.rates);
  const id = await tx(async (client) => {
    const connectionId = await state.ensure(client, code);
    if (fetched) await keepFetched(client, code, collect);
    const check = await repo.insertCheck(client, {
      connectionId,
      kind,
      ok,
      steps,
      error_code: testers.firstFailure(steps),
      by: actor ? actor.user_id : null,
    });
    if (moveState) await state.set(client, code, { ok, error_code: testers.firstFailure(steps), at: new Date(), checked: true });
    if (audit)
      await emit(client, {
        key: EVENTS.INTEGRATION_TESTED,
        entity: { type: "integration", id: connectionId },
        actor,
        payload: { code, kind, ok, error_code: testers.firstFailure(steps) },
      });
    return check.integration_check_id;
  });
  if (fetched) await changed(code);
  return checkView(await repo.checkById(pool, id));
}

/** POST /integrations/:code/test */
async function test(code, body, actor) {
  const inUse = await settings.of(code);
  const collect = {};
  const steps = await testers.run(code, inUse, { actor, address: body.address, collect });
  return record(code, "test", steps, actor, { moveState: Boolean(inUse), audit: true, collect });
}

/** POST /integrations/mail_sender/test-email */
async function testEmail(actor) {
  if (!actor.email) throw new AppError("NO_WORK_EMAIL", "Your login has no email to send the test to.", 422);
  const inUse = await settings.of("mail_sender");
  const steps = await testers.run("mail_sender", inUse, { actor });
  if (testers.passed(steps)) {
    const systemMail = require("../../services/mail/system-mail.service");
    const started = Date.now();
    try {
      await systemMail.send({
        to: { name: actor.display_name || undefined, email: actor.email },
        template: "integration-test",
        data: { connection: "System Sender", tested_by: actor.display_name || actor.email },
      });
      steps.push({ key: "send", ok: true, ms: Date.now() - started, code: null, found: [] });
    } catch (err) {
      if (err && err.code === "MAIL_PACED") {
        const at = lagos.timeOf(new Date(Date.now() + (err.retryAfterMs || 0)));
        throw new AppError("MAIL_PACED", `The hourly limit is reached. Try at ${at}.`, 429);
      }
      steps.push({
        key: "send",
        ok: false,
        ms: Date.now() - started,
        code: require("../../services/mail/smtp-errors").stepCodeOf(err),
        found: [],
      });
    }
  } else {
    steps.push({ key: "send", ok: null, ms: null, code: "SKIPPED", found: [] });
  }
  return record("mail_sender", "test_email", steps, actor, { moveState: Boolean(inUse), audit: true });
}

/** POST /integrations/web_push/replace-keys */
async function replaceKeys(actor) {
  const vapid = require("../../services/push/vapid");
  await security.assertFresh(pool, actor);
  const pair = vapid.generate();
  await tx(async (client) => {
    const connectionId = await state.ensure(client, "web_push");
    await repo.putSecret(client, {
      code: "web_push",
      key: "vapid",
      ciphertext: encryption.encrypt(JSON.stringify(pair), { aad: providers.aadOf("web_push", "vapid") }),
      hint: vapid.keyIdOf(pair.publicKey),
      by: actor.user_id,
    });
    await emit(client, {
      key: EVENTS.INTEGRATION_KEYS_REPLACED,
      entity: { type: "integration", id: connectionId },
      actor,
      payload: { code: "web_push", integration_connection_id: connectionId, key_id: vapid.keyIdOf(pair.publicKey) },
    });
  });
  await settings.bump();
  return get("web_push");
}

/* ------------------------------------------------------------------ *
 * An AI connection's model list (guide §1.2 decisions 2 and 3)
 * ------------------------------------------------------------------ */

/** The connection's provider, or a 404 for a connection that keeps no model list. */
function aiDef(code) {
  const def = providers.get(code);
  if (!def.models) throw new AppError("NOT_FOUND", "This connection has no model list.", 404);
  return def;
}

function modelView(r, inUse) {
  return {
    ai_model_id: r.ai_model_id,
    provider: r.provider,
    model: r.model,
    display_name: r.display_name,
    capabilities: Array.isArray(r.capabilities) ? r.capabilities : [],
    available: r.available === null || r.available === undefined ? null : Boolean(r.available),
    source: r.source,
    endpoint_url: r.endpoint_url || null,
    input_usd_per_million: r.input_usd_per_million ?? null,
    output_usd_per_million: r.output_usd_per_million ?? null,
    audio_usd_per_million: r.audio_usd_per_million ?? null,
    usd_per_audio_hour: r.usd_per_audio_hour ?? null,
    in_use: inUse
      .filter((u) => u.model.toLowerCase() === String(r.model).toLowerCase())
      .map((u) => ({ job: u.job, position: u.position, model: u.model, display_name: u.display_name })),
    seen_at: iso(r.seen_at),
    added_by_name: r.added_by_name || null,
    created_at: iso(r.created_at),
  };
}

/** GET /integrations/:code/models */
async function models(code, query) {
  const def = aiDef(code);
  const page = await repo.modelPage(pool, def.models, query);
  const inUse = await jobs.inUse(def.models, { db: pool });
  return { ...page, data: page.data.map((r) => modelView(r, inUse)) };
}

/** Anthropic's list is Sonnet and Haiku only (decision 3). */
const ALLOWED_MODEL = { anthropic: /^claude-(sonnet|haiku)-/i };

/** POST /integrations/:code/models: Add Model. */
async function addModel(code, body, actor) {
  const def = aiDef(code);
  const allowed = ALLOWED_MODEL[def.models];
  if (allowed && !allowed.test(body.model))
    throw new AppError("VALIDATION_FAILED", "Only Sonnet and Haiku models are used here.", 422, { model: ["Sonnet or Haiku only"] });
  const id = await tx(async (client) => {
    const row = await repo.addModel(client, {
      provider: def.models,
      model: body.model,
      display_name: body.display_name || body.model,
      capabilities: body.capabilities,
      endpoint_url: body.endpoint_url || null,
      by: actor.user_id,
    });
    if (!row) throw new AppError("ALREADY_LISTED", "This model is already on the list.", 409, { model: ["Already on the list"] });
    const connectionId = await state.ensure(client, code);
    await emit(client, {
      key: EVENTS.INTEGRATION_MODEL_ADDED,
      entity: { type: "integration", id: connectionId },
      actor,
      after: { model: body.model, capabilities: body.capabilities, endpoint_url: body.endpoint_url || null },
      payload: { code, ai_model_id: row.ai_model_id, model: body.model },
    });
    return row.ai_model_id;
  });
  await changed(code);
  const inUse = await jobs.inUse(def.models, { db: pool });
  return modelView(await repo.modelById(pool, def.models, id), inUse);
}

/** DELETE /integrations/:code/models/:id: only a model added by hand comes off the list. */
async function removeModel(code, id, actor) {
  const def = aiDef(code);
  await tx(async (client) => {
    const row = await repo.removeModel(client, def.models, id);
    if (!row) throw new AppError("NOT_FOUND", "Only a model added here can be removed.", 404);
    const connectionId = await state.ensure(client, code);
    await emit(client, {
      key: EVENTS.INTEGRATION_MODEL_REMOVED,
      entity: { type: "integration", id: connectionId },
      actor,
      before: { model: row.model },
      payload: { code, ai_model_id: row.ai_model_id, model: row.model },
    });
  });
  await changed(code);
}

/* ------------------------------------------------------------------ *
 * Exchange rates (guide §1.2 decision 10)
 * ------------------------------------------------------------------ */

/**
 * Fetch today's rates and keep them, recorded as a check of kind `sync`. Sync Rates (a person,
 * audited) always fetches; the hourly job (`actor` null) fetches only while today's table is
 * missing, so after midnight's success it spends nothing until the next day, and a failure is
 * tried again within the hour. A Free plan at its daily limit is not asked.
 * @param {object|null} actor
 * @returns {Promise<object|null>} the check, or null when the job had nothing to do
 */
async function syncRates(actor) {
  const inUse = await settings.of("exchange_rates");
  if (!actor) {
    if (!inUse || !inUse.secrets.api_key) return null;
    if (await repo.hasRates(pool, lagos.today())) return null;
  }
  let steps;
  const collect = {};
  if (inUse && (await quota.spent("exchange_rates"))) steps = [{ key: "rates", ok: false, ms: 0, code: "OVER_QUOTA", found: [] }];
  else steps = await testers.run("exchange_rates", inUse, { actor, collect });
  return record("exchange_rates", "sync", steps, actor, { moveState: Boolean(inUse), audit: Boolean(actor), collect });
}

/* ------------------------------------------------------------------ *
 * The worker
 * ------------------------------------------------------------------ */

/**
 * A model's dollar prices, in the caller's transaction: AI Control's Accept and Edit Price, which
 * emit their own event (docs/guides/ai-control.md §3 step 3). The model list is this module's.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {string} id  ai_model_id
 * @param {object} prices  the five dollar prices, each a string or null
 * @returns {Promise<object|null>} the model's prices after, or null when there is no such model
 */
function setModelPrices(client, id, prices) {
  return repo.setModelPrices(client, id, prices);
}

/**
 * Every 15 minutes (integrations-watch): the connections whose test costs nothing are tested
 * and their state moved; then each daily limit is compared with today's use, and IT is told
 * once a day when one passes 80% (guide §3 steps 10 and 11), except for an AI provider.
 */
async function watch() {
  let tested = 0;
  for (const def of providers.PROVIDERS) {
    if (!def.watched) continue;
    const inUse = await settings.of(def.code);
    if (!inUse) continue;
    await record(def.code, "watch", await testers.run(def.code, inUse, { forWatch: true }), null, { moveState: true, audit: false });
    tested += 1;
  }
  const today = lagos.today();
  let warned = 0;
  for (const r of await repo.connections(pool, today)) {
    const def = providers.has(r.code) ? providers.get(r.code) : null;
    if (!def || !def.limited || !r.daily_limit) continue;
    // AI warns nobody: AI Control · Spend and this page show where each provider stands
    // (docs/guides/ai-control.md decision 26).
    if (def.models) continue;
    if (Number(r.units_today) < WARN_AT * Number(r.daily_limit)) continue;
    await tx(async (client) => {
      const id = await repo.markWarned(client, r.code, today);
      if (!id) return;
      await emit(client, {
        key: EVENTS.INTEGRATION_QUOTA_WARNING,
        entity: { type: "integration", id },
        actor: null,
        payload: { code: r.code, units: Math.round(Number(r.units_today)), daily_limit: Number(r.daily_limit) },
        dedup_key: `integrations:quota:${r.code}:${today}`,
      });
      warned += 1;
    });
  }
  return { tested, warned };
}

/** Nightly (integrations-purge). */
function purge() {
  return repo.purge(pool);
}

module.exports = {
  list,
  summary,
  get,
  checks,
  save,
  remove,
  test,
  testEmail,
  replaceKeys,
  models,
  addModel,
  removeModel,
  setModelPrices,
  syncRates,
  watch,
  purge,
  fieldOf,
  WARN_AT,
};
