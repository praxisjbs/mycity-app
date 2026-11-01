import type {
  AiActionRow,
  AiChain,
  AiControlModel,
  AiJob,
  AiJobRow,
  AiPriceProposal,
  AiPriceRun,
  AiProvider,
  AiSpend,
  AiSpendAction,
  ChainLink,
  ModelCapability,
} from "@mycity/contract/contract.gen.ts";
import { fail, invalid, noContent, ok, paged, route, sid } from "../core";

/**
 * AI Control on the mock (packages/contract/schemas/ai_control.js): the seven jobs and the four
 * registered actions with their chains, every provider's models with their prices, a waiting
 * price from Find Prices, and this month's spend, so the three tabs can be built and read without
 * a database or a provider. Anthropic has no key here, so its models read Not Set Up.
 */
const AGO = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const TODAY = new Date().toISOString().slice(0, 10);
const RATE = { usd_ngn: "1534.2100000000", day: TODAY };
const KEYED = new Set<AiProvider>(["gemini", "groq", "openai", "deepseek"]);
const PLAN: Record<AiProvider, "free" | "paid"> = { gemini: "paid", groq: "free", openai: "paid", anthropic: "paid", deepseek: "paid" };
const JOBS: AiJob[] = ["default", "fast", "deep_reasoning", "image_reading", "transcription", "embeddings", "top_tier"];
const NEEDS: Record<AiJob, ModelCapability> = {
  default: "text",
  fast: "text",
  deep_reasoning: "text",
  image_reading: "image",
  transcription: "audio",
  embeddings: "embeddings",
  top_tier: "text",
};

type Prices = Pick<AiControlModel, "input_usd_per_million" | "output_usd_per_million" | "audio_usd_per_million" | "usd_per_audio_hour" | "usd_per_thousand_searches">;
const NONE: Prices = { input_usd_per_million: null, output_usd_per_million: null, audio_usd_per_million: null, usd_per_audio_hour: null, usd_per_thousand_searches: null };
const P = (i: string | null, o: string | null, extra: Partial<Prices> = {}): Prices => ({ ...NONE, input_usd_per_million: i, output_usd_per_million: o, ...extra });

interface Model {
  ai_model_id: string;
  provider: AiProvider;
  model: string;
  display_name: string;
  capabilities: ModelCapability[];
  available: boolean | null;
  prices: Prices;
  /** When the provider's page last did not price it. */
  notListedAt?: number;
}

const model = (provider: AiProvider, id: string, name: string, capabilities: ModelCapability[], prices: Prices, available: boolean | null = true): Model => ({
  ai_model_id: sid(`ai_model:${provider}:${id}`),
  provider,
  model: id,
  display_name: name,
  capabilities,
  available,
  prices,
});

const MODELS: Model[] = [
  model("gemini", "gemini-3.8-flash", "Gemini 3.8 Flash", ["text", "image", "audio"], NONE),
  model("gemini", "gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", ["text", "image", "audio"], NONE),
  model("gemini", "gemini-2.5-pro", "Gemini 2.5 Pro", ["text", "image", "audio"], P("1.2500", "10.0000", { usd_per_thousand_searches: "35.0000" })),
  model("gemini", "gemini-2.5-flash", "Gemini 2.5 Flash", ["text", "image", "audio"], P("0.3000", "2.5000", { audio_usd_per_million: "1.0000" })),
  model("gemini", "gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite", ["text", "image", "audio"], P("0.1000", "0.4000", { audio_usd_per_million: "0.3000" })),
  model("groq", "whisper-large-v3", "Whisper Large v3", ["audio"], { ...NONE, usd_per_audio_hour: "0.1110" }),
  model("groq", "whisper-large-v3-turbo", "Whisper Large v3 Turbo", ["audio"], { ...NONE, usd_per_audio_hour: "0.0400" }),
  model("openai", "text-embedding-3-small", "Text Embedding 3 Small", ["embeddings"], P("0.0200", null)),
  model("openai", "text-embedding-3-large", "Text Embedding 3 Large", ["embeddings"], P("0.1300", null)),
  model("anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5", ["text", "image"], P("2.0000", "10.0000"), null),
  model("anthropic", "claude-haiku-5-5", "Claude Haiku 5.5", ["text", "image"], P("0.1000", "0.5000"), null),
  model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", ["text"], NONE),
  model("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro", ["text"], NONE, false),
];

