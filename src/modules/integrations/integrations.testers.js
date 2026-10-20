"use strict";
/**
 * How each connection is tested (docs/guides/integrations.md §6.3, §6.6): a list of steps,
 * each passed, failed or skipped, with its time and, on a failure, its code.
 *
 *   const steps = await testers.run("geoapify", inUse, { address: "Admiralty Way" });
 *   // → [{ key: "search", ok: true, ms: 212, code: null, found: ["Admiralty Way, ..."] }, ...]
 *
 * `inUse` is what shared/integrations/settings.js answers (values and secrets), or the
 * same shape built from a form before it is saved. Nothing here stores anything, throws,
 * or puts a secret in a step: the service records the steps it is given. What a test fetched
 * that the service keeps (an AI connection's model list, a table of exchange rates) is handed
 * back in `opts.collect`.
 *
 * Every step has its own limit and the whole test ends within 45 seconds. A step after a
 * failed one it depends on is skipped (`ok` null, `SKIPPED`), not run.
 */
const geoapify = require("../../services/maps/geoapify.service");
const tlsCheck = require("../../services/mail/tls-check");
const systemMail = require("../../services/mail/system-mail.service");
const ai = require("../../services/ai/llm.service");
const jobs = require("../../services/ai/jobs");
const fx = require("../../services/fx/exchangerate-api");
const vapid = require("../../services/push/vapid");
const money = require("../../shared/money/money");
const providers = require("../../shared/integrations/providers");
const usage = require("../../shared/integrations/usage");
const { stepCodeOf } = require("../../services/mail/smtp-errors");

/** The longest one test may take, whatever its steps' own limits say. */
const TEST_MS = 45_000;

class StepTimeout extends Error {
  constructor(ms) {
    super(`no answer within ${ms} ms`);
    this.code = "STEP_TIMEOUT";
  }
}

function within(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new StepTimeout(ms)), ms);
      if (t.unref) t.unref();
    }),
  ]).finally(() => clearTimeout(t));
}

/** A mail server's or a network's failure as a step code (contract StepCode). */
const mailCode = (err) => (err instanceof StepTimeout ? "TIMEOUT" : stepCodeOf(err));

/** Run one step: its time, and its code when it fails. `work` returns what it found, if anything. */
async function step(key, work, { ms, codeOf }) {
  const started = Date.now();
  try {
    const found = await within(Promise.resolve().then(work), ms);
    return {
      key,
      ok: true,
      ms: Date.now() - started,
      code: null,
      found: Array.isArray(found) ? found.map((f) => String(f).slice(0, 300)).slice(0, 6) : [],
    };
  } catch (err) {
    return { key, ok: false, ms: Date.now() - started, code: err instanceof StepTimeout ? "TIMEOUT" : codeOf(err), found: [] };
  }
}

const skipped = (key) => ({ key, ok: null, ms: null, code: "SKIPPED", found: [] });

/** One step that says why there is nothing to test. */
const nothing = (code) => [{ key: "setup", ok: false, ms: 0, code, found: [] }];

/** Run steps in order; once one fails, the rest are skipped. */
async function inOrder(list) {
  const out = [];
  let failed = false;
  for (const [key, work, opts] of list) {
    if (failed) {
      out.push(skipped(key));
      continue;
    }
    const s = await step(key, work, opts);
    out.push(s);
    if (s.ok === false) failed = true;
  }
  return out;
}

/** The domain a blank staff mail host stands for: the system sender's From domain. */
async function mailDomain() {
  const sender = await require("../../shared/integrations/settings").of("mail_sender");
  const from = (sender && sender.values.from) || require("../../config/env").config.MAIL_FROM;
  const m = /@([^@\s>]+)>?\s*$/.exec(String(from || ""));
  return m ? m[1].toLowerCase() : "mycityapp.io";
}

/** What each job is called where a person reads it (a step's findings). */
const JOB_WORDS = {
  default: "Default",
  fast: "Fast",
  deep_reasoning: "Deep Reasoning",
  image_reading: "Image Reading",
  transcription: "Transcription",
  embeddings: "Embeddings",
  top_tier: "Top Tier",
};

/** The model a provider's test asks: the cheapest that shows the key answers. */
const ANSWER_FAMILY = { gemini: /^gemini-[\d.]+-flash(-lite)?$/i, anthropic: /^claude-haiku-/i, openai: /^text-embedding-3-small$/i, deepseek: /flash|chat/i };

