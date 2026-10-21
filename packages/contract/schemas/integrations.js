"use strict";
/**
 * Integrations: Settings · Integrations (docs/guides/integrations.md), where the IT team keeps
 * the settings and keys of the services the ERP runs on, instead of the server's .env file.
 *
 * Ten connections, each defined once in src/shared/integrations/providers.js:
 *
 *   mail_sender     the system sender (SMTP out: invitations, resets, notices)
 *   mailbox_server  the staff mail server (IMAP in and SMTP out for every person's mailbox)
 *   geoapify        address search, map tiles and a worksite's address
 *   gemini          Google's models: everyday AI, images, transcription after Groq
 *   groq            speech to text first (Whisper)
 *   openai          embeddings for search
 *   anthropic       top-tier drafting (Sonnet and Haiku only)
 *   deepseek        work that carries no personal data
 *   exchange_rates  every currency against the dollar, daily
 *   web_push        the environment's VAPID pair and its contact
 *
 * Each AI connection keeps a model list (`ai_model`): seeded, read from the provider with the
 * key in use whenever it is saved or tested, and added to by hand (guide §1.2 decision 2).
 *
 * A connection's values come whole from one place (`source`): saved here, else the server
 * file, else nothing (guide §6.1). A secret never crosses the wire: a response says whether
 * one is set, the last four characters of a key, who set it and when (§6.4). A save carries
 * a secret only to set or replace it; left blank, the saved one is kept.
 *
 * System mail can be paused on the System Sender (guide §6.15): until it is resumed only
 * invitations, password resets and IT's own test email go out, and notices reach people by push.
 * The addresses the mail server refused for good are listed beside it (guide §6.16).
 *
 * Read with `integrations` view; saved, tested, paused and replaced with edit; removed with
 * delete.
 */
const { z } = require("zod");
const { uuid, text, email, isoDate, isoDateTime, listQuery, Paged, blank } = require("./common");

/** The connections the registry holds, in its order. */
const IntegrationCode = z.enum([
  "mail_sender",
  "mailbox_server",
  "geoapify",
  "gemini",
  "groq",
  "openai",
  "anthropic",
  "deepseek",
  "exchange_rates",
  "web_push",
]);

/** How the page groups them. */
const IntegrationGroup = z.enum(["mail", "maps", "ai", "finance", "notifications"]);

/**
 * A connection's plan with its provider (guide §1.2 decision 4). On `free` the daily limit is
 * a hard stop; on `paid` it counts and warns. Null for a connection with no daily limit.
 */
const IntegrationPlan = z.enum(["free", "paid"]);

/** The AI connections, each with a model list. */
const AiProvider = z.enum(["gemini", "groq", "openai", "anthropic", "deepseek"]);

/** What a model takes in or gives back that the ERP uses. */
const ModelCapability = z.enum(["text", "image", "audio", "embeddings"]);

/**
 * The jobs AI is used for (docs/guides/ai-control.md §6.2). Until AI Control is built each job
 * uses the best model the key can use, in the order the code prefers.
 */
const AiJob = z.enum(["default", "fast", "deep_reasoning", "image_reading", "transcription", "embeddings", "top_tier"]);

/** Where a model on the list came from: the seed, the provider's own list, or Add Model. */
const ModelSource = z.enum(["seed", "provider", "added"]);

/**
 * The state the page shows: `ok` the newest check or call worked; `failing` it did not;
 * `unchecked` set but never checked or used; `not_set` nothing saved and nothing in the file.
 */
const IntegrationState = z.enum(["ok", "failing", "unchecked", "not_set"]);

/** Where the values in use come from (guide §6.1). */
const IntegrationSource = z.enum(["saved", "file", "none"]);

/**
 * Why a check ran: the test before a save, a Test, a Send Test Email, the worker's watch, or
 * an exchange rate fetch (Sync Rates, or the midnight job).
 */
const CheckKind = z.enum(["save", "test", "test_email", "watch", "sync"]);