const byKey = (provider: string, id: string) => MODELS.find((m) => m.provider === provider && m.model.toLowerCase() === id.toLowerCase());

type Pair = [AiProvider, string];
/** Each job's chain in code: the models the server's families pick from these lists. */
const CODE: Record<AiJob, Pair[]> = {
  default: [["gemini", "gemini-3.8-flash"]],
  fast: [["gemini", "gemini-3.5-flash-lite"]],
  deep_reasoning: [["gemini", "gemini-2.5-pro"]],
  image_reading: [["gemini", "gemini-3.8-flash"]],
  transcription: [["groq", "whisper-large-v3"], ["gemini", "gemini-3.8-flash"]],
  embeddings: [["openai", "text-embedding-3-small"]],
  top_tier: [["gemini", "gemini-2.5-pro"], ["anthropic", "claude-sonnet-5-5"]],
};

interface Action {
  key: string;
  label: string;
  module: string;
  job: AiJob;
  personal_data: boolean;
  built: boolean;
  searches?: boolean;
  chain?: Pair[];
}

const ACTIONS: Action[] = [
  { key: "voice-note-transcription", label: "Voice Note Transcription", module: "community", job: "transcription", personal_data: true, built: true },
  { key: "policy-tidy", label: "Tidy Policy", module: "knowledge", job: "default", personal_data: true, built: true },
  { key: "data-answers", label: "Data Answers", module: "praxis_ai", job: "default", personal_data: true, built: true, chain: [["gemini", "gemini-3.8-flash"], ["gemini", "gemini-2.5-pro"]] },
  { key: "praxis-ai-voice", label: "Voice Question", module: "praxis_ai", job: "transcription", personal_data: true, built: true },
  { key: "find-prices", label: "Find Prices", module: "ai_control", job: "deep_reasoning", personal_data: false, built: true, searches: true },
];
const CALLS_TODAY: Record<string, number> = { "voice-note-transcription": 37, "policy-tidy": 4, "data-answers": 0, "praxis-ai-voice": 0, "find-prices": 0 };

/** Chains saved on the page, "scope:key" → links; changed by Edit Chain and Make First. */
const STORED = new Map<string, { links: Pair[]; by: string; at: string }>([
  ["job:top_tier", { links: [["gemini", "gemini-2.5-pro"], ["anthropic", "claude-sonnet-5-5"]], by: "Godwin-Okoh Elisha", at: AGO(60 * 26) }],
]);

const CAPS: Partial<Record<AiProvider, string | null>> = { gemini: "50000.00", deepseek: "5000.00" };
let overallCap: string | null = "100000.00";
const SPENT: Record<AiProvider, { spent: string; calls: number }> = {
  gemini: { spent: "18420.55", calls: 412 },
  groq: { spent: "0.00", calls: 214 },
  openai: { spent: "1204.10", calls: 96 },
  anthropic: { spent: "0.00", calls: 0 },
  deepseek: { spent: "312.40", calls: 18 },
};

const atCap = (p: AiProvider) => {
  const cap = CAPS[p];
  return cap !== undefined && cap !== null && Number(SPENT[p].spent) >= Number(cap);
};

function stateOf(p: AiProvider, id: string, action: Action | null): Pick<ChainLink, "state" | "until"> {
  const m = byKey(p, id);
  if (!KEYED.has(p)) return { state: "not_set_up", until: null };
  if (!m || m.available === false) return { state: "not_on_key", until: null };
  if (action?.personal_data && p === "deepseek") return { state: "personal_data", until: null };
  if (action?.searches && p !== "gemini") return { state: "cannot_search", until: null };
  if (atCap(p)) return { state: "at_cap", until: null };
  return { state: "ready", until: null };
}

