"use strict";
/**
 * Integrations without a database (docs/guides/integrations.md): the registry, the one reader
 * of settings and the order it takes them in, counting, the testers' steps and what each
 * failure is called, and where a failed test lands on the form. The routes, the database and
 * the rules about secrets are tests/integration/integrations.test.js.
 */
const encryption = require("../../services/secrets/encryption.service");
const providers = require("../../shared/integrations/providers");
const settings = require("../../shared/integrations/settings");
const usage = require("../../shared/integrations/usage");
const tlsCheck = require("../../services/mail/tls-check");
const { stepCodeOf } = require("../../services/mail/smtp-errors");
const geoapify = require("../../services/maps/geoapify.service");
const ai = require("../../services/ai/llm.service");
const systemMail = require("../../services/mail/system-mail.service");
const testers = require("./integrations.testers");
const service = require("./integrations.service");

/** A database that answers the reader's two queries from what a test puts in it. */
function fakeDb({ row = null, secrets = [] } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/^SELECT integration_connection_id FROM integration_connection WHERE code/.test(sql))
        return { rows: [{ integration_connection_id: "c1" }] };
      if (/FROM integration_connection WHERE code/.test(sql)) return { rows: row ? [row] : [] };
      if (/FROM integration_secret/.test(sql)) return { rows: secrets };
      return { rows: [], rowCount: 1 };
    },
  };
}

const bound = (code, key, value) => encryption.encrypt(value, { aad: providers.aadOf(code, key) });

describe("the registry", () => {
  test("holds the ten connections in the page's order, each in its group", () => {
    expect(providers.PROVIDERS.map((p) => [p.code, p.group])).toEqual([
      ["mail_sender", "mail"],
      ["mailbox_server", "mail"],
      ["geoapify", "maps"],
      ["gemini", "ai"],
      ["groq", "ai"],
      ["openai", "ai"],
      ["anthropic", "ai"],
      ["deepseek", "ai"],
      ["exchange_rates", "finance"],
      ["web_push", "notifications"],
    ]);
    expect(providers.AI.map((p) => p.models)).toEqual(["gemini", "groq", "openai", "anthropic", "deepseek"]);
    expect(() => providers.get("nothing")).toThrow(/no connection/);
  });

  test("a password shows nothing, a key its last four, a pair its id", () => {
    const hints = Object.fromEntries(providers.PROVIDERS.flatMap((p) => p.secrets.map((s) => [`${p.code}.${s.key}`, s.hint])));
    expect(hints).toEqual({
      "mail_sender.password": "none",
      "geoapify.api_key": "last4",
      "gemini.api_key": "last4",
      "groq.api_key": "last4",
      "openai.api_key": "last4",
      "anthropic.api_key": "last4",
      "deepseek.api_key": "last4",
      "exchange_rates.api_key": "last4",
      "web_push.vapid": "key_id",
    });
  });

  test("only free tests are watched; the counted services carry a daily limit and start on a plan", () => {
    expect(providers.PROVIDERS.filter((p) => p.watched).map((p) => p.code)).toEqual(["mail_sender", "mailbox_server"]);
    expect(providers.PROVIDERS.filter((p) => p.limited).map((p) => [p.code, p.plan])).toEqual([
      ["geoapify", "free"],
      ["gemini", "paid"],
      ["groq", "free"],
      ["openai", "paid"],
      ["anthropic", "paid"],
      ["deepseek", "paid"],
      ["exchange_rates", "free"],
    ]);
    expect(providers.PROVIDERS.filter((p) => !p.limited).every((p) => p.plan === null)).toBe(true);
    expect(providers.get("geoapify").units).toEqual({ search: 1, reverse: 1, tile: 0.25 });
    // Groq's daily limit counts seconds of audio; its free test calls count nothing toward it.
    expect(providers.get("groq").units).toEqual({ transcribe: 1, call: 0 });
  });

  test("the new connections have no server-file fallback: they are set on the page", () => {
    for (const code of ["groq", "openai", "anthropic", "deepseek", "exchange_rates"])
      expect(providers.get(code).fromFile({ GEMINI_API_KEY: "x" })).toBeNull();
  });

  test("the server file: a sender only with a host, the staff mail server always", () => {
    const sender = providers.get("mail_sender");
    expect(sender.fromFile({ SMTP_HOST: "" })).toBeNull();
    expect(
      sender.fromFile({
        SMTP_HOST: "mycityapp.io",
        SMTP_PORT: 465,
        SMTP_SECURE: true,
        SMTP_USER: "no-reply@mycityapp.io",
        SMTP_PASSWORD: "pw",
        MAIL_FROM: "MyCity App <no-reply@mycityapp.io>",
        MAIL_REPLY_TO: "",
        MAIL_SEND_PER_HOUR: 0,
        SMTP_LOCAL_DOMAINS: "mycityapp.io",
      }),
    ).toEqual({
      values: {
        host: "mycityapp.io",
        port: 465,
        security: "tls",
        username: "no-reply@mycityapp.io",
        from: "MyCity App <no-reply@mycityapp.io>",
        reply_to: null,
        per_hour: null,
        local_domains: "mycityapp.io",
      },
      secrets: { password: "pw" },
    });
    const server = providers.get("mailbox_server").fromFile({
      MAILBOX_IMAP_HOST: "",
      MAILBOX_IMAP_PORT: 993,
      MAILBOX_SMTP_HOST: "",
      MAILBOX_SMTP_PORT: 465,
      MAILBOX_SEND_PER_HOUR: 50,
      MAILBOX_SYNC_EVERY_MIN: 2,
      MAILBOX_IDLE_MAX: 0,
      MAILBOX_TLS: true,
    });
    expect(server.values).toMatchObject({ imap_host: null, smtp_host: null, tls: true, live_connections: 0 });
    // TLS is never off for settings saved on the page (guide §1.1).
    expect(providers.get("mailbox_server").fromSaved({ imap_port: 993 }).tls).toBe(true);
  });
});

