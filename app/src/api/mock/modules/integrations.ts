import type {
  AiJob,
  AiModel,
  AiProvider,
  CheckStep,
  Integration,
  IntegrationCheck,
  IntegrationCode,
  IntegrationRow,
  ModelCapability,
  ModelInUse,
  SecretState,
  UsageDay,
} from "@mycity/contract/contract.gen.ts";
import { fail, invalid, noContent, ok, paged, route, sid } from "../core";

/**
 * Settings · Integrations on the mock (packages/contract/schemas/integrations.js): the ten
 * connections of the registry, one of each kind of state, the AI connections' model lists and
 * the exchange rates, so the screen can be built and read without a database or a provider.
 *
 * A test passes unless what was typed says otherwise: a key with "bad" in it is refused, a
 * password "wrong" is refused, a host with "nowhere" in it is not found. Nothing is sent
 * anywhere and no key is kept; a saved secret is only ever "set", as the API answers.
 */
const AGO = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const DAY = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
const GE = "Godwin-Okoh Elisha";

type Values = Record<string, string | number | null>;

interface Connection {
  row: IntegrationRow;
  saved_at: string | null;
  saved_by_name: string | null;
  values: Values | null;
  secrets: SecretState[];
  checks: IntegrationCheck[];
  usage: UsageDay[];
}

const week = (perDay: number, units = perDay): UsageDay[] =>
  Array.from({ length: 7 }, (_, i) => ({ day: DAY(6 - i), calls: Math.round(perDay * (0.6 + ((i * 3) % 5) / 10)), failures: i === 2 ? 1 : 0, units: Math.round(units * (0.6 + ((i * 3) % 5) / 10)) }));

const step = (key: CheckStep["key"], ms: number | null, code: CheckStep["code"] = null, found: string[] = []): CheckStep => ({ key, ok: code ? (code === "SKIPPED" ? null : false) : true, ms, code, found });

function check(code: IntegrationCode, kind: IntegrationCheck["kind"], steps: CheckStep[], by: string | null, at: string): IntegrationCheck {
  const failed = steps.find((s) => s.ok === false);
  return { integration_check_id: sid(`check:${code}:${at}:${kind}`), code, kind, ok: !failed, steps, error_code: failed?.code ?? null, checked_by: by ? sid(`user:${by}`) : null, checked_by_name: by, created_at: at };
}

const row = (code: IntegrationCode, display_name: string, group: IntegrationRow["group"], over: Partial<IntegrationRow>): IntegrationRow => ({
  integration_connection_id: sid(`connection:${code}`),
  code,
  display_name,
  group,
  state: "ok",
  source: "saved",
  last_checked_at: null,
  last_error_code: null,
  daily_limit: null,
  plan: null,
  units_today: 0,
  watched: false,
  ...over,
});

const unset = (code: IntegrationCode, display_name: string, plan: IntegrationRow["plan"]): Connection => ({
  row: row(code, display_name, "ai", { state: "not_set", source: "none", plan }),
  saved_at: null,
  saved_by_name: null,
  values: null,
  secrets: [{ key: "api_key", set: false, hint: null, set_by_name: null, set_at: null }],
  checks: [],
  usage: week(0),
});

const senderSteps = (ms: number) => [step("connect", ms), step("sign_in", 120)];
const serverSteps = () => [step("imap", 210), step("smtp", 190)];

