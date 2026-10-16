"use strict";
/**
 * Environment: read once, validated, frozen. The only file that reads process.env
 * for application settings (SYSTEM_ARCHITECTURE §10: APP_ENV is read here and
 * nowhere else branches on it except the environment markers and the seed guard).
 *
 *   const { config } = require("../config/env");
 *   config.APP_ENV        "development" | "test" | "staging" | "production"
 *
 * Zod over process.env; bad input refuses to boot. Two rules beyond plain parsing:
 *
 *   1. A value that starts with "#" is a comment some parser failed to strip
 *      (`KEY=   # e.g. ...`). Treated as empty, and announced.
 *   2. Published development defaults are an auth bypass if they reach a server,
 *      so a server has no default secret at all: on staging and production every
 *      secret is REQUIRED, and the development values are refused by value as well.
 *
 * The entries below are also the source of `.env.example` (scripts/gen/env-example.js);
 * CI checks the two match. Add a variable here, with its doc line, and regenerate.
 *
 * Tests: `.env` is not read under Jest (JEST_WORKER_ID) or when MYCITY_SKIP_DOTENV=1,
 * so a developer's own file cannot change what a unit test sees.
 */
const { z } = require("zod");
// Its link check only: the alert sender requires nothing, so this adds no cycle.
const { parseWhatsapp } = require("../shared/observability/alert");

const whatsappProblems = (value) => parseWhatsapp(value).problems;

/* ------------------------------------------------------------------ *
 * Value helpers
 * ------------------------------------------------------------------ */

const bool = (def) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v === "" ? def : /^(1|true|yes|on)$/i.test(v),
    );

const int = (def, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const str = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v.trim()));

/** An amount in naira with two decimals ("450.00"); empty means the default. */
const amount = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? def : v.trim()))
    .pipe(
      z.string().regex(/^\d{1,12}\.\d{2}$/, "must be an amount like 450.00"),
    );

/** Development-only defaults. Refused on staging and production by value (see guard). */
const DEV_SECRETS = Object.freeze({
  JWT_ACCESS_SECRET: "dev-access-secret-not-for-servers-0000000000",
  JWT_REFRESH_SECRET: "dev-refresh-secret-not-for-servers-000000000",
  ENCRYPTION_KEY:
    "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
});

/* ------------------------------------------------------------------ *
 * The variables
 *
 * [key, schema, { group, doc, secret?, example? }]
 * `example` is what .env.example shows; secrets never show a real value.
 * ------------------------------------------------------------------ */