/** One step of a provider's test (guide §6.3). `setup` is the one step of a connection not set up. */
const StepKey = z.enum([
  "setup",
  "connect",
  "sign_in",
  "send",
  "imap",
  "smtp",
  "search",
  "reverse",
  "tile",
  "key",
  "models",
  "answer",
  "rates",
  "keys",
  "push",
]);

/**
 * What went wrong, one code per kind of failure, shared by a check's steps and by real use
 * (guide §6.3). `SKIPPED` marks a step after a failed one it depends on; `NO_DEVICES` a test
 * push with no device to go to.
 */
const StepCode = z.enum([
  "SERVER_NOT_FOUND",
  "NO_ANSWER",
  "TLS_FAILED",
  "CERTIFICATE_MISMATCH",
  "AUTH_FAILED",
  "SENDER_REFUSED",
  "RECIPIENT_REFUSED",
  "KEY_REFUSED",
  "OVER_QUOTA",
  "UNAVAILABLE",
  "TIMEOUT",
  "MODEL_NOT_FOUND",
  "SECRET_UNREADABLE",
  "NOT_SET_UP",
  "NO_DEVICES",
  "SKIPPED",
]);

/** What a provider's use is counted as (guide §6.3). `transcribe` counts seconds of audio. */
const UsageKind = z.enum(["search", "reverse", "tile", "call", "transcribe", "rates", "send", "sync", "push"]);

/** SMTP's two ways to be secure: TLS from the first byte (465), or STARTTLS required (587). */
const SmtpSecurity = z.enum(["tls", "starttls"]);

/** A secret's field name in integration_secret.key. */
const SecretKey = z.enum(["password", "api_key", "vapid"]);

/* ------------------------------------------------------------------ *
 * Field types
 * ------------------------------------------------------------------ */

/** A host name as DNS has it: letters, digits, hyphens and dots, no scheme, no path. */
const host = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Required")
  .max(253, "Too long")
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/, "Not a host name");

const port = z.number().int("Whole number").min(1, "At least 1").max(65535, "At most 65535");