const CONNECTIONS: Record<IntegrationCode, Connection> = {
  mail_sender: {
    row: row("mail_sender", "System Sender", "mail", { last_checked_at: AGO(6), watched: true }),
    saved_at: AGO(60 * 26),
    saved_by_name: GE,
    values: { host: "mail.mycityapp.io", port: 465, security: "tls", username: "no-reply@mycityapp.io", from: "MyCity App <no-reply@mycityapp.io>", reply_to: null, per_hour: 50, local_domains: "mycityapp.io" },
    secrets: [{ key: "password", set: true, hint: null, set_by_name: GE, set_at: AGO(60 * 26) }],
    checks: [check("mail_sender", "watch", senderSteps(180), null, AGO(6)), check("mail_sender", "watch", senderSteps(240), null, AGO(21)), check("mail_sender", "save", senderSteps(260), GE, AGO(60 * 26))],
    usage: week(18),
  },
  mailbox_server: {
    row: row("mailbox_server", "Staff Mail Server", "mail", { source: "file", last_checked_at: AGO(6), watched: true }),
    saved_at: null,
    saved_by_name: null,
    values: { imap_host: "mail.mycityapp.io", imap_port: 993, smtp_host: "mail.mycityapp.io", smtp_port: 465, per_person_per_hour: 50, sync_every_min: 5, live_connections: 20 },
    secrets: [],
    checks: [check("mailbox_server", "watch", serverSteps(), null, AGO(6))],
    usage: week(300),
  },
  geoapify: {
    row: row("geoapify", "Geoapify", "maps", { last_checked_at: AGO(60 * 3), daily_limit: 3000, plan: "free" }),
    saved_at: AGO(60 * 3),
    saved_by_name: GE,
    values: {},
    secrets: [{ key: "api_key", set: true, hint: "1a2b", set_by_name: GE, set_at: AGO(60 * 3) }],
    checks: [check("geoapify", "save", [step("search", 310, null, ["Admiralty Way, Lekki Phase 1, Lagos", "Admiralty Road, Lekki, Lagos"]), step("reverse", 240), step("tile", 160)], GE, AGO(60 * 3))],
    usage: week(90, 110),
  },
  gemini: {
    row: row("gemini", "Gemini", "ai", { state: "failing", source: "file", last_checked_at: AGO(60 * 5), last_error_code: "KEY_REFUSED", plan: "paid" }),
    saved_at: null,
    saved_by_name: null,
    values: {},
    secrets: [{ key: "api_key", set: true, hint: "x9Qe", set_by_name: null, set_at: null }],
    checks: [check("gemini", "test", [step("key", 410, "KEY_REFUSED"), step("models", null, "SKIPPED"), step("answer", null, "SKIPPED")], "Cynthia Osakunih", AGO(60 * 5))],
    usage: week(40),
  },
  groq: {
    row: row("groq", "Groq", "ai", { last_checked_at: AGO(60 * 2), daily_limit: 23040, plan: "free" }),
    saved_at: AGO(60 * 2),
    saved_by_name: GE,
    values: {},
    secrets: [{ key: "api_key", set: true, hint: "Qp4w", set_by_name: GE, set_at: AGO(60 * 2) }],
    checks: [check("groq", "save", [step("key", 260), step("models", 1, null, ["Transcription: Whisper Large v3"])], GE, AGO(60 * 2))],
    usage: week(30, 900),
  },
  openai: unset("openai", "OpenAI", "paid"),
  anthropic: unset("anthropic", "Anthropic", "paid"),
  deepseek: unset("deepseek", "DeepSeek", "paid"),
  exchange_rates: {
    row: { ...row("exchange_rates", "Exchange Rates", "finance", { last_checked_at: AGO(60 * 9), daily_limit: 40, plan: "free" }) },
    saved_at: AGO(60 * 30),
    saved_by_name: GE,
    values: {},
    secrets: [{ key: "api_key", set: true, hint: "7c1d", set_by_name: GE, set_at: AGO(60 * 30) }],
    checks: [check("exchange_rates", "sync", [step("rates", 340, null, ["1 USD = ₦1,534.21", "161 currencies"])], null, AGO(60 * 9))],
    usage: week(1),
  },
  web_push: {
    row: row("web_push", "Web Push", "notifications", { state: "unchecked", source: "file" }),
    saved_at: null,
    saved_by_name: null,
    values: { subject: "mailto:it@mycityapp.io", key_id: "b71c9e04" },
    secrets: [{ key: "vapid", set: true, hint: "b71c9e04", set_by_name: null, set_at: null }],
    checks: [],
    usage: week(25),
  },
};

const ORDER: IntegrationCode[] = ["mail_sender", "mailbox_server", "geoapify", "gemini", "groq", "openai", "anthropic", "deepseek", "exchange_rates", "web_push"];

/* ───────────── The AI connections' model lists (seeds/reference/9291, then the key's own list) ───────────── */

const AI: AiProvider[] = ["gemini", "groq", "openai", "anthropic", "deepseek"];
const isAi = (code: string): code is AiProvider => (AI as string[]).includes(code);
const ALL: ModelCapability[] = ["text", "image", "audio"];