function answerModel(provider, models) {
  if (provider === "gemini") {
    const first = jobs.chainFrom("default", { gemini: models })[0];
    if (first) return first.model;
  }
  const re = ANSWER_FAMILY[provider];
  const wanted = provider === "openai" ? "embeddings" : "text";
  const usable = models.filter((m) => m.capabilities.includes(wanted));
  const m = usable.find((x) => re && re.test(x.model)) || usable[0];
  return m ? m.model : null;
}

class NoModel extends Error {
  constructor() {
    super("no model this connection's jobs need is on the key's list");
    this.code = "MODEL_NOT_FOUND";
  }
}

/**
 * An AI connection: the key accepted (its model list, free); the models its jobs need are on
 * it, named in the step's findings; then one tiny request, recorded in the AI ledger.
 * @param {string} provider
 * @param {{answer?: boolean}} [o]  answer: false skips the paid request
 */
function aiTester(provider, { answer = true } = {}) {
  return async (inUse, { actor, collect } = {}) => {
    const apiKey = inUse.secrets.api_key;
    if (!apiKey) return nothing(inUse.unreadable.includes("api_key") ? "SECRET_UNREADABLE" : "NOT_SET_UP");
    const opts = { ms: 22_000, codeOf: ai.callCode };
    let models = [];
    const list = [
      [
        "key",
        async () => {
          models = await ai.checkKey({ provider, apiKey });
          if (collect) collect.models = models;
          return [];
        },
        opts,
      ],
      [
        "models",
        () => {
          const mine = { [provider]: models.map((m) => ({ ...m, available: true })) };
          const found = [];
          for (const job of jobs.JOBS) {
            const c = jobs.chainFrom(job, mine)[0];
            if (c) found.push(`${JOB_WORDS[job]}: ${c.display_name}`);
          }
          if (found.length) return found;
          // A provider no job uses yet (DeepSeek): a list with anything on it is enough.
          if (models.length) return models.map((m) => m.display_name);
          throw new NoModel();
        },
        { ms: 1000, codeOf: () => "MODEL_NOT_FOUND" },
      ],
    ];
    if (answer)
      list.push([
        "answer",
        () => {
          const model = answerModel(provider, models);
          if (!model) throw new NoModel();
          return ai.testAnswer({ provider, apiKey, model, actor }).then(() => []);
        },
        { ms: 22_000, codeOf: (err) => (err instanceof NoModel ? "MODEL_NOT_FOUND" : ai.callCode(err)) },
      ]);
    return inOrder(list);
  };
}