const ENTRIES = [
  // Runtime
  [
    "APP_ENV",
    z
      .enum(["development", "test", "staging", "production"])
      .default("development"),
    {
      group: "Runtime",
      doc: "Which environment this process is. Drives the markers, the seed guard and the server checks below.",
    },
  ],
  [
    "NODE_ENV",
    z.enum(["development", "test", "production"]).default("development"),
    {
      group: "Runtime",
      doc: "Must be production on staging and production servers.",
    },
  ],
  [
    "PORT",
    int(8080, { min: 1, max: 65535 }),
    {
      group: "Runtime",
      doc: "API listen port. Staging and production run on different ports behind the proxy.",
    },
  ],
  [
    "LOG_LEVEL",
    z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    { group: "Runtime", doc: "Pino log level." },
  ],
  [
    "TRUST_PROXY_HOPS",
    int(1, { max: 5 }),
    {
      group: "Runtime",
      doc: "Proxies in front of Node. 1 behind the hosting panel proxy; 0 only when Node is hit directly.",
    },
  ],
  [
    "BUILD_SHA",
    str(""),
    {
      group: "Runtime",
      doc: "Commit of the running release. Written by the deploy; empty on a laptop.",
    },
  ],
  [
    "BUILD_TIME",
    str(""),
    {
      group: "Runtime",
      doc: "When the release was built (ISO). Written by the deploy.",
    },
  ],

  // Origins (SYSTEM_ARCHITECTURE §3)
  [
    "STAFF_ORIGIN",
    z.string().url().default("http://localhost:5173"),
    {
      group: "Origins",
      doc: "The staff app origin. CORS for /api/v1 and Socket.io allows this origin only.",
      example: "https://hub.mycityapp.io",
    },
  ],
  [
    "PUBLIC_ORIGIN",
    z.string().url().default("http://localhost:5174"),
    {
      group: "Origins",
      doc: "The public site origin. CORS for /api/public/v1 allows this origin only, without credentials.",
      example: "https://go.mycityapp.io",
    },
  ],
  [
    "DEV_EXTRA_ORIGINS",
    str(""),
    {
      group: "Origins",
      doc: "Development only: extra comma-separated origins allowed on both surfaces. Ignored on servers.",
    },
  ],

  // Database
  [
    "DATABASE_URL",
    str(""),
    {
      group: "Database",
      doc: "Optional. postgres://user:pass@host:port/db. When set it wins over the DB_* values.",
    },
  ],
  ["DB_HOST", str("127.0.0.1"), { group: "Database", doc: "Postgres host." }],
  [
    "DB_PORT",
    int(5432, { min: 1, max: 65535 }),
    { group: "Database", doc: "Postgres port." },
  ],
  [
    "DB_NAME",
    str("mycity_dev"),
    {
      group: "Database",
      doc: "mycity_prod on production, mycity_stg on staging (checked at boot).",
      example: "mycity_dev",
    },
  ],
  [
    "DB_USER",
    str("mycity_dev"),
    {
      group: "Database",
      doc: "The environment's own app role. Never a superuser.",
    },
  ],
  [
    "DB_PASSWORD",
    str(""),
    { group: "Database", doc: "Required on servers.", secret: true },
  ],
  [
    "DB_SSL",
    bool(false),
    {
      group: "Database",
      doc: "TLS to Postgres. Off for a local socket on the same server.",
    },
  ],
  [
    "DB_POOL_MAX",
    int(20, { min: 1, max: 200 }),
    {
      group: "Database",
      doc: "Connections in the API process's pool. 20 on production, 10 on staging.",
    },
  ],
  [
    "WORKER_DB_POOL_MAX",
    int(10, { min: 2, max: 200 }),
    {
      group: "Database",
      doc: "Connections in the worker process's pool. 10 on production, 5 on staging.",
    },
  ],
  [
    "DB_STATEMENT_TIMEOUT_MS",
    int(30000, { min: 1000 }),
    {
      group: "Database",
      doc: "A statement running longer than this is cancelled by Postgres.",
    },
  ],
  [
    "DB_SLOW_QUERY_MS",
    int(500, { min: 1 }),
    { group: "Database", doc: "Queries slower than this are logged at warn." },
  ],

  // Redis (SYSTEM_ARCHITECTURE §1: db 0 production, db 1 staging)
  [
    "REDIS_URL",
    z.string().default("redis://127.0.0.1:6379/2"),
    {
      group: "Redis",
      doc: "redis://[:password@]host:port/db. Production uses db 0, staging db 1 (checked at boot); local defaults to db 2.",
    },
  ],

  // Sign-in (SYSTEM_ARCHITECTURE §8)
  [
    "JWT_ACCESS_SECRET",
    str(""),
    {
      group: "Sign-in",
      doc: "Signs access tokens. At least 32 characters; different from the refresh secret.",
      secret: true,
    },
  ],
  [
    "JWT_REFRESH_SECRET",
    str(""),
    {
      group: "Sign-in",
      doc: "Signs refresh tokens. At least 32 characters.",
      secret: true,
    },
  ],
  [
    "ACCESS_TOKEN_MIN",
    int(15, { min: 1, max: 60 }),
    { group: "Sign-in", doc: "Access token life in minutes." },
  ],
  [
    "SESSION_MAX_AGE_MIN",
    int(120, { min: 5, max: 24 * 60 }),
    {
      group: "Sign-in",
      doc: "A session ends this many minutes after sign-in, whatever the person is doing; the screen locks and they sign in again. Every token ends with its session.",
    },
  ],
  [
    "SESSION_INACTIVITY_MIN",
    int(30, { min: 5, max: 24 * 60 }),
    {
      group: "Sign-in",
      doc: "A session with no refresh for this many minutes (a closed tab, a sleeping laptop) ends on its return.",
    },
  ],
  [
    "CREDENTIAL_ENROL_WINDOW_MIN",
    int(15, { min: 1, max: 120 }),
    {
      group: "Sign-in",
      doc: "Adding a new way to sign in (a passkey, a PIN) needs no password only this soon after signing in.",
    },
  ],
  [
    "PASSWORD_BREACH_CHECK",
    bool(true),
    {
      group: "Sign-in",
      doc: "Refuse a new password found in known breaches (Have I Been Pwned range API: only 5 characters of a hash leave the server). Allows the password if the service is unreachable.",
    },
  ],
  [
    "WEBAUTHN_RP_ID",
    str(""),
    {
      group: "Sign-in",
      doc: "Passkeys belong to this host (the relying party ID): hub.mycityapp.io, or hub.staging.mycityapp.io on staging. Empty: the host of WEBAUTHN_ORIGIN.",
      example: "hub.mycityapp.io",
    },
  ],
  [
    "WEBAUTHN_ORIGIN",
    str(""),
    {
      group: "Sign-in",
      doc: "The page origin a passkey must be used from, https on servers: https://hub.mycityapp.io, or https://hub.staging.mycityapp.io on staging. Empty: STAFF_ORIGIN.",
      example: "https://hub.mycityapp.io",
    },
  ],

  // Secrets at rest
  [
    "ENCRYPTION_KEY",
    str(""),
    {
      group: "Secrets",
      doc: "64 hex characters (32 bytes). AES-256-GCM key for integration_secret (mailbox passwords).",
      secret: true,
    },
  ],

  // Files
  [
    "MEDIA_ROOT",
    str("./media"),
    {
      group: "Files",
      doc: "Private media root for this environment.",
      example: "/srv/mycity/<prod|stg>/media",
    },
  ],

  [
    "APP_DIST_DIR",
    str("app/dist"),
    {
      group: "Files",
      doc: "The staff app build the API serves on the staff host. Relative to the release root.",
    },
  ],
  [
    "PUBLIC_APP_DIST_DIR",
    str("public-app/dist"),
    {
      group: "Files",
      doc: "The public site build the API serves on the public host. Relative to the release root.",
    },
  ],

  // Media tools (ops/provision installs them; BACKEND_STRUCTURE §5)
  [
    "CHROMIUM_PATH",
    str(""),
    {
      group: "Media tools",
      doc: "Chromium for PDFs. Empty: the usual install paths are tried (/usr/bin/chromium, ...).",
      example: "/usr/bin/chromium",
    },
  ],
  [
    "FFMPEG_PATH",
    str("ffmpeg"),
    { group: "Media tools", doc: "ffmpeg, for voice notes and video." },
  ],
  [
    "FFPROBE_PATH",
    str("ffprobe"),
    { group: "Media tools", doc: "ffprobe, for media duration and size." },
  ],
  [
    "CLAMD_SOCKET",
    str(""),
    {
      group: "Media tools",
      doc: "clamd's unix socket, for scanning files strangers upload. Empty: CLAMD_HOST and CLAMD_PORT.",
      example: "/run/clamav/clamd.ctl",
    },
  ],
  [
    "CLAMD_HOST",
    str("127.0.0.1"),
    { group: "Media tools", doc: "clamd TCP host, when no socket is set." },
  ],
  [
    "CLAMD_PORT",
    int(3310, { min: 1, max: 65535 }),
    { group: "Media tools", doc: "clamd TCP port, when no socket is set." },
  ],

  // System mail (A4: staging sends real mail, marked)
  [
    "SMTP_HOST",
    str(""),
    {
      group: "Mail",
      doc: "SMTP server for system mail. Empty in development and test: mail is captured, never sent. Required on servers.",
    },
  ],
  [
    "SMTP_PORT",
    int(587, { min: 1, max: 65535 }),
    { group: "Mail", doc: "587 with STARTTLS, or 465 with SMTP_SECURE." },
  ],
  [
    "SMTP_SECURE",
    bool(false),
    {
      group: "Mail",
      doc: "TLS from the first byte (port 465). Off: STARTTLS is required.",
    },
  ],
  ["SMTP_USER", str(""), { group: "Mail", doc: "SMTP account." }],
  [
    "SMTP_PASSWORD",
    str(""),
    { group: "Mail", doc: "SMTP password.", secret: true },
  ],
  [
    "MAIL_FROM",
    str("MyCity App <no-reply@mycityapp.io>"),
    {
      group: "Mail",
      doc: "From address for system mail. Its domain must pass SPF, DKIM and DMARC (services/mail/deliverability).",
    },
  ],
  [
    "MAIL_REPLY_TO",
    str(""),
    {
      group: "Mail",
      doc: "Optional Reply-To for system mail (the support inbox).",
    },
  ],
  [
    "MAIL_SEND_PER_HOUR",
    int(0, { min: 0, max: 100000 }),
    {
      group: "Mail",
      doc: "System mail recipients per rolling hour (services/mail/pace.js); 0 sends unpaced. Production and staging share the mailbox's limit: 40 and 10 of the plan's 50. Required on servers.",
    },
  ],
  [
    "MAIL_RBL_HOSTS",
    str(""),
    {
      group: "Mail",
      doc: "Comma-separated DNS blocklists the deliverability check looks the sending IP up in. Empty: Spamhaus ZEN, SpamCop and Barracuda.",
      example: "zen.spamhaus.org,bl.spamcop.net",
    },
  ],

  // AI (BACKEND_STRUCTURE §14). No key: every AI call uses the stub and is still recorded.
  [
    "GEMINI_API_KEY",
    str(""),
    {
      group: "AI",
      doc: 'Gemini API key. Empty: AI calls return the stub\'s placeholder (vendor "stub"), are recorded, and cost nothing.',
      secret: true,
    },
  ],
  [
    "GEMINI_MODEL",
    str("gemini-2.5-flash"),
    {
      group: "AI",
      doc: "The Gemini model every AI call uses unless ai_setting names another.",
    },
  ],
  [
    "AI_REQUEST_TIMEOUT_MS",
    int(60000, { min: 5000, max: 300000 }),
    {
      group: "AI",
      doc: "How long one AI call may take before it is abandoned.",
    },
  ],
  [
    "AI_MAX_OUTPUT_TOKENS",
    int(4096, { min: 256, max: 65536 }),
    { group: "AI", doc: "Ceiling on one answer's length, in tokens." },
  ],
  [
    "AI_INPUT_NGN_PER_MILLION",
    amount("450.00"),
    {
      group: "AI",
      doc: "Naira per million input tokens, for the spend ledger and the monthly cap. Default: Gemini 2.5 Flash list price at about 1,500 naira to the dollar. ai_setting overrides it.",
    },
  ],
  [
    "AI_OUTPUT_NGN_PER_MILLION",
    amount("3750.00"),
    {
      group: "AI",
      doc: "Naira per million output tokens. ai_setting overrides it.",
    },
  ],

  // Rate limits (SYSTEM_ARCHITECTURE §3)
  [
    "RATE_LIMIT_STAFF_PER_MIN",
    int(600, { min: 10 }),
    { group: "Rate limits", doc: "Staff API requests per user per minute." },
  ],
  [
    "RATE_LIMIT_PUBLIC_PER_MIN",
    int(120, { min: 10 }),
    { group: "Rate limits", doc: "Public API requests per IP per minute." },
  ],
  [
    "RATE_LIMIT_PUBLIC_WRITES_PER_MIN",
    int(20, { min: 1 }),
    {
      group: "Rate limits",
      doc: "Public API writes (applications, uploads) per IP per minute.",
    },
  ],

  // Observability
  [
    "ALERT_WEBHOOK_URL",
    str(""),
    {
      group: "Observability",
      doc: "Slack or Google Chat webhook for alerts (5xx, backups, uptime). Empty: not used.",
      secret: true,
    },
  ],
  [
    "ALERT_WHATSAPP_URLS",
    str(""),
    {
      group: "Observability",
      doc: "WhatsApp alert links, one per person, separated by spaces; each a gateway link with {text} where the message goes (docs/runbooks/monitoring.md §2). Empty: not used.",
      secret: true,
    },
  ],
  [
    "METRICS_TOKEN",
    str(""),
    {
      group: "Observability",
      doc: "Bearer token for GET /api/metrics. Empty: the endpoint does not exist.",
      secret: true,
    },
  ],
];

