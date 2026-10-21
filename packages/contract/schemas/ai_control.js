"use strict";
/**
 * AI Control (docs/guides/ai-control.md): which model answers each AI feature, what happens when
 * it cannot, what each model costs and what AI costs each month. Served by the `ai_governance`
 * module under /api/v1/ai-control, read with `ai_control` view and changed with edit.
 *
 *   job      one of the seven kinds of AI work (§6.2): Default, Fast, Deep Reasoning, ...
 *   action   one AI feature, declared once in src/services/ai/actions.js under a job
 *   chain    a first choice and up to three fallbacks, each a model of a connected provider;
 *            an action uses its job's chain unless it is given its own
 *
 * Prices are kept in dollars as the provider publishes them; naira is the dollar price times the
 * day's rate from Exchange Rates. Money is naira, two places, as a string (gate 20).
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime, money, listQuery, Paged, blank } = require("./common");
const { AiProvider, AiJob, ModelCapability, IntegrationPlan } = require("./integrations");

/** An action's key: its prompt's name and the ledger's purpose. */
const ActionKey = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/, "Not an action");

/** A chain belongs to a job, or to one action that has its own. */
const ChainScope = z.enum(["job", "action"]);

/**
 * Why a model in a chain would or would not answer now (§6.1 step 2): `ready` it would;
 * `not_set_up` its provider has no key; `not_on_key` the key's list no longer names it;
 * `daily_limit` a Free plan's limit is used; `skipped` its provider said its quota is used up,
 * until `until`; `at_cap` its provider reached its monthly cap; `personal_data` DeepSeek on an
 * action that carries personal data; `cannot_search` an action that searches, on a model that
 * cannot.
 */
const LinkState = z.enum(["ready", "not_set_up", "not_on_key", "daily_limit", "skipped", "at_cap", "personal_data", "cannot_search"]);

/** A dollar price as kept on a model: up to four places, as the providers publish them. */
const usd = z.string().regex(/^\d{1,8}(\.\d{1,4})?$/, "Not a price");

