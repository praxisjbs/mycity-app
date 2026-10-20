import type { CheckStep, Integration, IntegrationCheck, IntegrationCode, IntegrationRow, SecretState, UsageDay } from "@mycity/contract/contract.gen.ts";
import { fail, invalid, noContent, ok, paged, route, sid } from "../core";

/**
 * Settings · Integrations on the mock (packages/contract/schemas/integrations.js): the five
 * connections of the registry, one of each kind of state, so the screen can be built and read
 * without a database or a provider behind it.
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
  units_today: 0,
  watched: false,
  ...over,
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
    row: row("geoapify", "Geoapify", "maps", { last_checked_at: AGO(60 * 3), daily_limit: 3000 }),
    saved_at: AGO(60 * 3),
    saved_by_name: GE,
    values: {},
    secrets: [{ key: "api_key", set: true, hint: "1a2b", set_by_name: GE, set_at: AGO(60 * 3) }],
    checks: [check("geoapify", "save", [step("search", 310, null, ["Admiralty Way, Lekki Phase 1, Lagos", "Admiralty Road, Lekki, Lagos"]), step("reverse", 240), step("tile", 160)], GE, AGO(60 * 3))],
    usage: week(90, 110),
  },
  gemini: {
    row: row("gemini", "Gemini", "ai", { state: "failing", source: "file", last_checked_at: AGO(60 * 5), last_error_code: "KEY_REFUSED" }),
    saved_at: null,
    saved_by_name: null,
    values: { model: "gemini-2.5-flash" },
    secrets: [{ key: "api_key", set: true, hint: "x9Qe", set_by_name: null, set_at: null }],
    checks: [check("gemini", "test", [step("key", 410, "KEY_REFUSED"), step("answer", null, "SKIPPED")], "Cynthia Osakunih", AGO(60 * 5))],
    usage: week(40),
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

const ORDER: IntegrationCode[] = ["mail_sender", "mailbox_server", "geoapify", "gemini", "web_push"];

// Today's use on the list is the last day of the week the panel draws, as the API reads both from one table.
for (const code of ORDER) {
  const c = CONNECTIONS[code];
  c.row.units_today = c.usage[c.usage.length - 1].units;
}

function detail(c: Connection): Integration {
  const settings = c.values === null ? null : ({ code: c.row.code, ...c.values } as Integration["settings"]);
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
  if (code === "gemini") return (typed.api_key ?? "").includes("bad") ? [step("key", 400, "KEY_REFUSED"), step("answer", null, "SKIPPED")] : [step("key", 380), step("answer", 1450)];
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
  const { daily_limit, ...rest } = values;
  c.values = c.row.code === "gemini" || c.row.code === "geoapify" ? { ...(c.values ?? {}) } : { ...(c.values ?? {}), ...rest };
  if ("daily_limit" in body) c.row.daily_limit = daily_limit === null || daily_limit === undefined ? null : Number(daily_limit);
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