function model(provider: AiProvider, id: string, name: string, capabilities: ModelCapability[], over: Partial<AiModel> = {}): AiModel {
  return {
    ai_model_id: sid(`model:${provider}:${id}`),
    provider,
    model: id,
    display_name: name,
    capabilities,
    available: null,
    source: "seed",
    endpoint_url: null,
    input_usd_per_million: null,
    output_usd_per_million: null,
    audio_usd_per_million: null,
    usd_per_audio_hour: null,
    in_use: [],
    seen_at: null,
    added_by_name: null,
    created_at: AGO(60 * 24 * 3),
    ...over,
  };
}

const MODELS: Record<AiProvider, AiModel[]> = {
  gemini: [
    model("gemini", "gemini-3.8-flash", "Gemini 3.8 Flash", ALL),
    model("gemini", "gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", ALL),
    model("gemini", "gemini-2.5-pro", "Gemini 2.5 Pro", ALL, { input_usd_per_million: "1.2500", output_usd_per_million: "10.0000" }),
    model("gemini", "gemini-2.5-flash", "Gemini 2.5 Flash", ALL, { input_usd_per_million: "0.3000", output_usd_per_million: "2.5000", audio_usd_per_million: "1.0000" }),
    model("gemini", "gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite", ALL, { input_usd_per_million: "0.1000", output_usd_per_million: "0.4000", audio_usd_per_million: "0.3000" }),
  ],
  groq: [
    model("groq", "whisper-large-v3", "Whisper Large v3", ["audio"], { available: true, seen_at: AGO(120), usd_per_audio_hour: "0.1110" }),
    model("groq", "whisper-large-v3-turbo", "Whisper Large v3 Turbo", ["audio"], { available: true, seen_at: AGO(120), usd_per_audio_hour: "0.0400" }),
    model("groq", "llama-3.3-70b-versatile", "llama-3.3-70b-versatile", ["text"], { available: true, source: "provider", seen_at: AGO(120) }),
  ],
  openai: [
    model("openai", "text-embedding-3-small", "Text Embedding 3 Small", ["embeddings"], { input_usd_per_million: "0.0200" }),
    model("openai", "text-embedding-3-large", "Text Embedding 3 Large", ["embeddings"], { input_usd_per_million: "0.1300" }),
  ],
  anthropic: [
    model("anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5", ["text", "image"], { input_usd_per_million: "2.0000", output_usd_per_million: "10.0000" }),
    model("anthropic", "claude-haiku-5-5", "Claude Haiku 5.5", ["text", "image"], { input_usd_per_million: "0.1000", output_usd_per_million: "0.5000" }),
  ],
  deepseek: [model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", ["text"]), model("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro", ["text"])],
};

/** Each job's chain until AI Control, as services/ai/jobs.js works it out, from the providers set up here. */
const CHAINS: Record<AiJob, Array<[AiProvider, string]>> = {
  default: [["gemini", "gemini-3.8-flash"]],
  fast: [["gemini", "gemini-3.5-flash-lite"]],
  deep_reasoning: [["gemini", "gemini-2.5-pro"]],
  image_reading: [["gemini", "gemini-3.8-flash"]],
  transcription: [["groq", "whisper-large-v3"], ["gemini", "gemini-3.8-flash"]],
  embeddings: [["openai", "text-embedding-3-small"]],
  top_tier: [["gemini", "gemini-2.5-pro"], ["anthropic", "claude-sonnet-5-5"]],
};

const setUp = (p: AiProvider) => CONNECTIONS[p].secrets.some((x) => x.set);

function inUse(provider: AiProvider): ModelInUse[] {
  const out: ModelInUse[] = [];
  for (const [job, chain] of Object.entries(CHAINS) as Array<[AiJob, Array<[AiProvider, string]>]>) {
    let position = 0;
    for (const [p, id] of chain) {
      if (!setUp(p)) continue;
      position += 1;
      const m = MODELS[p].find((x) => x.model === id);
      if (p === provider && m) out.push({ job, position, model: id, display_name: m.display_name });
    }
  }
  return out;
}

function aiSettings(provider: AiProvider) {
  const list = MODELS[provider];
  return { code: provider, in_use: inUse(provider), models: list.length, available: list.filter((m) => m.available).length };
}

const JOB_WORDS: Record<AiJob, string> = {
  default: "Default",
  fast: "Fast",
  deep_reasoning: "Deep Reasoning",
  image_reading: "Image Reading",
  transcription: "Transcription",
  embeddings: "Embeddings",
  top_tier: "Top Tier",
};

/** Exchange Rates' newest table: the naira to a dollar, its day, how many currencies. */
const RATES = { usd_ngn: "1534.2100000000", rate_day: DAY(0), fetched_at: AGO(60 * 9), currencies: 161 };

// Today's use on the list is the last day of the week the panel draws, as the API reads both from one table.
for (const code of ORDER) {
  const c = CONNECTIONS[code];
  c.row.units_today = c.usage[c.usage.length - 1].units;
}

function settingsOf(c: Connection): Integration["settings"] {
  if (c.values === null) return null;
  const code = c.row.code;
  if (isAi(code)) return aiSettings(code);
  if (code === "exchange_rates") return { code, base: "USD", ...RATES };
  return { code, ...c.values } as Integration["settings"];
}

function detail(c: Connection): Integration {
  const settings = settingsOf(c);
  return { ...c.row, saved_at: c.saved_at, saved_by_name: c.saved_by_name, settings, secrets: c.secrets, last_check: c.checks[0] ?? null, usage: c.usage };
}

const of = (code: string) => (ORDER.includes(code as IntegrationCode) ? CONNECTIONS[code as IntegrationCode] : null);

/** The steps a test takes on these values, failing where the typed values say. */
function stepsFor(code: IntegrationCode, values: Values, typed: Record<string, string>, address?: string): CheckStep[] {
  const host = String(values.host ?? values.imap_host ?? "");
  if (code === "mail_sender") {
    if (host.includes("nowhere")) return [step("connect", 40, "SERVER_NOT_FOUND"), step("sign_in", null, "SKIPPED")];
    if (typed.password === "wrong") return [step("connect", 180), step("sign_in", 130, "AUTH_FAILED")];
    return senderSteps(180);
  }
  if (code === "mailbox_server") return host.includes("nowhere") ? [step("imap", 40, "SERVER_NOT_FOUND"), step("smtp", 190)] : serverSteps();
  if (code === "geoapify") {
    if ((typed.api_key ?? "").includes("bad")) return [step("search", 220, "KEY_REFUSED"), step("reverse", null, "SKIPPED"), step("tile", null, "SKIPPED")];
    const a = address?.trim() || "Admiralty Way, Lekki, Lagos";
    return [step("search", 300, null, [`${a}, Lagos`, `${a.split(",")[0]}, Lekki Phase 1, Lagos`]), step("reverse", 230), step("tile", 150)];
  }
  const refused = (typed.api_key ?? "").includes("bad");
  if (code === "exchange_rates") return refused ? [step("rates", 210, "KEY_REFUSED")] : [step("rates", 330, null, ["1 USD = ₦1,534.21", "161 currencies"])];
  if (isAi(code)) {
    const found = inUse(code).map((u) => `${JOB_WORDS[u.job]}: ${u.display_name}`);
    if (refused) return [step("key", 400, "KEY_REFUSED"), step("models", null, "SKIPPED"), ...(code === "groq" ? [] : [step("answer", null, "SKIPPED")])];
    return [step("key", 380), step("models", 1, null, found.length ? found : MODELS[code].map((m) => m.display_name)), ...(code === "groq" ? [] : [step("answer", 1450)])];
  }
  return [step("keys", 4), step("push", 220)];
}

/** Where a failed step lands on the form, as the API's fieldOf does. */
const FIELD: Partial<Record<NonNullable<CheckStep["code"]>, [string, string]>> = {
  SERVER_NOT_FOUND: ["host", "Server not found"],
  AUTH_FAILED: ["password", "Password refused"],
  KEY_REFUSED: ["api_key", "Key refused"],
};

function settle(c: Connection, done: IntegrationCheck) {
  c.checks.unshift(done);
  c.row.last_checked_at = done.created_at;
  c.row.state = done.ok ? "ok" : "failing";
  c.row.last_error_code = done.ok ? null : done.error_code;
}

route("GET /api/v1/integrations", (req) =>
  paged(
    ORDER.map((code) => CONNECTIONS[code].row),
    req,
    { search: (r) => [r.display_name, r.code, r.group], filters: { group: (r, v) => r.group === v } },
  ),
);

route("GET /api/v1/integrations/summary", () => {
  const rows = ORDER.map((code) => CONNECTIONS[code].row);
  const count = (s: IntegrationRow["state"]) => rows.filter((r) => r.state === s).length;
  return ok({ working: count("ok"), failing: count("failing"), unchecked: count("unchecked"), not_set: count("not_set") });
});

route("POST /api/v1/integrations/mail_sender/test-email", () => {
  const c = CONNECTIONS.mail_sender;
  const done = check("mail_sender", "test_email", [...senderSteps(170), step("send", 420)], "Cynthia Osakunih", new Date().toISOString());
  settle(c, done);
  return ok(done);
});

route("POST /api/v1/integrations/web_push/replace-keys", () => {
  const c = CONNECTIONS.web_push;
  const keyId = Math.random().toString(16).slice(2, 10);
  c.values = { ...(c.values ?? {}), key_id: keyId };
  c.secrets = [{ key: "vapid", set: true, hint: keyId, set_by_name: "Cynthia Osakunih", set_at: new Date().toISOString() }];
  c.row.source = "saved";
  return ok(detail(c));
});

route("POST /api/v1/integrations/exchange_rates/sync", () => {
  const c = CONNECTIONS.exchange_rates;
  if (c.values === null) return ok(check("exchange_rates", "sync", [step("setup", null, "NOT_SET_UP")], "Cynthia Osakunih", new Date().toISOString()));
  RATES.fetched_at = new Date().toISOString();
  RATES.rate_day = DAY(0);
  const done = check("exchange_rates", "sync", [step("rates", 320, null, ["1 USD = ₦1,534.21", "161 currencies"])], "Cynthia Osakunih", RATES.fetched_at);
  settle(c, done);
  return ok(done);
});

route("GET /api/v1/integrations/:code/models", (req) => {
  const code = req.params.code;
  if (!isAi(code)) return fail(404, "NOT_FOUND", "This connection has no model list.");
  const used = inUse(code);
  const rows = MODELS[code]
    .map((m) => ({ ...m, in_use: used.filter((u) => u.model === m.model) }))
    .sort((a, b) => Number(a.available === false) - Number(b.available === false) || a.display_name.localeCompare(b.display_name));
  return paged(rows, req, {
    search: (m) => [m.model, m.display_name],
    filters: { capability: (m, v) => m.capabilities.includes(v as ModelCapability), available: (m, v) => String(m.available) === v },
  });
});

route("POST /api/v1/integrations/:code/models", (req) => {
  const code = req.params.code;
  if (!isAi(code)) return fail(404, "NOT_FOUND", "This connection has no model list.");
  const b = req.body as { model?: string; display_name?: string; capabilities?: ModelCapability[]; endpoint_url?: string };
  const id = String(b.model ?? "").trim();
  if (code === "anthropic" && !/^claude-(sonnet|haiku)-/i.test(id)) return invalid({ model: ["Sonnet or Haiku only"] });
  if (MODELS[code].some((m) => m.model.toLowerCase() === id.toLowerCase())) return fail(409, "ALREADY_LISTED", "This model is already on the list.", { model: ["Already on the list"] });
  const m = model(code, id, b.display_name?.trim() || id, b.capabilities?.length ? b.capabilities : ["text"], {
    source: "added",
    endpoint_url: b.endpoint_url?.trim() || null,
    added_by_name: "Cynthia Osakunih",
    created_at: new Date().toISOString(),
  });
  MODELS[code].push(m);
  return ok(m);
});

route("DELETE /api/v1/integrations/:code/models/:id", (req) => {
  const code = req.params.code;
  if (!isAi(code)) return fail(404, "NOT_FOUND", "This connection has no model list.");
  const at = MODELS[code].findIndex((m) => m.ai_model_id === req.params.id && m.source === "added");
  if (at === -1) return fail(404, "NOT_FOUND", "Only a model added here can be removed.");
  MODELS[code].splice(at, 1);
  return noContent();
});

route("GET /api/v1/integrations/:code", (req) => {
  const c = of(req.params.code);
  return c ? ok(detail(c)) : fail(404, "NOT_FOUND", "Not found");
});

route("GET /api/v1/integrations/:code/checks", (req) => {
  const c = of(req.params.code);
  if (!c) return fail(404, "NOT_FOUND", "Not found");
  return paged(c.checks, req, { filters: { kind: (r, v) => r.kind === v, ok: (r, v) => String(r.ok) === v } });
});

route("PUT /api/v1/integrations/:code", (req) => {
  const c = of(req.params.code);
  if (!c) return fail(404, "NOT_FOUND", "Not found");
  const body = req.body as Record<string, string | number | null>;
  if ((body.saved_at ?? null) !== c.saved_at) return fail(409, "STALE", "Someone else changed these settings. Reload them.");
  const typed: Record<string, string> = {};
  for (const s of c.secrets) if (typeof body[s.key] === "string" && body[s.key]) typed[s.key] = String(body[s.key]);
  const values: Values = {};
  for (const [k, v] of Object.entries(body)) if (!["code", "saved_at", "password", "api_key"].includes(k)) values[k] = v ?? null;
  if (c.row.code === "mail_sender" && c.secrets[0]?.set && !typed.password && ["host", "port", "username"].some((k) => String(values[k] ?? "") !== String(c.values?.[k] ?? "")))
    return invalid({ password: ["Type the password again"] });
  const steps = stepsFor(c.row.code, values, typed);
  const at = new Date().toISOString();
  const done = check(c.row.code, "save", steps, "Cynthia Osakunih", at);
  if (!done.ok) {
    c.checks.unshift(done);
    const field = FIELD[done.error_code ?? "UNAVAILABLE"];
    return field ? fail(422, "TEST_FAILED", "The test failed. Check the marked field.", { [field[0]]: [field[1]] }) : fail(422, "TEST_FAILED", "The service is not answering. Try again shortly.");
  }
  const { daily_limit, plan, ...rest } = values;
  const keyOnly = c.row.code === "geoapify" || c.row.code === "exchange_rates" || isAi(c.row.code);
  c.values = keyOnly ? { ...(c.values ?? {}) } : { ...(c.values ?? {}), ...rest };
  if ("daily_limit" in body) c.row.daily_limit = daily_limit === null || daily_limit === undefined ? null : Number(daily_limit);
  if (plan === "free" || plan === "paid") c.row.plan = plan;
  // The key's own list is read on a save: the seeded models it names become available.
  if (isAi(c.row.code)) for (const m of MODELS[c.row.code]) if (m.available === null) Object.assign(m, { available: true, seen_at: new Date().toISOString() });
  c.secrets = c.secrets.map((s) => (typed[s.key] ? { ...s, set: true, hint: s.key === "api_key" ? typed[s.key].slice(-4) : null, set_by_name: "Cynthia Osakunih", set_at: at } : s));
  c.saved_at = at;
  c.saved_by_name = "Cynthia Osakunih";
  c.row.source = "saved";
  settle(c, done);
  return ok(detail(c));
});

route("DELETE /api/v1/integrations/:code", (req) => {
  const c = of(req.params.code);
  if (!c) return fail(404, "NOT_FOUND", "Not found");
  c.saved_at = null;
  c.saved_by_name = null;
  const fromFile = c.row.code === "mailbox_server" || c.row.code === "web_push";
  c.row.source = fromFile ? "file" : "none";
  c.row.state = fromFile ? "unchecked" : "not_set";
  c.row.last_error_code = null;
  if (!fromFile) {
    c.values = null;
    c.secrets = c.secrets.map((s) => ({ ...s, set: false, hint: null, set_by_name: null, set_at: null }));
  }
  return noContent();
});

route("POST /api/v1/integrations/:code/test", (req) => {
  const c = of(req.params.code);
  if (!c) return fail(404, "NOT_FOUND", "Not found");
  const at = new Date().toISOString();
  // The server file's Gemini key is the refused one; a key saved here works.
  const inUse: Record<string, string> = c.row.code === "gemini" && c.secrets[0]?.hint === "x9Qe" ? { api_key: "bad" } : {};
  const steps: CheckStep[] = c.values === null ? [step("setup", null, "NOT_SET_UP")] : stepsFor(c.row.code, c.values, inUse, String(req.body.address ?? ""));
  const done = check(c.row.code, "test", steps, "Cynthia Osakunih", at);
  if (c.values !== null) settle(c, done);
  else c.checks.unshift(done);
  return ok(done);
});