function chainOf(scope: "job" | "action", key: string, action: Action | null): AiChain {
  const saved = STORED.get(`${scope}:${key}`);
  if (scope === "action" && !saved) {
    const a = ACTIONS.find((x) => x.key === key)!;
    if (!a.chain) return chainOf("job", a.job, action);
  }
  const pairs = saved ? saved.links : scope === "job" ? CODE[key as AiJob] : ACTIONS.find((x) => x.key === key)!.chain!;
  return {
    scope,
    key,
    stored: Boolean(saved),
    links: pairs.map(([p, id], i) => ({ position: i + 1, provider: p, model: id, display_name: byKey(p, id)?.display_name ?? id, ...stateOf(p, id, action) })),
    updated_by_name: saved?.by ?? null,
    updated_at: saved?.at ?? null,
  };
}

const naira = (usd: string | null) => (usd === null ? null : (Number(usd) * Number(RATE.usd_ngn)).toFixed(2));

function inChains(m: Model) {
  const out: AiControlModel["in_chains"] = [];
  for (const job of JOBS)
    chainOf("job", job, null).links.forEach((l) => {
      if (l.provider === m.provider && l.model === m.model) out.push({ scope: "job", key: job, label: null, position: l.position });
    });
  for (const a of ACTIONS) {
    const ch = chainOf("action", a.key, a);
    if (ch.scope === "action")
      ch.links.forEach((l) => {
        if (l.provider === m.provider && l.model === m.model) out.push({ scope: "action", key: a.key, label: a.label, position: l.position });
      });
  }
  return out;
}

const PROPOSALS: AiPriceProposal[] = [
  {
    ai_price_proposal_id: sid("proposal:gemini-3.8-flash"),
    ai_model_id: byKey("gemini", "gemini-3.8-flash")!.ai_model_id,
    provider: "gemini",
    model: "gemini-3.8-flash",
    display_name: "Gemini 3.8 Flash",
    ...P("0.5000", "3.0000", { audio_usd_per_million: "1.0000", usd_per_thousand_searches: "14.0000" }),
    source_url: "https://ai.google.dev/gemini-api/docs/pricing",
    created_at: AGO(60 * 3),
  },
];

const view = (m: Model): AiControlModel => ({
  ai_model_id: m.ai_model_id,
  provider: m.provider,
  model: m.model,
  display_name: m.display_name,
  capabilities: m.capabilities,
  available: m.available,
  plan: PLAN[m.provider],
  ...m.prices,
  input_ngn_per_million: naira(m.prices.input_usd_per_million),
  output_ngn_per_million: naira(m.prices.output_usd_per_million),
  ngn_per_audio_hour: naira(m.prices.usd_per_audio_hour),
  in_chains: inChains(m),
  proposed: PROPOSALS.some((p) => p.ai_model_id === m.ai_model_id),
  not_listed: notListed(m),
});

const WEEK = 7 * 24 * 3600_000;
/** Not Listed while the mark is under a week old and the model still has no price on the key. */
const notListed = (m: Model) =>
  m.notListedAt !== undefined &&
  Date.now() - m.notListedAt < WEEK &&
  !m.prices.input_usd_per_million &&
  !m.prices.output_usd_per_million &&
  !m.prices.usd_per_audio_hour &&
  m.available !== false;
/** What Find Prices would ask about: on a key, no price, nothing waiting, not Not Listed (§6.4). */
const toPrice = () =>
  MODELS.filter(
    (m) =>
      m.provider !== "anthropic" &&
      m.available !== false &&
      !m.prices.input_usd_per_million &&
      !m.prices.output_usd_per_million &&
      !m.prices.usd_per_audio_hour &&
      !PROPOSALS.some((p) => p.ai_model_id === m.ai_model_id) &&
      !notListed(m),
  );

/** The newest Find Prices run: one ended three hours ago, with the proposal still waiting. */
let RUN: AiPriceRun = {
  ai_price_run_id: sid("price_run:1"),
  status: "done",
  batches_total: 1,
  batches_done: 1,
  proposals: 1,
  not_listed: 0,
  error_code: null,
  started_at: AGO(60 * 3 + 2),
  finished_at: AGO(60 * 3),
};
/** A run here takes two batches, two seconds each. */
const BATCH_MS = 2000;
let runStarted = 0;
let runAsked: Model[] = [];