const KEYS = ENTRIES.map(([k]) => k);

/* ------------------------------------------------------------------ *
 * Parsing (pure, so tests can call it with any object)
 * ------------------------------------------------------------------ */

/** Keys whose value is a "# comment" a parser kept. Mutates `env` to empty them. */
function stripMisparsedComments(env) {
  const spoiled = [];
  for (const key of KEYS) {
    const v = env[key];
    if (typeof v === "string" && v.trimStart().startsWith("#")) {
      spoiled.push(key);
      env[key] = "";
    }
  }
  return spoiled;
}

function dbFromUrl(url) {
  const u = new URL(url);
  return {
    DB_HOST: u.hostname,
    DB_PORT: u.port ? Number(u.port) : 5432,
    DB_NAME: decodeURIComponent(u.pathname.replace(/^\//, "")),
    DB_USER: decodeURIComponent(u.username),
    DB_PASSWORD: decodeURIComponent(u.password),
  };
}

function redisDbIndex(url) {
  try {
    const p = new URL(url).pathname.replace(/^\//, "");
    return p === "" ? 0 : Number(p);
  } catch {
    return NaN;
  }
}

/**
 * What a server (staging or production) must have. Every rule here is a way a
 * misconfigured .env would otherwise boot and do damage quietly.
 */
function serverProblems(c) {
  const out = [];
  const isServer = c.APP_ENV === "staging" || c.APP_ENV === "production";
  const devValue = (k) => c[k] === DEV_SECRETS[k];

  for (const k of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) {
    if (!c[k]) out.push(`${k} is required`);
    else if (c[k].length < 32) out.push(`${k} must be at least 32 characters`);
    else if (isServer && devValue(k)) out.push(`${k} is the development value`);
  }
  if (c.JWT_ACCESS_SECRET && c.JWT_ACCESS_SECRET === c.JWT_REFRESH_SECRET) {
    out.push("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ");
  }
  if (!/^[0-9a-f]{64}$/i.test(c.ENCRYPTION_KEY))
    out.push("ENCRYPTION_KEY must be 64 hex characters");
  else if (isServer && devValue("ENCRYPTION_KEY"))
    out.push("ENCRYPTION_KEY is the development value");

  for (const p of whatsappProblems(c.ALERT_WHATSAPP_URLS))
    out.push(`ALERT_WHATSAPP_URLS: ${p}`);

  // A passkey made on one host cannot be used on another, so the two must agree.
  let rpOrigin = null;
  try {
    rpOrigin = new URL(c.WEBAUTHN_ORIGIN);
  } catch {
    out.push("WEBAUTHN_ORIGIN must be a URL");
  }
  if (
    rpOrigin &&
    rpOrigin.hostname !== c.WEBAUTHN_RP_ID &&
    !rpOrigin.hostname.endsWith(`.${c.WEBAUTHN_RP_ID}`)
  )
    out.push("WEBAUTHN_RP_ID must be WEBAUTHN_ORIGIN's host, or a domain it sits under");

  if (!isServer) return out;

  if (rpOrigin && rpOrigin.protocol !== "https:")
    out.push(`WEBAUTHN_ORIGIN must be https on ${c.APP_ENV}`);

  if (c.NODE_ENV !== "production")
    out.push(`NODE_ENV must be production on ${c.APP_ENV}`);
  if (!c.DB_PASSWORD) out.push("DB_PASSWORD is required");

  const expectedDb = c.APP_ENV === "production" ? "mycity_prod" : "mycity_stg";
  if (c.DB_NAME !== expectedDb)
    out.push(`DB_NAME must be ${expectedDb} on ${c.APP_ENV} (is ${c.DB_NAME})`);

  const expectedRedisDb = c.APP_ENV === "production" ? 0 : 1;
  if (redisDbIndex(c.REDIS_URL) !== expectedRedisDb) {
    out.push(`REDIS_URL must select db ${expectedRedisDb} on ${c.APP_ENV}`);
  }

  for (const k of ["STAFF_ORIGIN", "PUBLIC_ORIGIN"]) {
    if (!c[k].startsWith("https://"))
      out.push(`${k} must be https on ${c.APP_ENV}`);
  }
  if (c.TRUST_PROXY_HOPS < 1)
    out.push("TRUST_PROXY_HOPS must be at least 1 behind the proxy");
  if (!c.SMTP_HOST)
    out.push(
      `SMTP_HOST is required on ${c.APP_ENV} (A4: system mail is really sent)`,
    );
  if (!c.MAIL_SEND_PER_HOUR)
    out.push(
      `MAIL_SEND_PER_HOUR is required on ${c.APP_ENV} (the mailbox's hourly limit; docs/runbooks/dns-and-mail.md)`,
    );
  if (!/<[^@\s]+@[^>\s]+>$|^[^@\s]+@[^@\s]+$/.test(c.MAIL_FROM))
    out.push("MAIL_FROM must be an address, or Name <address>");
  return out;
}

/**
 * Parse an environment object.
 *
 * @param {Record<string, string|undefined>} source  usually process.env
 * @returns {{ config: object|null, problems: string[], misparsed: string[] }}
 */
function parseEnv(source) {
  const env = { ...source };
  const misparsed = stripMisparsedComments(env);
  const schema = z.object(Object.fromEntries(ENTRIES.map(([k, s]) => [k, s])));
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = Object.entries(parsed.error.flatten().fieldErrors).map(
      ([k, msgs]) => `${k}: ${msgs.join(", ")}`,
    );
    return { config: null, problems, misparsed };
  }

  const c = { ...parsed.data };

  if (c.DATABASE_URL) {
    try {
      Object.assign(c, dbFromUrl(c.DATABASE_URL));
    } catch {
      return {
        config: null,
        problems: ["DATABASE_URL is not a valid URL"],
        misparsed,
      };
    }
  }

  // Passkeys belong to the staff app's host unless set otherwise; the default is right by
  // construction, so a server whose .env predates these two settings keeps working.
  if (!c.WEBAUTHN_ORIGIN) c.WEBAUTHN_ORIGIN = c.STAFF_ORIGIN;
  if (!c.WEBAUTHN_RP_ID) {
    try {
      c.WEBAUTHN_RP_ID = new URL(c.WEBAUTHN_ORIGIN).hostname;
    } catch {
      c.WEBAUTHN_RP_ID = "";
    }
  }

  // Laptops and CI run without secrets; servers never do (serverProblems).
  const local = c.APP_ENV === "development" || c.APP_ENV === "test";
  if (local) {
    for (const [k, v] of Object.entries(DEV_SECRETS)) if (!c[k]) c[k] = v;
  }
  if (!local) c.DEV_EXTRA_ORIGINS = "";

  return { config: c, problems: serverProblems(c), misparsed };
}

/** Short name used in Redis keys, queue prefixes and log lines. */
function envShort(appEnv) {
  return {
    production: "prod",
    staging: "stg",
    development: "dev",
    test: "test",
  }[appEnv];
}

/* ------------------------------------------------------------------ *
 * Load
 * ------------------------------------------------------------------ */

const underJest = Boolean(process.env.JEST_WORKER_ID);
if (!underJest && process.env.MYCITY_SKIP_DOTENV !== "1") {
  require("dotenv").config({ quiet: true });
}

const result = parseEnv(process.env);

if (result.misparsed.length) {
  // console, not the logger: the logger is configured from this file.
  console.warn(
    `[env] ignored ${result.misparsed.length} setting(s) whose value was a comment: ` +
      `${result.misparsed.join(", ")}. Put the comment on its own line, or quote the value.`,
  );
}

if (!result.config || result.problems.length) {
  const list = result.problems.map((p) => `  - ${p}`).join("\n");
  throw new Error(`Refusing to start: the environment is not valid.\n${list}`);
}

const config = Object.freeze(result.config);
const ENV_SHORT = envShort(config.APP_ENV);

module.exports = {
  config,
  /** Which process this is: "mycity-api" unless worker.js or a script set MYCITY_PROCESS first. */
  PROCESS_NAME: process.env.MYCITY_PROCESS || "mycity-api",
  /** "prod" | "stg" | "dev" | "test" */
  ENV_SHORT,
  /** Prefix for every Redis key and BullMQ queue of this environment. */
  REDIS_PREFIX: `mycity:${ENV_SHORT}`,
  /** True on staging and production. */
  isServer: config.APP_ENV === "staging" || config.APP_ENV === "production",
  ENTRIES,
  DEV_SECRETS,
  parseEnv,
  envShort,
};