const TESTERS = {
  /** The system sender: reach the server (TLS as configured), then sign in. */
  async mail_sender(inUse) {
    const v = inUse.values;
    const steps = [["connect", () => systemMail.verifyWith(v, null), { ms: 15_000, codeOf: mailCode }]];
    if (v.username)
      steps.push(["sign_in", () => systemMail.verifyWith(v, inUse.secrets.password), { ms: 15_000, codeOf: mailCode }]);
    return inOrder(steps);
  },

  /** The staff mail server: IMAP and SMTP each reachable over TLS with a certificate for its name. */
  async mailbox_server(inUse) {
    const v = inUse.values;
    const domain = !v.imap_host || !v.smtp_host ? await mailDomain() : null;
    const one = (protocol, host, port) => [
      protocol,
      () => tlsCheck.check({ host: host || domain, port, protocol, tls: v.tls !== false, timeoutMs: 10_000 }).then(() => []),
      { ms: 12_000, codeOf: tlsCheck.codeOf },
    ];
    // Both are checked even when the first fails: they are different servers, often.
    return [
      await step(...one("imap", v.imap_host, v.imap_port)),
      await step(...one("smtp", v.smtp_host, v.smtp_port)),
    ];
  },

  /** Geoapify: an address search with the address typed, a reverse lookup, one map tile. */
  async geoapify(inUse, { address } = {}) {
    const apiKey = inUse.secrets.api_key;
    if (!apiKey) return nothing(inUse.unreadable.includes("api_key") ? "SECRET_UNREADABLE" : "NOT_SET_UP");
    const text = String(address || providers.LAGOS.address);
    const { lat, lon } = providers.LAGOS;
    const t = geoapify.tileOf(lat, lon, 15);
    const opts = { ms: 6_000, codeOf: geoapify.codeOf };
    const steps = await inOrder([
      ["search", async () => (await geoapify.searchPlaces(text, { apiKey, fresh: true })).map((p) => p.formatted), opts],
    ]);
    // A refused key fails every call alike; anything else, each call is worth trying.
    if (steps[0].code === "KEY_REFUSED") return [...steps, skipped("reverse"), skipped("tile")];
    steps.push(await step("reverse", async () => {
      const at = await geoapify.reverseGeocode(lat, lon, { apiKey, fresh: true });
      return at ? [at] : [];
    }, opts));
    steps.push(await step("tile", () => geoapify.tile(t.z, t.x, t.y, { apiKey, fresh: true }).then(() => []), opts));
    return steps;
  },

  gemini: aiTester("gemini"),
  // Groq's test spends nothing: a transcription would use at least ten of its free seconds.
  groq: aiTester("groq", { answer: false }),
  openai: aiTester("openai"),
  anthropic: aiTester("anthropic"),
  deepseek: aiTester("deepseek"),

  /** Exchange Rates: one fetch of today's table, which a save or a test then keeps. */
  async exchange_rates(inUse, { collect } = {}) {
    const apiKey = inUse.secrets.api_key;
    if (!apiKey) return nothing(inUse.unreadable.includes("api_key") ? "SECRET_UNREADABLE" : "NOT_SET_UP");
    return inOrder([
      [
        "rates",
        async () => {
          let t;
          try {
            t = await fx.latest({ apiKey, base: "USD" });
          } catch (err) {
            usage.record("exchange_rates", "rates", { ok: false, error_code: err.code });
            throw err;
          }
          usage.record("exchange_rates", "rates", { ok: true });
          if (collect) collect.rates = t;
          const ngn = t.rates.NGN;
          return [ngn ? `1 USD = ${money.formatNaira(money.round(ngn))}` : "No naira rate", `${Object.keys(t.rates).length} currencies`];
        },
        { ms: 12_000, codeOf: (err) => (err && err.code) || "UNAVAILABLE" },
      ],
    ]);
  },

  /**
   * Web push: the pair signs a token; then a test push to the tester's own devices, if any.
   * Before a save only the pair is checked: a save is not a reason to buzz a phone.
   */
  async web_push(inUse, { actor, forSave } = {}) {
    if (inUse.unreadable.includes("vapid")) return nothing("SECRET_UNREADABLE");
    const pair = inUse.secrets.vapid ? JSON.parse(inUse.secrets.vapid) : null;
    if (!pair) return nothing("NOT_SET_UP");
    const steps = await inOrder([
      ["keys", () => vapid.sign(pair, inUse.values.subject).then(() => []), { ms: 5_000, codeOf: () => "KEY_REFUSED" }],
    ]);
    if (forSave) return steps;
    if (steps[0].ok !== true) return [...steps, skipped("push")];
    const notifications = require("../notifications/notifications.service");
    // Queued for the tester's own devices, the same way Send Test Notification does it.
    const sent = await step("push", () => notifications.sendTestPush(actor, {}).then(() => []), {
      ms: 15_000,
      codeOf: (err) => (err && err.code === "NO_DEVICE" ? "NO_DEVICES" : "UNAVAILABLE"),
    });
    // No device is not a failure of the keys: the step is skipped, not failed.
    if (sent.code === "NO_DEVICES") steps.push({ ...sent, ok: null });
    else steps.push(sent);
    return steps;
  },
};

/**
 * Test a connection's settings.
 * @param {string} code
 * @param {{values: object, secrets: object, unreadable: string[]}|null} inUse  null: not set up
 * @param {{address?: string, actor?: object, forSave?: boolean, forWatch?: boolean, collect?: object}} [opts]
 *   forSave   the typed settings before a save: nothing a person would notice is sent
 *   forWatch  the worker's watch: only connections whose test costs nothing are asked
 *   collect   filled with what the test fetched that is worth keeping: `models` (an AI
 *             connection's list), `rates` (Exchange Rates' table)
 * @returns {Promise<Array<{key: string, ok: boolean|null, ms: number|null, code: string|null, found: string[]}>>}
 */
async function run(code, inUse, opts = {}) {
  providers.get(code);
  if (!inUse) return nothing("NOT_SET_UP");
  const unreadable = inUse.unreadable || [];
  const def = providers.get(code);
  if (def.secrets.some((s) => s.key === "password") && unreadable.includes("password")) return nothing("SECRET_UNREADABLE");
  try {
    return await within(TESTERS[code]({ ...inUse, unreadable }, opts), TEST_MS);
  } catch {
    return nothing("TIMEOUT");
  }
}

/** A run passed when no step failed; a skipped step is not a failure. */
const passed = (steps) => steps.length > 0 && steps.every((s) => s.ok !== false);

/** The first failure's code, or null. */
const firstFailure = (steps) => {
  const f = steps.find((s) => s.ok === false);
  return f ? f.code : null;
};

module.exports = { run, passed, firstFailure, mailCode, mailDomain, answerModel, JOB_WORDS, TEST_MS };