function propose(m: Model) {
  PROPOSALS.push({
    ai_price_proposal_id: sid(`proposal:${m.model}:${RUN.ai_price_run_id}`),
    ai_model_id: m.ai_model_id,
    provider: m.provider,
    model: m.model,
    display_name: m.display_name,
    ...(m.provider === "deepseek" ? P("0.2700", "1.1000") : P("0.1000", "0.4000", { audio_usd_per_million: "0.3000" })),
    source_url: m.provider === "deepseek" ? "https://api-docs.deepseek.com/quick_start/pricing" : "https://ai.google.dev/gemini-api/docs/pricing",
    created_at: new Date().toISOString(),
  });
}

/** Moves the running run on by the clock: each batch proposes all but the last model it asks. */
function advance() {
  if (RUN.status !== "running") return;
  const due = Math.min(RUN.batches_total, Math.floor((Date.now() - runStarted) / BATCH_MS));
  for (let b = RUN.batches_done; b < due; b += 1) {
    const batch = runAsked.filter((_, i) => i % RUN.batches_total === b);
    batch.forEach((m, i) => {
      if (i === batch.length - 1 && batch.length > 1) {
        m.notListedAt = Date.now();
        RUN.not_listed += 1;
      } else {
        propose(m);
        RUN.proposals += 1;
      }
    });
    RUN.batches_done = b + 1;
  }
  if (RUN.batches_done >= RUN.batches_total) RUN = { ...RUN, status: "done", finished_at: new Date().toISOString() };
}

/* ───────────── Jobs and actions ───────────── */

route("GET /api/v1/ai-control/jobs", (req) => {
  const rows: AiJobRow[] = JOBS.map((job) => ({
    job,
    chain: chainOf("job", job, null),
    actions: ACTIONS.filter((a) => a.job === job && chainOf("action", a.key, a).scope === "job").length,
    locked: false,
  }));
  return paged(rows, req);
});

route("GET /api/v1/ai-control/actions", (req) => {
  const rows: AiActionRow[] = ACTIONS.map((a) => {
    const chain = chainOf("action", a.key, a);
    return {
      key: a.key,
      label: a.label,
      module: a.module,
      job: a.job,
      personal_data: a.personal_data,
      reason: null,
      chosen_by: "TB",
      chosen_at: "2026-10-20",
      built: a.built,
      own_chain: chain.scope === "action",
      set_chain: Boolean(a.chain),
      chain,
      calls_today: CALLS_TODAY[a.key] ?? 0,
    };
  });
  return paged(rows, req, { search: (r) => [r.label, r.key], filters: { job: (r, v) => r.job === v } });
});

function save(scope: "job" | "action", key: string, links: Array<{ provider: AiProvider; model: string }>) {
  const action = scope === "action" ? ACTIONS.find((a) => a.key === key) : null;
  if (scope === "action" && !action) return fail(404, "NO_SUCH_ACTION", "No such action");
  if (scope === "job" && !JOBS.includes(key as AiJob)) return fail(404, "NO_SUCH_JOB", "No such job");
  const job = scope === "job" ? (key as AiJob) : action!.job;
  if (!links.length) return invalid({ links: ["Pick a model"] });
  const fields: Record<string, string[]> = {};
  const seen = new Set<string>();
  links.forEach((l, i) => {
    const m = byKey(l.provider, l.model);
    const id = `${l.provider}:${l.model.toLowerCase()}`;
    if (!m) fields[`links.${i}.model`] = ["Not on the list"];
    else if (!m.capabilities.includes(NEEDS[job])) fields[`links.${i}.model`] = ["Cannot do this job"];
    else if (l.provider === "deepseek" && action?.personal_data) fields[`links.${i}.model`] = ["Carries personal data"];
    else if (seen.has(id)) fields[`links.${i}.model`] = ["Picked twice"];
    seen.add(id);
  });
  if (Object.keys(fields).length) return fail(422, "CHAIN_INVALID", "Check the chain", fields);
  if (job === "embeddings" && links.length !== 1) return fail(422, "ONE_EMBEDDING_MODEL", "Embeddings take one model", { links: ["One model only"] });
  STORED.set(`${scope}:${key}`, { links: links.map((l) => [l.provider, byKey(l.provider, l.model)!.model]), by: "You", at: new Date().toISOString() });
  return ok(chainOf(scope, key, action ?? null));
}

route("PUT /api/v1/ai-control/chains/:scope/:key", (req) =>
  save(req.params.scope as "job" | "action", req.params.key, ((req.body.links as Array<{ provider: AiProvider; model: string }>) ?? [])),
);

