"use strict";
/**
 * Praxis AI's Home and Settings cards on the real migrations (docs/guides/praxis-ai.md §6.11,
 * decisions 33 to 35): each the screen's own service function, an edit naming what it changes and
 * keeping the rest as it stands, every field it needs asked first, and held to the grant and the
 * capability its route asks. Settings: the organisation's details, a holiday added and changed, one
 * working day, a numbering scheme. Notifications: a person's own kind of notice, quiet hours and
 * digest; the company's rule for a notice and its reminders. System Health: the targets, a fault's
 * status and a note. Home: an alert rule made and changed, a report built, renamed and scheduled.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-actions-settings
 */
process.env.GEMINI_API_KEY = "test-key";
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const registry = require("../../src/shared/ai/registry");
const authorise = require("../../src/shared/ai/authorise");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const { q, one, fresh, script, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("Praxis AI's Home and Settings cards against the real migrations", () => {
  let app;
  let h;

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026" },
      { who: "impl", first: "Kola", last: "Ade", email: "kola@mycity.test", job: "Implementation Lead", role: "implementation", password: "Health#Desk2026" },
      { who: "staff", first: "Tunde", last: "Ade", email: "tunde@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026" },
    ]);
    registry.load();
    fresh();
  }, 120_000);

  afterAll(async () => {
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fresh();
  });

  /** The card the model drafts for a question, as the answer carries it. */
  const drawn = async (who, key, values, question = "Do it.") => {
    script(say({ text: "Here it is.", action: { key, values, suggested: false } }));
    const asked = await h.ask(who, { question, shows: ["cards"] });
    expect(asked.status).toBe(200);
    expect(c.assistant.AiAnswer.safeParse(asked.body).success).toBe(true);
    return asked.body;
  };
  const userOf = (who) => grantsCache.getAuthUser(pool, h.people[who].user_id);
  const offered = async (who) => (await authorise.allowedActions(await userOf(who))).map((a) => a.key);

  test("Settings: organisation.edit, holidays.add and holidays.edit, working_week.day and numbering.edit through Settings' own services; staff are offered none", async () => {
    expect(await offered("staff")).not.toEqual(expect.arrayContaining(["organisation.edit"]));
    expect(await offered("ops")).toEqual(expect.arrayContaining(["organisation.edit", "holidays.add", "holidays.edit", "working_week.day", "numbering.edit"]));

    const org = (await drawn("ops", "organisation.edit", { trading_name: "MyCity Lagos", website: "https://mycity.example" })).card;
    expect(org).toMatchObject({ action_key: "organisation.edit", label: "Save Organisation", schema: "settings.OrganisationPatch", problems: {} });
    expect(org.fields.map((f) => f.name)).not.toContain("address");
    expect((await h.press("ops", org.ai_action_draft_id)).status).toBe(200);
    expect((await h.as("ops").get("/settings/organisation")).body).toMatchObject({ trading_name: "MyCity Lagos", website: "https://mycity.example" });

    // A holiday: asked its name first, then drawn and added; then renamed by its words, its day kept.
    const ask = await drawn("ops", "holidays.add", { holiday_date: "2026-12-31" });
    expect(ask).toMatchObject({ content: "What is the holiday called?", card: null });
    const add = (await drawn("ops", "holidays.add", { holiday_date: "2026-12-31", name: "End of Year Break" })).card;
    expect(add).toMatchObject({ action_key: "holidays.add", label: "Add Holiday", problems: {} });
    const added = await h.press("ops", add.ai_action_draft_id);
    expect(added.body.lines).toEqual([expect.objectContaining({ type: "public_holiday", label: "End of Year Break, 31/12/2026", ok: true, message: "added" })]);
    const rename = (await drawn("ops", "holidays.edit", { public_holiday_id: "End of Year Break", name: "Year End Break" })).card;
    expect(rename).toMatchObject({ action_key: "holidays.edit", label: "Save Holiday", problems: {} });
    expect(rename.records).toEqual([expect.objectContaining({ type: "public_holiday", label: "End of Year Break, 31/12/2026" })]);
    expect((await h.press("ops", rename.ai_action_draft_id)).status).toBe(200);
    expect(await one("SELECT name, to_char(holiday_date, 'YYYY-MM-DD') AS day FROM public_holiday WHERE name = 'Year End Break'")).toEqual({ name: "Year End Break", day: "2026-12-31" });

    // One working day: Saturday becomes a half day; the other six stay as they were.
    const before = (await h.as("ops").get("/settings/working-week")).body.days;
    const saturday = (await drawn("ops", "working_week.day", { weekday: "saturday", is_working_day: true, starts_at: "09:00", ends_at: "13:00" })).card;
    expect(saturday).toMatchObject({ action_key: "working_week.day", label: "Save Working Day", problems: {} });
    expect((await h.press("ops", saturday.ai_action_draft_id)).status).toBe(200);
    const after = (await h.as("ops").get("/settings/working-week")).body.days;
    expect(after.find((d) => d.weekday === 6)).toMatchObject({ is_working_day: true, starts_at: "09:00", ends_at: "13:00" });
    expect(after.filter((d) => d.weekday !== 6)).toEqual(before.filter((d) => d.weekday !== 6));

    // A numbering scheme by its document's name; only the prefix changes, the rest of the scheme kept.
    const scheme = (await h.as("ops").get("/settings/numbering")).body.data.find((s) => s.doc_type === "task");
    const numbering = (await drawn("ops", "numbering.edit", { doc_type: "task", prefix: "tk" })).card;
    expect(numbering).toMatchObject({ action_key: "numbering.edit", label: "Save Numbering", problems: {} });
    expect((await h.press("ops", numbering.ai_action_draft_id)).status).toBe(200);
    expect((await h.as("ops").get("/settings/numbering")).body.data.find((s) => s.doc_type === "task")).toMatchObject({ prefix: "TK", padding: scheme.padding, reset: scheme.reset });
  });

  test("Notifications: a person's own notices.preference, notices.quiet_hours and notices.digest; the company's notice_rules.edit and notice_reminders.edit for Settings alone", async () => {
    expect(await offered("staff")).toEqual(expect.arrayContaining(["notices.preference", "notices.quiet_hours", "notices.digest"]));
    expect(await offered("staff")).not.toEqual(expect.arrayContaining(["notice_rules.edit"]));

    const kinds = (await h.as("staff").get("/notifications/preferences")).body.categories;
    const kind = kinds.find((k) => !k.locked);
    const pref = (await drawn("staff", "notices.preference", { category: kind.label, channel: "email", enabled: false })).card;
    expect(pref).toMatchObject({ action_key: "notices.preference", problems: {}, values: { category: kind.category, channel: "email", enabled: false } });
    expect((await h.press("staff", pref.ai_action_draft_id)).status).toBe(200);
    expect((await h.as("staff").get("/notifications/preferences")).body.categories.find((k) => k.category === kind.category).channels.email).toBe(false);

    const quiet = (await drawn("staff", "notices.quiet_hours", { quiet_enabled: true })).card;
    expect(quiet).toMatchObject({ action_key: "notices.quiet_hours", label: "Save Quiet Hours", problems: {} });
    expect((await h.press("staff", quiet.ai_action_draft_id)).status).toBe(200);
    expect((await h.as("staff").get("/notifications/preferences")).body.settings.quiet_enabled).toBe(true);

    const digest = await drawn("staff", "notices.digest", {});
    expect(digest).toMatchObject({ content: "Turn your daily digest on or off?", card: null, choices: ["On", "Off"] });
    const on = (await drawn("staff", "notices.digest", { digest: false })).card;
    expect((await h.press("staff", on.ai_action_draft_id)).status).toBe(200);

    // The company's rule for one notice, by its name; only email changes, the rest kept as it stands.
    // A notice of a kind nobody locks (the first page in category order is security's, which stay on).
    const listed = await h.as("ops").get(`/notifications/rules?category=${kind.category}`);
    expect(listed.status).toBe(200);
    const rule = listed.body.data.find((r) => !r.locked);
    const change = (await drawn("ops", "notice_rules.edit", { event_key: rule.name, email: !rule.channels.email })).card;
    expect(change).toMatchObject({ action_key: "notice_rules.edit", label: "Save Notice Rule", problems: {}, values: { event_key: rule.event_key, email: !rule.channels.email } });
    expect(change.records).toEqual([expect.objectContaining({ type: "notification_rule", id: rule.event_key, label: rule.name })]);
    expect((await h.press("ops", change.ai_action_draft_id)).status).toBe(200);
    const saved = (await h.as("ops").get(`/notifications/rules?category=${kind.category}`)).body.data.find((r) => r.event_key === rule.event_key);
    expect(saved).toMatchObject({ enabled: rule.enabled, channels: { ...rule.channels, email: !rule.channels.email } });

    const reminders = (await drawn("ops", "notice_reminders.edit", { digest_at_time: "07:30" })).card;
    expect(reminders).toMatchObject({ action_key: "notice_reminders.edit", label: "Save Reminders", problems: {} });
    expect((await h.press("ops", reminders.ai_action_draft_id)).status).toBe(200);
    expect((await h.as("ops").get("/notifications/reminders")).body.digest.at_time).toBe("07:30");
  });

  test("System Health: health_targets.edit keeps every level it does not name; faults.edit and faults.note name the fault by its title, for System Health's holders alone", async () => {
    expect(await offered("ops")).not.toEqual(expect.arrayContaining(["faults.edit"]));
    expect(await offered("impl")).toEqual(expect.arrayContaining(["health_targets.edit", "faults.edit", "faults.note"]));
    const before = (await h.as("impl").get("/system-health/targets")).body;
    const targets = (await drawn("impl", "health_targets.edit", { cpu_warn_pct: 80 })).card;
    expect(targets).toMatchObject({ action_key: "health_targets.edit", label: "Save Targets", problems: {} });
    expect((await h.press("impl", targets.ai_action_draft_id)).status).toBe(200);
    expect((await h.as("impl").get("/system-health/targets")).body).toMatchObject({ cpu_warn_pct: 80, memory_warn_pct: before.memory_warn_pct, availability_pct: before.availability_pct });

    const { error_group_id: fault } = await one(
      "INSERT INTO error_group (fingerprint, title, name, first_seen_at, last_seen_at) VALUES ('fp-ai-test', 'Payslip export timed out', 'TimeoutError', now(), now()) RETURNING error_group_id",
    );
    const which = await drawn("impl", "faults.edit", { status: "handling" });
    expect(which).toMatchObject({ content: "Which fault is it?", card: null });
    expect(which.choices).toContain("Payslip export timed out");
    const move = (await drawn("impl", "faults.edit", { error_group_id: "payslip export", status: "handling", note: "Looking at the export queue" })).card;
    expect(move).toMatchObject({ action_key: "faults.edit", label: "Save Fault", problems: {}, values: expect.objectContaining({ error_group_id: fault }) });
    expect(move.records).toEqual([expect.objectContaining({ id: fault, label: "Payslip export timed out" })]);
    expect((await h.press("impl", move.ai_action_draft_id)).status).toBe(200);
    expect(await one("SELECT status FROM error_group WHERE error_group_id = $1", [fault])).toEqual({ status: "handling" });
    const note = (await drawn("impl", "faults.note", { error_group_id: fault, body: "Raised the job's time limit" })).card;
    expect((await h.press("impl", note.ai_action_draft_id)).status).toBe(200);
    expect((await q("SELECT body FROM error_group_note WHERE error_group_id = $1 ORDER BY created_at", [fault])).rows.map((r) => r.body)).toEqual(["Looking at the export queue", "Raised the job's time limit"]);
  });

  test("Home: alert_rules.create and alert_rules.edit for a holder of alerts.manage; reports.create, reports.edit and reports.schedule for home.reports; staff are offered none of them", async () => {
    const staff = await offered("staff");
    for (const key of ["alert_rules.create", "alert_rules.edit", "reports.create", "reports.schedule"]) expect([key, staff.includes(key)]).toEqual([key, false]);

    // A rule with "who clears" left to its metric's own.
    const rule = (await drawn("ops", "alert_rules.create", { name: "Approvals waiting too long", metric: "approval_ageing", threshold: "5", severity: "high", permission_key: "Its Own Default" })).card;
    expect(rule).toMatchObject({ action_key: "alert_rules.create", label: "Create Alert Rule", problems: {}, values: expect.objectContaining({ permission_key: c.alerts.HOME_ALERT_METRICS.approval_ageing.permission_key }) });
    const made = await h.press("ops", rule.ai_action_draft_id);
    expect(made.status).toBe(200);
    const off = (await drawn("ops", "alert_rules.edit", { home_alert_rule_id: "Approvals waiting too long", enabled: false })).card;
    expect(off).toMatchObject({ action_key: "alert_rules.edit", problems: {}, values: { home_alert_rule_id: made.body.lines[0].id, enabled: false } });
    expect((await h.press("ops", off.ai_action_draft_id)).status).toBe(200);
    expect(await one("SELECT enabled FROM home_alert_rule WHERE home_alert_rule_id = $1", [made.body.lines[0].id])).toEqual({ enabled: false });

    // A report built, renamed by its name, then scheduled weekly for its builder ("just me").
    const build = (await drawn("ops", "reports.create", { name: "Monday Headcount", report_key: "headcount", shared: false })).card;
    expect(build).toMatchObject({ action_key: "reports.create", label: "Create Report", problems: {} });
    const built = await h.press("ops", build.ai_action_draft_id);
    expect(built.status).toBe(200);
    const id = built.body.lines[0].id;
    const rename = (await drawn("ops", "reports.edit", { saved_report_id: "Monday Headcount", name: "Weekly Headcount" })).card;
    expect(rename).toMatchObject({ action_key: "reports.edit", problems: {}, values: { saved_report_id: id, name: "Weekly Headcount" } });
    expect((await h.press("ops", rename.ai_action_draft_id)).status).toBe(200);
    const schedule = (await drawn("ops", "reports.schedule", { saved_report_id: "Weekly Headcount", freq: "weekly", by_weekday: [1], run_time: "08:00", formats: ["pdf"], recipient_user_ids: ["Just Me"] })).card;
    expect(schedule).toMatchObject({ action_key: "reports.schedule", label: "Schedule Report", problems: {}, values: expect.objectContaining({ saved_report_id: id, recipient_user_ids: [h.people.ops.user_id] }) });
    expect(schedule.names).toEqual([expect.objectContaining({ id: h.people.ops.user_id, label: "Ada Obi" })]);
    expect((await h.press("ops", schedule.ai_action_draft_id)).status).toBe(200);
    const report = (await h.as("ops").get(`/home/reports/${id}`)).body;
    expect(report).toMatchObject({ name: "Weekly Headcount", status: "scheduled" });
    expect(report.schedule).toMatchObject({ formats: ["pdf"], recurrence: expect.objectContaining({ freq: "weekly", by_weekday: [1] }), audience: [expect.objectContaining({ user_id: h.people.ops.user_id })] });
  });
});