describe("a secret bound to its record", () => {
  test("decrypts with its own record's name, and with no other", () => {
    const stored = bound("geoapify", "api_key", "geo-1234");
    expect(encryption.isBound(stored)).toBe(true);
    expect(encryption.decrypt(stored, { aad: "integration_secret:geoapify:api_key" })).toBe("geo-1234");
    expect(() => encryption.decrypt(stored, { aad: "integration_secret:gemini:api_key" })).toThrow();
    expect(() => encryption.decrypt(stored)).toThrow(/bound to its record/);
  });

  test("a value written before binding still reads, with or without one", () => {
    const old = encryption.encrypt("mailbox-password");
    expect(encryption.isBound(old)).toBe(false);
    expect(encryption.decrypt(old)).toBe("mailbox-password");
    expect(encryption.decrypt(old, { aad: "anything" })).toBe("mailbox-password");
  });
});

describe("the one reader", () => {
  beforeEach(() => settings.forget());

  test("a saved connection wins, whole: no field comes from the file", async () => {
    const db = fakeDb({
      row: { integration_connection_id: "c1", saved_at: new Date("2026-10-20T09:00:00Z"), configuration: { host: "smtp.saved.test", port: 587, security: "starttls", username: null, from: "a@b.test", reply_to: null, per_hour: 10 } },
      secrets: [],
    });
    const s = await settings.of("mail_sender", { db });
    expect(s).toMatchObject({ source: "saved", values: { host: "smtp.saved.test", security: "starttls", per_hour: 10 }, secrets: { password: null } });
  });

  test("nothing saved: the file; nothing in the file either: not set up", async () => {
    expect(await settings.of("geoapify", { db: fakeDb() })).toEqual(
      require("../../config/env").config.GEOAPIFY_API_KEY ? expect.objectContaining({ source: "file" }) : null,
    );
    settings.forget();
    const server = await settings.of("mailbox_server", { db: fakeDb() });
    expect(server.source).toBe("file");
  });

  test("a saved key that no longer decrypts is named, and the file is not used instead", async () => {
    const db = fakeDb({
      row: { integration_connection_id: "c1", saved_at: new Date(), configuration: {} },
      secrets: [{ key: "api_key", ciphertext: bound("gemini", "api_key", "not-for-geoapify") }],
    });
    const s = await settings.of("geoapify", { db });
    expect(s).toMatchObject({ source: "saved", secrets: { api_key: null }, unreadable: ["api_key"] });
  });

  test("web push is read in parts: the pair kept here even when nothing is saved", async () => {
    const pair = JSON.stringify({ publicKey: "BPub", privateKey: "priv" });
    const db = fakeDb({ row: null, secrets: [{ key: "vapid", ciphertext: bound("web_push", "vapid", pair) }] });
    const s = await settings.of("web_push", { db });
    expect(s).toMatchObject({ source: "saved", secrets: { vapid: pair } });
    expect(s.values.subject).toMatch(/^(mailto:|https:)/);
  });

  test("an answer is kept until the version moves", async () => {
    const db = fakeDb();
    await settings.of("mailbox_server", { db });
    await settings.of("mailbox_server", { db });
    expect(db.calls.filter((c) => /integration_connection/.test(c.sql))).toHaveLength(1);
    await settings.bump();
    await settings.of("mailbox_server", { db });
    expect(db.calls.filter((c) => /integration_connection/.test(c.sql))).toHaveLength(2);
  });
});