route("POST /api/v1/ai-control/chains/:scope/:key/first", (req) => {
  const scope = req.params.scope as "job" | "action";
  const action = scope === "action" ? (ACTIONS.find((a) => a.key === req.params.key) ?? null) : null;
  const links = chainOf(scope, req.params.key, action).links.map((l) => ({ provider: l.provider, model: l.model }));
  const at = Number(req.body.position) - 1;
  if (!links[at]) return fail(422, "NO_SUCH_POSITION", "No model at that place", { position: ["No model there"] });
  return save(scope, req.params.key, [links[at], ...links.filter((_, i) => i !== at)]);
});

route("DELETE /api/v1/ai-control/chains/action/:key", (req) => {
  STORED.delete(`action:${req.params.key}`);
  return noContent();
});

/* ───────────── Models and prices ───────────── */

/** In a chain first, then usable, then by provider and name (decision 32). */
const listOrder = (a: AiControlModel, b: AiControlModel) =>
  Number(!a.in_chains.length) - Number(!b.in_chains.length) ||
  Number(a.available === false) - Number(b.available === false) ||
  a.provider.localeCompare(b.provider) ||
  a.display_name.localeCompare(b.display_name);

route("GET /api/v1/ai-control/models", (req) => {
  const show = req.query.show ?? "usable";
  if (!["usable", "not_on_key", "all"].includes(show)) return invalid({ show: ["is not a choice"] });
  const shown = MODELS.map(view)
    .filter((m) => show === "all" || (show === "not_on_key" ? m.available === false : m.available !== false))
    .sort(listOrder);
  return paged(shown, { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "show")) }, {
    search: (m) => [m.model, m.display_name],
    filters: { provider: (m, v) => m.provider === v, capability: (m, v) => m.capabilities.includes(v as ModelCapability) },
  });
});

route("GET /api/v1/ai-control/models/summary", () => {
  advance();
  const finding = RUN.status === "running";
  return ok({
    finding,
    run: RUN,
    last_found_at: finding ? null : RUN.finished_at,
    proposals: PROPOSALS.length,
    to_price: toPrice().length,
    not_listed: MODELS.filter(notListed).length,
    rate: RATE,
  });
});

const pricesOf = (b: Record<string, unknown>): Prices => {
  const v = (k: keyof Prices) => (typeof b[k] === "string" && b[k] !== "" ? Number(b[k]).toFixed(4) : null);
  return {
    input_usd_per_million: v("input_usd_per_million"),
    output_usd_per_million: v("output_usd_per_million"),
    audio_usd_per_million: v("audio_usd_per_million"),
    usd_per_audio_hour: v("usd_per_audio_hour"),
    usd_per_thousand_searches: v("usd_per_thousand_searches"),
  };
};

route("PUT /api/v1/ai-control/models/:id/prices", (req) => {
  const m = MODELS.find((x) => x.ai_model_id === req.params.id);
  if (!m) return fail(404, "NOT_FOUND", "Not found");
  m.prices = pricesOf(req.body);
  return ok(view(m));
});

route("POST /api/v1/ai-control/prices/find", () => {
  advance();
  if (RUN.status === "running") return fail(409, "ALREADY_FINDING", "Find Prices is already running");
  runAsked = toPrice();
  runStarted = Date.now();
  const total = runAsked.length ? Math.min(2, runAsked.length) : 0;
  RUN = {
    ai_price_run_id: sid(`price_run:${runStarted}`),
    status: total ? "running" : "done",
    batches_total: total,
    batches_done: 0,
    proposals: 0,
    not_listed: 0,
    error_code: null,
    started_at: new Date(runStarted).toISOString(),
    finished_at: total ? null : new Date(runStarted).toISOString(),
  };
  return { status: 202, body: { requested_at: RUN.started_at } };
});

route("GET /api/v1/ai-control/prices", (req) => {
  advance();
  return paged(PROPOSALS, req);
});