/** The day's dollar to naira rate, and the day it is from. */
const AiRate = z
  .object({
    usd_ngn: z.string().regex(/^\d{1,14}(\.\d{1,10})?$/),
    day: isoDate,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Chains (§6.1)
 * ------------------------------------------------------------------ */

/** One model in a chain: first (1), then each fallback. */
const ChainLink = z
  .object({
    position: z.number().int().min(1).max(4),
    provider: AiProvider,
    model: z.string(),
    display_name: z.string(),
    state: LinkState,
    /** When a skipped provider is asked again; null in every other state. */
    until: isoDateTime.nullable(),
  })
  .strict();

const AiChain = z
  .object({
    scope: ChainScope,
    key: z.string(),
    /** Saved on AI Control; false is the chain in code (the registry's or the job's). */
    stored: z.boolean(),
    links: z.array(ChainLink).max(4),
    updated_by_name: z.string().nullable(),
    updated_at: isoDateTime.nullable(),
  })
  .strict();

/** One job on AI Control · Actions. */
const AiJobRow = z
  .object({
    job: AiJob,
    chain: AiChain,
    /** How many registered actions use this job's chain (not their own). */
    actions: z.number().int().min(0),
    /** Embeddings, once the Knowledge Hub has indexed anything (§6.6). */
    locked: z.boolean(),
  })
  .strict();

const AiJobPage = Paged(AiJobRow);

/** One registered action (src/services/ai/actions.js). */
const AiActionRow = z
  .object({
    key: z.string(),
    label: z.string(),
    /** The module key the call is made for. */
    module: z.string(),
    job: AiJob,
    personal_data: z.boolean(),
    /** Top Tier's written reason; null for the other jobs. */
    reason: z.string().nullable(),
    chosen_by: z.string(),
    chosen_at: isoDate,
    /** False while the feature is registered but not built yet (Data Answers until M10). */
    built: z.boolean(),
    /** Whether it has a chain of its own, saved or from the registry, rather than its job's. */
    own_chain: z.boolean(),
    chain: AiChain,
    calls_today: z.number().int().min(0),
  })
  .strict();

const AiActionListQuery = listQuery({ job: AiJob.optional() });

const AiActionPage = Paged(AiActionRow);

/** `/chains/:scope/:key` */
const AiChainParams = z.object({ scope: ChainScope, key: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/, "Not a job or action") }).strict();

/** `/chains/action/:key` */
const AiActionParams = z.object({ key: ActionKey }).strict();

/** PUT /chains/:scope/:key: Edit Chain. The whole chain, first choice first. */
const AiChainSave = z
  .object({
    links: z
      .array(
        z
          .object({
            provider: AiProvider,
            model: z.string().trim().min(2, "Pick a model").max(120),
          })
          .strict(),
      )
      .min(1, "Pick a model")
      .max(4, "At most four"),
  })
  .strict();

/** POST /chains/:scope/:key/first: Make First on the model at `position`. */
const AiMakeFirst = z.object({ position: z.number().int().min(2).max(4) }).strict();

/* ------------------------------------------------------------------ *
 * Models and their prices (§6.3, §6.4)
 * ------------------------------------------------------------------ */

/** A chain a model is in: a job's (by its key), or an action's own (by its label). */
const ModelChainRef = z
  .object({
    scope: ChainScope,
    key: z.string(),
    /** The action's label for an action's own chain; null for a job's, which the screen names. */
    label: z.string().nullable(),
    position: z.number().int().min(1).max(4),
  })
  .strict();

/** One model on AI Control · Models: its dollar prices, and naira at the day's rate. */
const AiControlModel = z
  .object({
    ai_model_id: uuid,
    provider: AiProvider,
    model: z.string(),
    display_name: z.string(),
    capabilities: z.array(ModelCapability).min(1).max(4),
    available: z.boolean().nullable(),
    /** The provider's plan: a Free plan is charged nothing. */
    plan: IntegrationPlan.nullable(),
    input_usd_per_million: usd.nullable(),
    output_usd_per_million: usd.nullable(),
    audio_usd_per_million: usd.nullable(),
    usd_per_audio_hour: usd.nullable(),
    usd_per_thousand_searches: usd.nullable(),
    /** Naira at the day's rate; null without a price or a rate. */
    input_ngn_per_million: money.nullable(),
    output_ngn_per_million: money.nullable(),
    ngn_per_audio_hour: money.nullable(),
    in_chains: z.array(ModelChainRef).max(50),
    /** An open Find Prices proposal waits for this model. */
    proposed: z.boolean(),
    /** The provider's pricing page did not price it in the last 7 days. */
    not_listed: z.boolean(),
  })
  .strict();

/** `capability`: only the models that can do it (Edit Chain's pickers ask for their job's). */
/**
 * `show`: `usable` (the default) the models the key can use or not checked yet; `not_on_key` the
 * ones it no longer names; `all`. The models in a chain come first.
 */
const AiControlModelListQuery = listQuery({
  provider: AiProvider.optional(),
  capability: ModelCapability.optional(),
  show: z.enum(["usable", "not_on_key", "all"]).optional(),
});

const AiControlModelPage = Paged(AiControlModel);

/** GET /models/summary: what the Models tab shows above its list. */
/** One Find Prices run: its progress and how it ended (§6.4). */
const AiPriceRun = z
  .object({
    ai_price_run_id: uuid,
    status: z.enum(["running", "done", "failed"]),
    batches_total: z.number().int().min(0),
    batches_done: z.number().int().min(0),
    proposals: z.number().int().min(0),
    not_listed: z.number().int().min(0),
    /** Why a failed run failed: NO_SEARCH_MODEL, AI_UNAVAILABLE, AI_DISABLED, AI_CAP_REACHED, ANSWER_UNREADABLE, LOST. */
    error_code: z.string().nullable(),
    started_at: isoDateTime,
    finished_at: isoDateTime.nullable(),
  })
  .strict();

const AiModelsSummary = z
  .object({
    /** A Find Prices run is going. */
    finding: z.boolean(),
    /** The newest run, going or ended; null before the first. */
    run: AiPriceRun.nullable(),
    last_found_at: isoDateTime.nullable(),
    /** Proposals waiting for IT. */
    proposals: z.number().int().min(0),
    /** Models the next run would ask about: on a set-up key, no price, nothing waiting, not Not Listed. */
    to_price: z.number().int().min(0),
    /** Models marked Not Listed in the last 7 days. */
    not_listed: z.number().int().min(0),
    rate: AiRate.nullable(),
  })
  .strict();

/** `/models/:id` and `/prices/:id` */
const AiIdParams = z.object({ id: uuid }).strict();

/**
 * PUT /models/:id/prices (Edit Price) and POST /prices/:id/accept (Accept, edited or not).
 * A price left blank is no price.
 */
const AiPricesSave = z
  .object({
    input_usd_per_million: blank(usd),
    output_usd_per_million: blank(usd),
    audio_usd_per_million: blank(usd),
    usd_per_audio_hour: blank(usd),
    usd_per_thousand_searches: blank(usd),
  })
  .strict();

/** One open Find Prices proposal. */
const AiPriceProposal = z
  .object({
    ai_price_proposal_id: uuid,
    ai_model_id: uuid,
    provider: AiProvider,
    model: z.string(),
    display_name: z.string(),
    input_usd_per_million: usd.nullable(),
    output_usd_per_million: usd.nullable(),
    audio_usd_per_million: usd.nullable(),
    usd_per_audio_hour: usd.nullable(),
    usd_per_thousand_searches: usd.nullable(),
    /** The pricing page it came from. */
    source_url: z.string(),
    created_at: isoDateTime,
  })
  .strict();

const AiPriceProposalPage = Paged(AiPriceProposal);

/** A price as a model writes it: a decimal string, or a number turned into one. */
const answeredUsd = z.preprocess((v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : v), usd.nullable());

/**
 * The model's answer to Find Prices (src/services/ai/prompts/find-prices.md), checked before any
 * proposal is kept. Keys it adds beyond these are dropped.
 */
const FindPricesAnswer = z.object({
  prices: z
    .array(
      z.object({
        model: z.string().min(1).max(120),
        input_usd_per_million: answeredUsd.optional().default(null),
        output_usd_per_million: answeredUsd.optional().default(null),
        audio_usd_per_million: answeredUsd.optional().default(null),
        usd_per_audio_hour: answeredUsd.optional().default(null),
        usd_per_thousand_searches: answeredUsd.optional().default(null),
        source_url: z.string().max(500).nullable().optional().default(null),
      }),
    )
    .max(100),
});

/** POST /prices/find: 202, the search runs in the worker. */
const AiFindPrices = z.object({ requested_at: isoDateTime }).strict();

/** POST /prices/accept-all: how many proposals were saved. */
const AiAcceptAll = z.object({ accepted: z.number().int().min(0) }).strict();

/* ------------------------------------------------------------------ *
 * Spend and caps (§6.3)
 * ------------------------------------------------------------------ */

/** One provider this Lagos month against its cap. */
const AiProviderSpend = z
  .object({
    provider: AiProvider,
    plan: IntegrationPlan.nullable(),
    /** Its key is set up. */
    set_up: z.boolean(),
    spent_ngn: money,
    cap_ngn: money.nullable(),
    at_cap: z.boolean(),
    calls: z.number().int().min(0),
  })
  .strict();

const AiSpendDay = z.object({ day: isoDate, spent_ngn: money }).strict();

/** GET /spend: this Lagos month. */
const AiSpend = z
  .object({
    /** The first day of the month. */
    month: isoDate,
    rate: AiRate.nullable(),
    overall: z
      .object({
        spent_ngn: money,
        cap_ngn: money.nullable(),
        at_cap: z.boolean(),
      })
      .strict(),
    providers: z.array(AiProviderSpend).max(5),
    /** Each day of the month so far. */
    days: z.array(AiSpendDay).max(31),
  })
  .strict();

/** This month's spend on one action. */
const AiSpendAction = z
  .object({
    key: z.string(),
    label: z.string(),
    job: AiJob.nullable(),
    calls: z.number().int().min(0),
    spent_ngn: money,
  })
  .strict();

const AiSpendActionPage = Paged(AiSpendAction);

/** `/caps/:provider` */
const AiCapParams = z.object({ provider: AiProvider }).strict();

/** PUT /caps/:provider and PUT /cap: Set Cap. Blank is no cap. */
const AiCapSave = z.object({ monthly_cap_ngn: blank(money) }).strict();

/** Gate 6 (check/contract-columns.js). */
const TABLES = {
  AiRate: { table: null, reason: "the newest exchange_rate row for USD to NGN" },
  ChainLink: {
    table: "ai_chain",
    virtual: {
      display_name: "the model's name, from ai_model",
      state: "worked out when read: the key, the plan's daily limit, skips, caps and the action (§6.1)",
      until: "when a skipped provider is asked again, from the skip kept in Redis",
    },
  },
  AiChain: { table: null, reason: "a job's or an action's chain: its ai_chain rows, else the chain in code" },
  AiJobRow: { table: null, reason: "a job from the code's list, with its chain and the actions on it" },
  AiJobPage: { table: null, reason: "the seven jobs" },
  AiActionRow: { table: null, reason: "an action from the registry in src/services/ai/actions.js, with its chain and today's calls from ai_run" },
  AiActionListQuery: { table: null, reason: "list controls and the job filter" },
  AiActionPage: { table: null, reason: "a page of registered actions" },
  AiChainParams: { table: null, reason: "the :scope and :key path parameters" },
  AiActionParams: { table: null, reason: "the :key path parameter" },
  AiChainSave: { table: null, reason: "a whole chain, kept as one ai_chain row per model" },
  AiMakeFirst: { table: null, reason: "the position of the model to move to the front" },
  ModelChainRef: { table: "ai_chain", virtual: { label: "the action's label, from the registry" } },
  AiControlModel: {
    table: "ai_model",
    virtual: {
      plan: "the provider's plan, from integration_connection",
      input_ngn_per_million: "the input price times the day's rate",
      output_ngn_per_million: "the output price times the day's rate",
      ngn_per_audio_hour: "the audio hour price times the day's rate",
      in_chains: "the chains it is in, stored or from code",
      not_listed: "price_not_listed_at within the last 7 days",
      proposed: "an open ai_price_proposal names it",
    },
  },
  AiControlModelListQuery: { table: null, reason: "list controls and the provider, capability and show filters" },
  AiControlModelPage: { table: null, reason: "a page of every provider's models" },
  AiPriceRun: { table: "ai_price_run" },
  AiModelsSummary: { table: null, reason: "the newest ai_price_run, the open proposals, the models still to price and the day's rate" },
  AiIdParams: { table: null, reason: "the :id path parameter" },
  AiPricesSave: { table: "ai_model" },
  AiPriceProposal: {
    table: "ai_price_proposal",
    virtual: {
      provider: "the model's provider, from ai_model",
      model: "the model's id, from ai_model",
      display_name: "the model's name, from ai_model",
    },
  },
  AiPriceProposalPage: { table: null, reason: "a page of open proposals" },
  FindPricesAnswer: { table: null, reason: "the model's answer to Find Prices, checked before a proposal is kept" },
  AiFindPrices: { table: null, reason: "when the request was made; the search runs in the worker" },
  AiAcceptAll: { table: null, reason: "how many open proposals Accept All saved" },
  AiProviderSpend: { table: null, reason: "ai_run_step summed per provider for the Lagos month, against ai_provider_cap" },
  AiSpendDay: { table: null, reason: "ai_run_step summed per Lagos day" },
  AiSpend: { table: null, reason: "this Lagos month's spend, summed from ai_run_step" },
  AiSpendAction: { table: null, reason: "ai_run_step summed per action (ai_run.purpose)" },
  AiSpendActionPage: { table: null, reason: "a page of this month's spend by action" },
  AiCapParams: { table: null, reason: "the :provider path parameter" },
  AiCapSave: { table: "ai_provider_cap" },
};

module.exports = {
  TABLES,
  ActionKey,
  ChainScope,
  LinkState,
  AiRate,
  ChainLink,
  AiChain,
  AiJobRow,
  AiJobPage,
  AiActionRow,
  AiActionListQuery,
  AiActionPage,
  AiChainParams,
  AiActionParams,
  AiChainSave,
  AiMakeFirst,
  ModelChainRef,
  AiControlModel,
  AiControlModelListQuery,
  AiControlModelPage,
  AiPriceRun,
  AiModelsSummary,
  AiIdParams,
  AiPricesSave,
  AiPriceProposal,
  AiPriceProposalPage,
  FindPricesAnswer,
  AiFindPrices,
  AiAcceptAll,
  AiProviderSpend,
  AiSpendDay,
  AiSpend,
  AiSpendAction,
  AiSpendActionPage,
  AiCapParams,
  AiCapSave,
};