describe("counting real use", () => {
  beforeEach(() => usage.__reset());
  afterAll(() => usage.__reset());

  test("calls, failures and units add up per connection, day and kind", () => {
    usage.record("geoapify", "tile");
    usage.record("geoapify", "tile");
    usage.record("geoapify", "search", { ok: false, error_code: "KEY_REFUSED" });
    usage.record("mail_sender", "send", { units: 3 });
    const byKind = Object.fromEntries(usage.pending().map((c) => [`${c.code}.${c.kind}`, c]));
    expect(byKind["geoapify.tile"]).toMatchObject({ calls: 2, failures: 0, units: 0.5 });
    expect(byKind["geoapify.search"]).toMatchObject({ calls: 1, failures: 1, units: 1 });
    expect(byKind["mail_sender.send"]).toMatchObject({ calls: 1, units: 3 });
  });

  test("a kind a connection does not count is logged, never thrown at the caller", () => {
    expect(() => usage.record("geoapify", "push")).not.toThrow();
    expect(usage.pending()).toEqual([]);
  });

  test("a flush writes one upsert per counter, then the newest state", async () => {
    usage.record("gemini", "call", { ok: false, error_code: "OVER_QUOTA" });
    const db = fakeDb();
    expect(await usage.flush({ db })).toBe(1);
    const sql = db.calls.map((c) => c.sql).join("\n");
    expect(sql).toMatch(/INSERT INTO integration_usage/);
    expect(sql).toMatch(/UPDATE integration_connection SET/);
    expect(usage.pending()).toEqual([]);
  });
});

describe("what a failure is called", () => {
  test("network and TLS failures, from Node and from nodemailer alike", () => {
    expect(tlsCheck.codeOf({ code: "ENOTFOUND" })).toBe("SERVER_NOT_FOUND");
    expect(tlsCheck.codeOf({ code: "ECONNECTION", message: "connect ECONNREFUSED 10.0.0.1:465" })).toBe("NO_ANSWER");
    expect(tlsCheck.codeOf({ code: "ERR_TLS_CERT_ALTNAME_INVALID", message: "Hostname/IP does not match certificate's altnames" })).toBe(
      "CERTIFICATE_MISMATCH",
    );
    expect(tlsCheck.codeOf({ code: "CERT_HAS_EXPIRED", message: "certificate has expired" })).toBe("TLS_FAILED");
  });

  test("a mail server's own refusals", () => {
    expect(stepCodeOf({ code: "EAUTH", responseCode: 535, message: "Invalid login" })).toBe("AUTH_FAILED");
    expect(stepCodeOf({ responseCode: 553, response: "553 sender address rejected" })).toBe("SENDER_REFUSED");
    expect(stepCodeOf({ code: "EDNS", message: "lookup failed" })).toBe("SERVER_NOT_FOUND");
    expect(stepCodeOf({ message: "something else" })).toBe("UNAVAILABLE");
  });

  test("a failed step lands on the field it is about", () => {
    expect(service.fieldOf("mail_sender", { key: "connect", code: "SERVER_NOT_FOUND" })).toBe("host");
    expect(service.fieldOf("mail_sender", { key: "sign_in", code: "AUTH_FAILED" })).toBe("password");
    expect(service.fieldOf("mailbox_server", { key: "smtp", code: "NO_ANSWER" })).toBe("smtp_port");
    expect(service.fieldOf("mailbox_server", { key: "imap", code: "CERTIFICATE_MISMATCH" })).toBe("imap_host");
    expect(service.fieldOf("geoapify", { key: "search", code: "KEY_REFUSED" })).toBe("api_key");
    expect(service.fieldOf("gemini", { key: "answer", code: "TIMEOUT" })).toBeNull();
  });
});