route("POST /api/v1/ai-control/prices/accept-all", () => {
  const accepted = PROPOSALS.length;
  for (const p of PROPOSALS.splice(0)) {
    const m = MODELS.find((x) => x.ai_model_id === p.ai_model_id)!;
    m.prices = {
      input_usd_per_million: p.input_usd_per_million,
      output_usd_per_million: p.output_usd_per_million,
      audio_usd_per_million: p.audio_usd_per_million,
      usd_per_audio_hour: p.usd_per_audio_hour,
      usd_per_thousand_searches: p.usd_per_thousand_searches,
    };
  }
  return ok({ accepted });
});

route("POST /api/v1/ai-control/prices/:id/accept", (req) => {
  const i = PROPOSALS.findIndex((p) => p.ai_price_proposal_id === req.params.id);
  if (i < 0) return fail(404, "NOT_FOUND", "That proposal is no longer open");
  const m = MODELS.find((x) => x.ai_model_id === PROPOSALS[i].ai_model_id)!;
  m.prices = pricesOf(req.body);
  PROPOSALS.splice(i, 1);
  return ok(view(m));
});

route("POST /api/v1/ai-control/prices/:id/dismiss", (req) => {
  const i = PROPOSALS.findIndex((p) => p.ai_price_proposal_id === req.params.id);
  if (i < 0) return fail(404, "NOT_FOUND", "That proposal is no longer open");
  PROPOSALS.splice(i, 1);
  return noContent();
});

/* ───────────── Spend and caps ───────────── */

function spend(): AiSpend {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const days: AiSpend["days"] = [];
  for (let d = new Date(first); d <= today; d.setDate(d.getDate() + 1)) {
    const n = d.getDate();
    days.push({ day: d.toISOString().slice(0, 10), spent_ngn: (600 + ((n * 137) % 900) + (n % 7 === 0 ? 0 : 140)).toFixed(2) });
  }
  const total = Object.values(SPENT).reduce((a, s) => a + Number(s.spent), 0).toFixed(2);
  return {
    month: `${TODAY.slice(0, 7)}-01`,
    rate: RATE,
    overall: { spent_ngn: total, cap_ngn: overallCap, at_cap: overallCap !== null && Number(total) >= Number(overallCap) },
    providers: (["gemini", "groq", "openai", "anthropic", "deepseek"] as AiProvider[]).map((p) => ({
      provider: p,
      plan: PLAN[p],
      set_up: KEYED.has(p),
      spent_ngn: SPENT[p].spent,
      cap_ngn: CAPS[p] ?? null,
      at_cap: atCap(p),
      calls: SPENT[p].calls,
    })),
    days,
    praxis_ai: {
      reads_refused: 7,
      presses_refused: 2,
      nightly: {
        ai_attack_run_id: "00000000-0000-4000-8000-0000000000e1",
        environment: "staging",
        run_by: "nightly",
        status: "passed",
        asked: 11,
        passed: 11,
        leaks: [],
        error_code: null,
        started_at: `${TODAY}T01:00:00.000Z`,
        finished_at: `${TODAY}T01:04:12.000Z`,
      },
    },
  };
}

route("GET /api/v1/ai-control/spend", () => ok(spend()));

const BY_ACTION: AiSpendAction[] = [
  { key: "voice-note-transcription", label: "Voice Note Transcription", job: "transcription", calls: 642, spent_ngn: "11804.20" },
  { key: "policy-tidy", label: "Tidy Policy", job: "default", calls: 71, spent_ngn: "6620.35" },
  { key: "find-prices", label: "Find Prices", job: "deep_reasoning", calls: 3, spent_ngn: "1388.10" },
  { key: "integration-test", label: "Connection Test", job: null, calls: 24, spent_ngn: "124.40" },
];

route("GET /api/v1/ai-control/spend/actions", (req) => paged(BY_ACTION, req));

const capOf = (b: Record<string, unknown>) => (typeof b.monthly_cap_ngn === "string" && b.monthly_cap_ngn !== "" ? Number(b.monthly_cap_ngn).toFixed(2) : null);

route("PUT /api/v1/ai-control/caps/:provider", (req) => {
  const p = req.params.provider as AiProvider;
  if (PLAN[p] !== "paid") return fail(422, "NOT_PAID", "Only a paid provider has a cap", { monthly_cap_ngn: ["Free plan"] });
  CAPS[p] = capOf(req.body);
  return ok(spend());
});

route("PUT /api/v1/ai-control/cap", (req) => {
  overallCap = capOf(req.body);
  return ok(spend());
});