/** "MyCity App <no-reply@mycityapp.io>" or "no-reply@mycityapp.io". */
const fromAddress = z
  .string()
  .trim()
  .max(320, "Too long")
  .regex(
    /^(?:[^<>@\r\n"]{1,100} <[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+>|[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+)$/,
    "Not an address",
  );

/** A secret as typed. Not trimmed: a password may begin or end with a space. */
const secretText = (max) => z.string().min(1).max(max, "Too long");

/** A plan's daily allowance; blank is no limit. */
const dailyLimit = blank(z.number().int("Whole number").min(1, "At least 1").max(100_000_000, "Too large"));

/** A provider's API key as typed; blank keeps the saved one. */
const apiKey = blank(z.string().trim().min(8, "Too short").max(400, "Too long"));

/** A rate or a unit price as a decimal string, never a float on the wire. */
const decimal = z.string().regex(/^\d{1,14}(\.\d{1,10})?$/, "Not a number");

/**
 * The `saved_at` the form opened with, so a save over someone else's newer one is refused
 * (409 STALE). Null when nothing was saved. Not `updated_at`: checks and counted use touch the
 * row every few seconds, and a form must not go stale because the worker looked at the server.
 */
const seen = isoDateTime.nullable();

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

/** One step: passed, failed, or skipped (`ok` null), with its time and what it found. */
const CheckStep = z
  .object({
    key: StepKey,
    ok: z.boolean().nullable(),
    ms: z.number().int().min(0).nullable(),
    code: StepCode.nullable(),
    /** What an address search suggested, at most six; empty for every other step. */
    found: z.array(z.string().max(300)).max(6),
  })
  .strict();

const IntegrationCheck = z
  .object({
    integration_check_id: uuid,
    code: IntegrationCode,
    kind: CheckKind,
    ok: z.boolean(),
    steps: z.array(CheckStep).max(10),
    error_code: StepCode.nullable(),
    checked_by: uuid.nullable(),
    checked_by_name: z.string().nullable(),
    created_at: isoDateTime,
  })
  .strict();

const IntegrationCheckListQuery = listQuery({
  kind: CheckKind.optional(),
  ok: z.enum(["true", "false"]).optional(),
});

const IntegrationCheckPage = Paged(IntegrationCheck);

/* ------------------------------------------------------------------ *
 * The list and one connection
 * ------------------------------------------------------------------ */

/** A connection as the list shows it. `integration_connection_id` is null until it has a row. */
const IntegrationRow = z
  .object({
    integration_connection_id: uuid.nullable(),
    code: IntegrationCode,
    display_name: z.string(),
    group: IntegrationGroup,
    state: IntegrationState,
    source: IntegrationSource,
    last_checked_at: isoDateTime.nullable(),
    last_error_code: StepCode.nullable(),
    daily_limit: z.number().int().min(1).nullable(),
    /** Free or Paid; null for a connection with no daily limit. */
    plan: IntegrationPlan.nullable(),
    /** Today's units against the daily limit (Geoapify credits, AI requests, Groq's audio seconds). */
    units_today: z.number().min(0),
    /** The worker checks it every 15 minutes (a free test). */
    watched: z.boolean(),
    /**
     * When system mail was paused (the System Sender only): until it is resumed only invitations,
     * password resets and the test email go out. Null when it is not paused, and for every other
     * connection.
     */
    paused_at: isoDateTime.nullable(),
  })
  .strict();

const IntegrationListQuery = listQuery({ group: IntegrationGroup.optional() });

const IntegrationPage = Paged(IntegrationRow);

/** GET /integrations/summary: the cards above the list, counted over every connection. */
const IntegrationSummary = z
  .object({
    working: z.number().int().min(0),
    failing: z.number().int().min(0),
    unchecked: z.number().int().min(0),
    not_set: z.number().int().min(0),
  })
  .strict();

/** A secret, as far as it is ever shown: set or not, a hint, who set it and when. */
const SecretState = z
  .object({
    key: SecretKey,
    set: z.boolean(),
    /** The last four characters of a key, or a key pair's id. Never any part of a password. */
    hint: z.string().max(16).nullable(),
    set_by_name: z.string().nullable(),
    set_at: isoDateTime.nullable(),
  })
  .strict();

/** One day of use, every kind added together. */
const UsageDay = z
  .object({
    day: isoDate,
    calls: z.number().int().min(0),
    failures: z.number().int().min(0),
    units: z.number().min(0),
  })
  .strict();

/** The settings in use, per connection. Null values are not set. */
const MailSenderSettings = z
  .object({
    code: z.literal("mail_sender"),
    host: z.string(),
    port: z.number().int(),
    security: SmtpSecurity,
    username: z.string().nullable(),
    from: z.string(),
    reply_to: z.string().nullable(),
    /** Null: unpaced, a laptop's server file only. */
    per_hour: z.number().int().nullable(),
    /** Domains whose mailboxes are on this server, comma separated: delivered without the route check. */
    local_domains: z.string().nullable(),
  })
  .strict();

const MailboxServerSettings = z
  .object({
    code: z.literal("mailbox_server"),
    /** Null: each address's own domain. */
    imap_host: z.string().nullable(),
    imap_port: z.number().int(),
    smtp_host: z.string().nullable(),
    smtp_port: z.number().int(),
    per_person_per_hour: z.number().int(),
    sync_every_min: z.number().int(),
    live_connections: z.number().int(),
  })
  .strict();

const GeoapifySettings = z.object({ code: z.literal("geoapify") }).strict();

/** One job a model of this connection does: first choice (1) or the fallback after it (2). */
const ModelInUse = z
  .object({
    job: AiJob,
    position: z.number().int().min(1).max(4),
    model: z.string(),
    display_name: z.string(),
  })
  .strict();

/**
 * An AI connection: the jobs its models do, and how much of its list this key can use. Each
 * schema names its own code as a literal, so the union below stays discriminated in TypeScript.
 */
const aiShape = {
  in_use: z.array(ModelInUse).max(14),
  models: z.number().int().min(0),
  available: z.number().int().min(0),
};

const GeminiSettings = z.object({ code: z.literal("gemini"), ...aiShape }).strict();
const GroqSettings = z.object({ code: z.literal("groq"), ...aiShape }).strict();
const OpenAiSettings = z.object({ code: z.literal("openai"), ...aiShape }).strict();
const AnthropicSettings = z.object({ code: z.literal("anthropic"), ...aiShape }).strict();
const DeepSeekSettings = z.object({ code: z.literal("deepseek"), ...aiShape }).strict();

/** Exchange Rates: the newest table kept, shown by its dollar to naira rate. */
const ExchangeRatesSettings = z
  .object({
    code: z.literal("exchange_rates"),
    base: z.literal("USD"),
    /** Naira to one dollar on the newest day kept; null before the first fetch. */
    usd_ngn: decimal.nullable(),
    rate_day: isoDate.nullable(),
    fetched_at: isoDateTime.nullable(),
    currencies: z.number().int().min(0),
  })
  .strict();

const WebPushSettings = z
  .object({
    code: z.literal("web_push"),
    subject: z.string(),
    /** The key pair's id: what a device compares to know it must subscribe again. */
    key_id: z.string().nullable(),
  })
  .strict();

const IntegrationSettings = z.discriminatedUnion("code", [
  MailSenderSettings,
  MailboxServerSettings,
  GeoapifySettings,
  GeminiSettings,
  GroqSettings,
  OpenAiSettings,
  AnthropicSettings,
  DeepSeekSettings,
  ExchangeRatesSettings,
  WebPushSettings,
]);

/** GET /integrations/:code */
const Integration = IntegrationRow.extend({
  /** Sent back on a save, so a save over a newer one is refused. Null: nothing saved here. */
  saved_at: isoDateTime.nullable(),
  saved_by_name: z.string().nullable(),
  /** Who paused system mail; null while it is not paused. */
  paused_by_name: z.string().nullable(),
  settings: IntegrationSettings.nullable(),
  secrets: z.array(SecretState).max(4),
  last_check: IntegrationCheck.nullable(),
  /** The last seven days, oldest first, today last. */
  usage: z.array(UsageDay).max(7),
}).strict();

/* ------------------------------------------------------------------ *
 * Addresses the mail server refused (guide §6.16)
 * ------------------------------------------------------------------ */

/**
 * An address the mail server refused for good: a mailbox that does not exist, a domain that
 * takes no mail. Such a message is not tried again. The address stays on the list until mail
 * to it is accepted again, or 30 days pass.
 */
const MailRefusal = z
  .object({
    mail_refusal_id: uuid,
    email: z.string(),
    /** Whoever holds the address: a login's or an employee's name. Null when nobody does. */
    person_name: z.string().nullable(),
    /** What was being sent: a system mail template's key (`digest`, `notification`, `user-invite`). */
    template: z.string(),
    smtp_code: z.number().int().nullable(),
    /** The mail server's own words, cut to 300 characters. */
    reply: z.string().nullable(),
    refusals: z.number().int().min(1),
    first_refused_at: isoDateTime,
    last_refused_at: isoDateTime,
  })
  .strict();

const MailRefusalListQuery = listQuery();

const MailRefusalPage = Paged(MailRefusal);

/* ------------------------------------------------------------------ *
 * Saving
 * ------------------------------------------------------------------ */

const MailSenderSave = z
  .object({
    code: z.literal("mail_sender"),
    host,
    port,
    security: SmtpSecurity,
    username: blank(text(254)),
    /** Blank keeps the saved one. Needed again when host, port or username change. */
    password: blank(secretText(500)),
    from: fromAddress,
    reply_to: blank(email),
    per_hour: z.number().int("Whole number").min(1, "At least 1").max(100_000, "At most 100000"),
    local_domains: blank(
      z
        .string()
        .trim()
        .toLowerCase()
        .max(500, "Too long")
        .regex(/^[a-z0-9.-]+\.[a-z]{2,}(\s*,\s*[a-z0-9.-]+\.[a-z]{2,})*$/, "Not a domain list"),
    ),
    saved_at: seen,
  })
  .strict();

const MailboxServerSave = z
  .object({
    code: z.literal("mailbox_server"),
    imap_host: blank(host),
    imap_port: port,
    smtp_host: blank(host),
    smtp_port: port,
    per_person_per_hour: z.number().int("Whole number").min(1, "At least 1").max(10_000, "At most 10000"),
    sync_every_min: z.number().int("Whole number").min(1, "At least 1").max(60, "At most 60"),
    live_connections: z.number().int("Whole number").min(0, "At least 0").max(30, "At most 30"),
    saved_at: seen,
  })
  .strict();

/**
 * A connection that is a key, a daily limit and a plan: Geoapify, the AI providers, Exchange
 * Rates. `plan` left out keeps the plan in force. Each names its code as a literal (as above).
 */
const keyShape = {
  api_key: apiKey,
  daily_limit: dailyLimit,
  plan: IntegrationPlan.optional(),
  saved_at: seen,
};

const GeoapifySave = z.object({ code: z.literal("geoapify"), ...keyShape }).strict();
const GeminiSave = z.object({ code: z.literal("gemini"), ...keyShape }).strict();
const GroqSave = z.object({ code: z.literal("groq"), ...keyShape }).strict();
const OpenAiSave = z.object({ code: z.literal("openai"), ...keyShape }).strict();
const AnthropicSave = z.object({ code: z.literal("anthropic"), ...keyShape }).strict();
const DeepSeekSave = z.object({ code: z.literal("deepseek"), ...keyShape }).strict();
const ExchangeRatesSave = z.object({ code: z.literal("exchange_rates"), ...keyShape }).strict();

const WebPushSave = z
  .object({
    code: z.literal("web_push"),
    subject: z
      .string()
      .trim()
      .max(200, "Too long")
      .regex(/^(mailto:[^@\s]+@[^@\s]+\.[^@\s]+|https:\/\/\S+)$/, "Not mailto or https"),
    saved_at: seen,
  })
  .strict();

/** PUT /integrations/:code. `code` must match the path. */
const IntegrationSave = z.discriminatedUnion("code", [
  MailSenderSave,
  MailboxServerSave,
  GeoapifySave,
  GeminiSave,
  GroqSave,
  OpenAiSave,
  AnthropicSave,
  DeepSeekSave,
  ExchangeRatesSave,
  WebPushSave,
]);

/**
 * POST /integrations/:code/test. `address` is what Geoapify's search is tried with.
 * address:none the text a test searches once to try the key; nothing is kept
 */
const IntegrationTestBody = z.object({ address: blank(text(200)) }).strict();

/** `/:code` */
const IntegrationParams = z.object({ code: IntegrationCode }).strict();

/* ------------------------------------------------------------------ *
 * The model list of an AI connection (guide §1.2 decisions 2 and 3)
 * ------------------------------------------------------------------ */

/** One model on an AI connection's list. Prices are the provider's list prices, in dollars. */
const AiModel = z
  .object({
    ai_model_id: uuid,
    provider: AiProvider,
    model: z.string(),
    display_name: z.string(),
    capabilities: z.array(ModelCapability).min(1).max(4),
    /** Whether the key in use can use it: null until the key's list has been read. */
    available: z.boolean().nullable(),
    source: ModelSource,
    /** Where it is called, for a model added with its own endpoint; null is the provider's own. */
    endpoint_url: z.string().nullable(),
    input_usd_per_million: decimal.nullable(),
    output_usd_per_million: decimal.nullable(),
    audio_usd_per_million: decimal.nullable(),
    usd_per_audio_hour: decimal.nullable(),
    /** The jobs it does now, first choice or fallback. */
    in_use: z.array(ModelInUse).max(7),
    /** When the key's list last named it. */
    seen_at: isoDateTime.nullable(),
    added_by_name: z.string().nullable(),
    created_at: isoDateTime,
  })
  .strict();

const AiModelListQuery = listQuery({
  capability: ModelCapability.optional(),
  available: z.enum(["true", "false"]).optional(),
});

const AiModelPage = Paged(AiModel);

/** POST /integrations/:code/models: Add Model. */
const AiModelCreate = z
  .object({
    model: z
      .string()
      .trim()
      .min(2, "Too short")
      .max(120, "Too long")
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, "Not a model id"),
    display_name: blank(text(120)),
    capabilities: z.array(ModelCapability).min(1, "Pick at least one").max(4),
    /** Blank: the provider's own endpoint. */
    endpoint_url: blank(
      z
        .string()
        .trim()
        .max(300, "Too long")
        .regex(/^https:\/\/[^\s/$.?#][^\s]*$/, "Not an https address"),
    ),
  })
  .strict();

/** `/:code/models/:id` */
const AiModelParams = z.object({ code: IntegrationCode, id: uuid }).strict();

/** templates/email/integration-test.html: Send Test Email's message. */
const IntegrationTestEmailVars = z
  .object({
    connection: z.string(),
    tested_by: z.string(),
  })
  .strict();

/** Gate 6 (check/contract-columns.js). */
const TABLES = {
  CheckStep: { table: null, reason: "one step of a check, kept in integration_check.steps" },
  IntegrationCheck: {
    table: "integration_check",
    virtual: {
      code: "the connection's code, from integration_connection",
      checked_by_name: "the tester's display name, from app_user and employee",
    },
  },
  IntegrationCheckListQuery: { table: null, reason: "list controls and the kind and result filters" },
  IntegrationCheckPage: { table: null, reason: "a page of checks" },
  IntegrationRow: {
    table: "integration_connection",
    virtual: {
      group: "the registry's group for the connection",
      state: "status, or not_set when nothing is saved or in the server file",
      source: "saved when saved_at is set, else file when the server file has values, else none",
      units_today: "today's units summed from integration_usage",
      watched: "whether the registry lets the worker test it for free",
      plan: "plan, else the registry's starting plan; null without a daily limit",
    },
  },
  IntegrationListQuery: { table: null, reason: "list controls and the group filter" },
  IntegrationPage: { table: null, reason: "a page of connections, from the registry" },
  IntegrationSummary: { table: null, reason: "the registry's connections counted by state" },
  SecretState: {
    table: "integration_secret",
    virtual: {
      set: "an active row with a ciphertext exists",
      set_by_name: "who saved it, from app_user and employee",
      set_at: "rotated_at, else created_at",
    },
  },
  UsageDay: {
    table: "integration_usage",
    virtual: {
      calls: "the day's calls summed over every kind",
      failures: "the day's failures summed over every kind",
      units: "the day's units summed over every kind",
    },
  },
  MailSenderSettings: { table: null, reason: "the system sender's settings in use: configuration, or SMTP_* and MAIL_* in the server file" },
  MailboxServerSettings: { table: null, reason: "the staff mail server's settings in use: configuration, or MAILBOX_* in the server file" },
  GeoapifySettings: { table: null, reason: "Geoapify has no setting besides its key and daily limit" },
  ModelInUse: { table: null, reason: "a job a model does, worked out from the model list" },
  GeminiSettings: { table: null, reason: "the jobs Gemini's models do and the size of its list, from ai_model" },
  GroqSettings: { table: null, reason: "the jobs Groq's models do and the size of its list, from ai_model" },
  OpenAiSettings: { table: null, reason: "the jobs OpenAI's models do and the size of its list, from ai_model" },
  AnthropicSettings: { table: null, reason: "the jobs Anthropic's models do and the size of its list, from ai_model" },
  DeepSeekSettings: { table: null, reason: "the jobs DeepSeek's models do and the size of its list, from ai_model" },
  ExchangeRatesSettings: { table: null, reason: "the newest day of exchange_rate, read for the dollar to naira rate" },
  WebPushSettings: { table: null, reason: "the push contact and the key pair's id, from configuration and the stored pair" },
  Integration: {
    table: "integration_connection",
    virtual: {
      group: "the registry's group for the connection",
      state: "status, or not_set when nothing is saved or in the server file",
      source: "saved when saved_at is set, else file when the server file has values, else none",
      units_today: "today's units summed from integration_usage",
      watched: "whether the registry lets the worker test it for free",
      plan: "plan, else the registry's starting plan; null without a daily limit",
      saved_by_name: "who saved it, from app_user and employee",
      paused_by_name: "who paused system mail, from app_user and employee",
      settings: "the settings in use: configuration, or the server file",
      secrets: "each secret field's state, from integration_secret",
      last_check: "the newest integration_check",
      usage: "seven days of integration_usage",
    },
  },
  MailRefusal: {
    table: "mail_refusal",
    virtual: { person_name: "the login's or the employee's name that holds the address, from app_user and employee" },
  },
  MailRefusalListQuery: { table: null, reason: "list controls" },
  MailRefusalPage: { table: null, reason: "a page of refused addresses" },
  MailSenderSave: { table: null, reason: "the system sender's settings: configuration and its password in integration_secret" },
  MailboxServerSave: { table: null, reason: "the staff mail server's settings, kept in configuration" },
  GeoapifySave: { table: null, reason: "Geoapify's key in integration_secret, its daily limit and plan" },
  GeminiSave: { table: null, reason: "Gemini's key in integration_secret, its daily limit and plan" },
  GroqSave: { table: null, reason: "Groq's key in integration_secret, its daily limit and plan" },
  OpenAiSave: { table: null, reason: "OpenAI's key in integration_secret, its daily limit and plan" },
  AnthropicSave: { table: null, reason: "Anthropic's key in integration_secret, its daily limit and plan" },
  DeepSeekSave: { table: null, reason: "DeepSeek's key in integration_secret, its daily limit and plan" },
  ExchangeRatesSave: { table: null, reason: "the exchange rate service's key in integration_secret, its daily limit and plan" },
  WebPushSave: { table: null, reason: "the push contact, kept in configuration" },
  IntegrationTestBody: { table: null, reason: "what a test is tried with" },
  IntegrationParams: { table: null, reason: "the :code path parameter" },
  AiModel: {
    table: "ai_model",
    virtual: {
      in_use: "the jobs it does now, worked out from the model list",
      added_by_name: "who added it, from app_user and employee",
    },
  },
  AiModelListQuery: { table: null, reason: "list controls and the capability and availability filters" },
  AiModelPage: { table: null, reason: "a page of an AI connection's models" },
  AiModelCreate: { table: "ai_model" },
  AiModelParams: { table: null, reason: "the :code and :id path parameters" },
  IntegrationTestEmailVars: { table: null, reason: "the variables of templates/email/integration-test.html, not a row" },
};

module.exports = {
  TABLES,
  IntegrationCode,
  IntegrationGroup,
  IntegrationPlan,
  AiProvider,
  ModelCapability,
  AiJob,
  ModelSource,
  IntegrationState,
  IntegrationSource,
  CheckKind,
  StepKey,
  StepCode,
  UsageKind,
  SmtpSecurity,
  SecretKey,
  CheckStep,
  IntegrationCheck,
  IntegrationCheckListQuery,
  IntegrationCheckPage,
  IntegrationRow,
  IntegrationListQuery,
  IntegrationPage,
  IntegrationSummary,
  SecretState,
  UsageDay,
  MailSenderSettings,
  MailboxServerSettings,
  GeoapifySettings,
  ModelInUse,
  GeminiSettings,
  GroqSettings,
  OpenAiSettings,
  AnthropicSettings,
  DeepSeekSettings,
  ExchangeRatesSettings,
  WebPushSettings,
  IntegrationSettings,
  Integration,
  MailRefusal,
  MailRefusalListQuery,
  MailRefusalPage,
  MailSenderSave,
  MailboxServerSave,
  GeoapifySave,
  GeminiSave,
  GroqSave,
  OpenAiSave,
  AnthropicSave,
  DeepSeekSave,
  ExchangeRatesSave,
  WebPushSave,
  IntegrationSave,
  IntegrationTestBody,
  IntegrationParams,
  AiModel,
  AiModelListQuery,
  AiModelPage,
  AiModelCreate,
  AiModelParams,
  IntegrationTestEmailVars,
};