describe("the testers", () => {
  afterEach(() => jest.restoreAllMocks());

  const inUse = (code, values = {}, secrets = {}) => ({ code, source: "saved", values, secrets, unreadable: [] });

  test("nothing set up is one step, and a test never throws", async () => {
    expect(await testers.run("geoapify", null)).toEqual([{ key: "setup", ok: false, ms: 0, code: "NOT_SET_UP", found: [] }]);
  });

  test("Geoapify: the three calls with the typed address, and what the search found", async () => {
    jest.spyOn(geoapify, "searchPlaces").mockResolvedValue([{ place_id: "p", formatted: "Admiralty Way, Lekki", lat: 6.4, lon: 3.4 }]);
    jest.spyOn(geoapify, "reverseGeocode").mockResolvedValue("Lekki Phase 1");
    jest.spyOn(geoapify, "tile").mockResolvedValue({ bytes: Buffer.alloc(1), type: "image/png" });
    const steps = await testers.run("geoapify", inUse("geoapify", {}, { api_key: "k" }), { address: "Admiralty" });
    expect(steps.map((s) => [s.key, s.ok])).toEqual([["search", true], ["reverse", true], ["tile", true]]);
    expect(steps[0].found).toEqual(["Admiralty Way, Lekki"]);
    expect(geoapify.searchPlaces).toHaveBeenCalledWith("Admiralty", { apiKey: "k", fresh: true });
    expect(testers.passed(steps)).toBe(true);
  });

  test("Geoapify: a refused key fails the search and skips the rest", async () => {
    const refused = Object.assign(new Error("Maps are not answering."), { upstream: 401 });
    jest.spyOn(geoapify, "searchPlaces").mockRejectedValue(refused);
    const steps = await testers.run("geoapify", inUse("geoapify", {}, { api_key: "bad" }));
    expect(steps.map((s) => [s.key, s.ok, s.code])).toEqual([
      ["search", false, "KEY_REFUSED"],
      ["reverse", null, "SKIPPED"],
      ["tile", null, "SKIPPED"],
    ]);
    expect(testers.firstFailure(steps)).toBe("KEY_REFUSED");
  });

  test("the system sender: reach it, then sign in; no username, no sign-in step", async () => {
    const verify = jest.spyOn(systemMail, "verifyWith").mockResolvedValue(undefined);
    const v = { host: "smtp.test", port: 465, security: "tls", username: "u@test" };
    const steps = await testers.run("mail_sender", inUse("mail_sender", v, { password: "pw" }));
    expect(steps.map((s) => s.key)).toEqual(["connect", "sign_in"]);
    expect(verify.mock.calls.map((c) => c[1])).toEqual([null, "pw"]);
    const relay = await testers.run("mail_sender", inUse("mail_sender", { ...v, username: null }, { password: null }));
    expect(relay.map((s) => s.key)).toEqual(["connect"]);
  });

  test("the staff mail server: IMAP and SMTP both checked, even when the first fails", async () => {
    jest
      .spyOn(tlsCheck, "check")
      .mockRejectedValueOnce(Object.assign(new Error("altnames"), { code: "CERTIFICATE_MISMATCH" }))
      .mockResolvedValueOnce({ greeting: "220 ready" });
    const steps = await testers.run("mailbox_server", inUse("mailbox_server", { imap_host: "a.test", imap_port: 993, smtp_host: "a.test", smtp_port: 465 }));
    expect(steps.map((s) => [s.key, s.ok])).toEqual([["imap", false], ["smtp", true]]);
  });

  test("Gemini: the free key check, then one tiny answer; a refused key skips the rest", async () => {
    jest.spyOn(ai, "checkKey").mockRejectedValue(Object.assign(new Error("gemini 400"), { status: 400 }));
    const answer = jest.spyOn(ai, "testAnswer");
    const steps = await testers.run("gemini", inUse("gemini", {}, { api_key: "k" }));
    expect(steps.map((s) => [s.key, s.code])).toEqual([["key", "KEY_REFUSED"], ["models", "SKIPPED"], ["answer", "SKIPPED"]]);
    expect(answer).not.toHaveBeenCalled();
  });

  const listed = (...ids) =>
    ids.map(([model, capabilities]) => ({ model, display_name: model.toUpperCase(), capabilities }));

  test("Gemini: the key's list names the jobs it can do, the answer uses the Default model, and the list is handed back", async () => {
    const models = listed(["gemini-2.5-flash", ["text", "image", "audio"]], ["gemini-3.8-flash", ["text", "image", "audio"]], ["gemini-2.5-pro", ["text", "image", "audio"]]);
    jest.spyOn(ai, "checkKey").mockResolvedValue(models);
    const answer = jest.spyOn(ai, "testAnswer").mockResolvedValue({});
    const collect = {};
    const steps = await testers.run("gemini", inUse("gemini", {}, { api_key: "k" }), { collect });
    expect(steps.map((s) => [s.key, s.ok])).toEqual([["key", true], ["models", true], ["answer", true]]);
    expect(steps[1].found).toEqual([
      "Default: GEMINI-3.8-FLASH",
      "Deep Reasoning: GEMINI-2.5-PRO",
      "Image Reading: GEMINI-3.8-FLASH",
      "Transcription: GEMINI-3.8-FLASH",
      "Top Tier: GEMINI-2.5-PRO",
    ]);
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ provider: "gemini", model: "gemini-3.8-flash" }));
    expect(collect.models).toBe(models);
  });

  test("Groq: no answer step, so a test spends none of the free audio seconds; no Whisper is a failure", async () => {
    jest.spyOn(ai, "checkKey").mockResolvedValue(listed(["llama-3.3-70b-versatile", ["text"]]));
    const answer = jest.spyOn(ai, "testAnswer");
    const steps = await testers.run("groq", inUse("groq", {}, { api_key: "k" }));
    // A list with something on it passes for a provider no job uses; Groq's Transcription needs Whisper.
    expect(steps.map((s) => s.key)).toEqual(["key", "models"]);
    expect(answer).not.toHaveBeenCalled();
    jest.spyOn(ai, "checkKey").mockResolvedValue(listed(["whisper-large-v3-turbo", ["audio"]], ["whisper-large-v3", ["audio"]]));
    const ok = await testers.run("groq", inUse("groq", {}, { api_key: "k" }));
    expect(ok[1].found).toEqual(["Transcription: WHISPER-LARGE-V3"]);
    jest.spyOn(ai, "checkKey").mockResolvedValue([]);
    const none = await testers.run("groq", inUse("groq", {}, { api_key: "k" }));
    expect(none.map((s) => [s.key, s.code])).toEqual([["key", null], ["models", "MODEL_NOT_FOUND"]]);
  });

  test("Anthropic and OpenAI answer with their cheapest model; a spent balance reads over quota", async () => {
    jest.spyOn(ai, "checkKey").mockResolvedValue(listed(["claude-sonnet-5-5", ["text"]], ["claude-haiku-5-5", ["text"]]));
    const answer = jest.spyOn(ai, "testAnswer").mockResolvedValue({});
    await testers.run("anthropic", inUse("anthropic", {}, { api_key: "k" }));
    expect(answer).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "anthropic", model: "claude-haiku-5-5" }));
    jest.spyOn(ai, "checkKey").mockResolvedValue(listed(["text-embedding-3-large", ["embeddings"]], ["text-embedding-3-small", ["embeddings"]]));
    await testers.run("openai", inUse("openai", {}, { api_key: "k" }));
    expect(answer).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "openai", model: "text-embedding-3-small" }));
    jest.spyOn(ai, "checkKey").mockResolvedValue(listed(["deepseek-v4-flash", ["text"]]));
    answer.mockRejectedValue(Object.assign(new Error("deepseek 402"), { status: 402 }));
    const steps = await testers.run("deepseek", inUse("deepseek", {}, { api_key: "k" }));
    expect(steps.map((s) => [s.key, s.code])).toEqual([["key", null], ["models", null], ["answer", "OVER_QUOTA"]]);
  });

  test("Exchange Rates: one fetch, the naira rate in the findings, the table handed back", async () => {
    const fx = require("../../services/fx/exchangerate-api");
    jest.spyOn(fx, "latest").mockResolvedValue({ base: "USD", rates: { NGN: "1534.2134000000", EUR: "0.9200000000" }, updated_at: null });
    const collect = {};
    const steps = await testers.run("exchange_rates", inUse("exchange_rates", {}, { api_key: "k" }), { collect });
    expect(steps).toEqual([expect.objectContaining({ key: "rates", ok: true, found: ["1 USD = ₦1,534.21", "2 currencies"] })]);
    expect(collect.rates.rates.NGN).toBe("1534.2134000000");
    jest.spyOn(fx, "latest").mockRejectedValue(new fx.FxError("quota", "OVER_QUOTA"));
    const spent = await testers.run("exchange_rates", inUse("exchange_rates", {}, { api_key: "k" }));
    expect(spent[0].code).toBe("OVER_QUOTA");
  });
});
