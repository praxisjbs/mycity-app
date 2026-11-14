"use strict";
/**
 * Charts in the Overview, PR 8 on the real migrations (docs/guides/praxis-ai.md §6.13 Workspace,
 * Knowledge Hub, Community, Home and Settings, §6.19 item 9): `projects.summary`, `calendar.summary`,
 * `training.summary`, `policies.summary`, `sops.summary`, `announcements.summary`, `activity.summary`,
 * `alerts.summary`, `runs.summary` and `imports.summary` answer with figures and never a row; a
 * project's tasks are only those the reader could open on Tasks; the calendar is the person's own month;
 * Training gives a manager every place and anyone else their own; Policies, Alerts and report files give
 * a reader without the list's capability no figures; an SOP writer counts their drafts and archived ones;
 * announcement read rates are the poster's; Activity follows the reader's scope; a part only some rows
 * have is drawn only where one does; every read names its summary, and Try Asking offers a chart.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-summaries-close
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema.
 * Every person here is invented.
 */
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
const grantsCache = require("../../src/shared/rbac/grants-cache");
const authorise = require("../../src/shared/ai/authorise");
const registry = require("../../src/shared/ai/registry");
const engine = require("../../src/services/ai/engine");
const lagos = require("../../src/shared/time/lagos");
const assistant = require("../../src/modules/assistant/assistant.service");
const { q, one, drain, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const SUMMARIES = [
  "projects.summary",
  "calendar.summary",
  "training.summary",
  "policies.summary",
  "sops.summary",
  "announcements.summary",
  "activity.summary",
  "alerts.summary",
  "runs.summary",
  "imports.summary",
];

describeDb("Workspace, Knowledge Hub, Community, Home and Settings summaries against the real migrations", () => {
  let h;
  const dept = {};
  const id = {};
  const today = lagos.today();
  const year = Number(today.slice(0, 4));
  /** A month of next year for the calendar, so today's own tasks and leave never fall in it. */
  const march = `${year + 1}-03`;
  /** A day long past for Activity Today, so the people this suite makes never count on it. */
  const day = `${year - 1}-06-15`;
  const at = (date, time) => lagos.instant(date, time).toISOString();

  const userOf = (who) => grantsCache.getAuthUser(pool, h.people[who].user_id);
  const summaryOf = async (who, key, params = {}) => (await authorise.runSummary(pool, await userOf(who), key, params)).result;
  const figuresOf = (result) => Object.fromEntries(result.figures.map((x) => [x.key, x.value]));
  const groupOf = (result, by) => result.groups.find((g) => g.by === by);
  const partsOf = (row) => row.parts.map((p) => [p.label, p.value]);

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    const { app: server } = buildApp({ strict: true, accessLog: false });
    h = harness(server);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "head", first: "Kemi", last: "Alade", email: "head@mycity.test", job: "Head of Programmes", role: "head_of_department", password: "Programme#Lead2026", department: "Programmes" },
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Field Officer", role: "employee", password: "Field#Officer2026", department: "Programmes" },
    ]);
    const p = h.people;
    dept.programmes = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [p.head.employee_id])).department_id;
    dept.operations = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [p.ops.employee_id])).department_id;
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [p.head.employee_id, p.staff.employee_id]);
    await q("UPDATE department SET head_employee_id = $1 WHERE department_id = $2", [p.head.employee_id, dept.programmes]);
    await q("UPDATE employee SET start_date = $1", [`${year - 1}-01-04`]);
    await grantsCache.bumpTeamVersion();

    // Projects: an active one with the staff member's tasks done, open and overdue and Ada's own open one;
    // a completed one; an active one past its due day with no task.
    const project = async (number, name, status, dueOn = null) =>
      (await one("INSERT INTO project (number, name, owner_employee_id, status, due_on, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING project_id", [
        number,
        name,
        p.ops.employee_id,
        status,
        dueOn,
        p.ops.user_id,
      ])).project_id;
    id.walk = await project("PRJ-0901", "Ikeja Walk", "active");
    await project("PRJ-0902", "Old Fair", "completed");
    await project("PRJ-0903", "Late Launch", "active", lagos.addDays(today, -3));
    const task = (title, who, status, dueAt) =>
      q("INSERT INTO task (title, created_by, set_by_employee_id, primary_assignee_id, status, due_at, project_id, completed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $5 = 'done' THEN now() END)", [
        title,
        p.ops.user_id,
        p[who].employee_id,
        p[who].employee_id,
        status,
        dueAt,
        id.walk,
      ]);
    await task("Map the route", "staff", "done", null);
    await task("Print the flyers", "staff", "todo", new Date(Date.now() + 2 * 86_400_000).toISOString());
    await task("Book the hall", "staff", "in_progress", new Date(Date.now() - 2 * 86_400_000).toISOString());
    await task("Call the sponsors", "ops", "todo", null);

    // The staff member's March next year: a meeting of their own, Ada's invitation still to answer, a declined
    // one, a campaign for everyone, a task due and two days of leave.
    const event = async (title, type, owner, date, from, to, extra = {}) =>
      (await one(
        `INSERT INTO calendar_event (title, event_type, owner_employee_id, starts_at, ends_at, all_day, visibility, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING calendar_event_id`,
        [title, type, p[owner].employee_id, at(date, from), at(date, to), extra.allDay === true, extra.visibility || "attendees", p[owner].user_id],
      )).calendar_event_id;
    await event("Route planning", "meeting", "staff", `${march}-10`, "10:00", "11:30");
    const invited = await event("Sponsor call", "meeting", "ops", `${march}-11`, "14:00", "15:00");
    const declined = await event("Budget review", "meeting", "ops", `${march}-25`, "09:00", "10:00");
    await q("INSERT INTO calendar_event_attendee (calendar_event_id, employee_id, response) VALUES ($1, $3, 'pending'), ($2, $3, 'declined')", [invited, declined, p.staff.employee_id]);
    await event("Walk Week", "campaign", "ops", `${march}-12`, "00:00", "23:59", { visibility: "everyone" });
    await q("INSERT INTO task (title, created_by, primary_assignee_id, status, due_at) VALUES ('Send the March report', $1, $2, 'todo', $3)", [p.ops.user_id, p.staff.employee_id, at(`${march}-20`, "17:00")]);
    const annual = (await one("SELECT leave_type_id FROM leave_type WHERE code = 'annual'")).leave_type_id;
    await q("INSERT INTO leave_request (employee_id, leave_type_id, starts_on, ends_on, amount, status) VALUES ($1, $2, $3, $4, 2, 'approved')", [
      p.staff.employee_id,
      annual,
      `${march}-23`,
      `${march}-24`,
    ]);

    // Training: two published courses (one in the Library); the staff member's completed with a certificate
    // and overdue, Ada's in progress, the head's not started.
    const signature = (await one(
      `INSERT INTO document (doc_type, original_name, storage_key, mime, bytes, entity_type, entity_id, sensitivity, scan_status, source)
       VALUES ('training_signature', 'signature.png', 'vault/2026/11/summaries-signature.png', 'image/png', 10, 'training_course', 'x', 'normal', 'skipped', 'upload')
       RETURNING document_id`,
    )).document_id;
    const course = async (number, title, library) =>
      (await one(
        `INSERT INTO training_course (number, title, status, library, published_at, published_by, signer_name, signature_document_id)
         VALUES ($1, $2, 'published', $3, now(), $4, 'Ada Obi', $5) RETURNING training_course_id`,
        [number, title, library, p.ops.user_id, signature],
      )).training_course_id;
    const safety = await course("TRN-0901", "Field Safety", false);
    const intro = await course("TRN-0902", "Welcome to MyCity", true);
    const place = (courseId, who, extra) =>
      q(
        `INSERT INTO training_enrolment (training_course_id, employee_id, due_on, started_at, completed_at, certificate_number, certificate_hash,
                                         certificate_holder_name, certificate_course_title)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [courseId, p[who].employee_id, extra.due || null, extra.started || null, extra.completed || null, extra.cert || null, extra.cert ? "hash" : null, extra.cert ? "Musa Danjuma" : null, extra.cert ? "Field Safety" : null],
      );
    await place(safety, "staff", { started: new Date().toISOString(), completed: new Date().toISOString(), cert: "CERT-2026-0901" });
    await place(intro, "staff", { due: lagos.addDays(today, -2) });
    await place(safety, "ops", { started: new Date().toISOString() });
    await place(safety, "head", { due: lagos.addDays(today, 30) });

    // Policies: one in force for 10 days that the staff member acknowledged (the rest overdue), one from
    // yesterday nobody has acknowledged yet, one a draft.
    const policy = async (number, title) => (await one("INSERT INTO policy (number, kind, title) VALUES ($1, 'document', $2) RETURNING policy_id", [number, title])).policy_id;
    const published = async (policyId, title, daysAgo) =>
      (await one(
        `INSERT INTO policy_version (policy_id, status, title, version, effective_from, note, content_hash, published_at, body_markdown,
                                     applies_to_everyone, needs_acknowledgement, acknowledge_within_days)
         VALUES ($1, 'published', $2, 1, $3, 'First version', 'hash', now() - make_interval(days => $4), 'The text.', true, true, 7)
         RETURNING policy_version_id`,
        [policyId, title, lagos.addDays(today, -daysAgo), daysAgo],
      )).policy_version_id;
    const dress = await published(await policy("POL-0901", "Dress Code"), "Dress Code", 10);
    await published(await policy("POL-0902", "Remote Work"), "Remote Work", 1);
    await q("INSERT INTO policy_version (policy_id, status, title) VALUES ($1, 'draft', 'Travel')", [await policy("POL-0903", "Travel")]);
    await q("INSERT INTO policy_acknowledgement (policy_version_id, employee_id, acknowledged_at, content_hash) VALUES ($1, $2, now(), 'hash')", [dress, p.staff.employee_id]);

    // SOPs: Programmes' published one being changed and a draft never published; Operations' published one
    // and an archived one.
    const sop = async (number, deptId, title, { published: v = false, draft = false, archived = false } = {}) => {
      const s = (await one("INSERT INTO sop (number, department_id, title, status, archived_at) VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'archived' THEN now() END) RETURNING sop_id", [number, deptId, title, archived ? "archived" : "active"])).sop_id;
      if (v)
        await q("INSERT INTO sop_version (sop_id, status, version, title, purpose, content_hash, published_at) VALUES ($1, 'published', 1, $2, 'Why it is done.', 'hash', now() - interval '10 days')", [s, title]);
      if (draft) await q("INSERT INTO sop_version (sop_id, status, title) VALUES ($1, 'draft', $2)", [s, title]);
    };
    await sop("SOP-0901", dept.programmes, "Running a Walk", { published: true, draft: true });
    await sop("SOP-0902", dept.programmes, "Booking a Hall", { draft: true });
    await sop("SOP-0903", dept.operations, "Opening the Office", { published: true });
    await sop("SOP-0904", dept.operations, "Old Filing", { published: true, archived: true });

    // Announcements: a normal one read by two of four, an urgent one acknowledged by Ada alone, one scheduled.
    const users = ["ceo", "ops", "head", "staff"].map((w) => p[w].user_id);
    const announcement = async (title, urgency, daysAgo) => {
      const a = (await one(
        `INSERT INTO announcement (title, body, audience, status, urgency, published_by, published_at, audience_size)
         VALUES ($1, 'The message.', '{"kind":"all","department_ids":[]}', 'published', $2, $3, now() - make_interval(days => $4), 4) RETURNING announcement_id`,
        [title, urgency, p.ops.user_id, daysAgo],
      )).announcement_id;
      for (const u of users) await q("INSERT INTO announcement_read (announcement_id, user_id) VALUES ($1, $2)", [a, u]);
      return a;
    };
    const walk = await announcement("Walk on Saturday", "normal", 3);
    const office = await announcement("Office Closed", "urgent", 1);
    await q("UPDATE announcement_read SET read_at = now() WHERE announcement_id = $1 AND user_id IN ($2, $3)", [walk, p.staff.user_id, p.head.user_id]);
    await q("UPDATE announcement_read SET read_at = now(), acknowledged_at = now() WHERE announcement_id = $1 AND user_id = $2", [office, p.ops.user_id]);
    await q("UPDATE announcement_read SET read_at = now() WHERE announcement_id = $1 AND user_id = $2", [office, p.staff.user_id]);
    await q(
      `INSERT INTO announcement (title, body, audience, status, urgency, published_by, publish_at)
       VALUES ('Year End', 'Later.', '{"kind":"all","department_ids":[]}', 'scheduled', 'important', $1, now() + interval '3 days')`,
      [p.ops.user_id],
    );

    // Activity on a day long past: the staff member's arrival and leave approved (about them), their
    // recognition of Ada (in #general), and Ada's leave approved by the CEO.
    const happened = (key, module, actor, subject, time) =>
      q(
        `INSERT INTO event_log (event_key, module_key, entity_type, entity_id, actor_user_id, payload, occurred_at)
         VALUES ($1, $2, 'employee', $3, $4, jsonb_build_object('subject_employee_id', $3::text), $5)`,
        [key, module, p[subject].employee_id, p[actor].user_id, at(day, time)],
      );
    await happened("employee.created", "people", "ops", "staff", "09:10");
    await happened("leave_request.approved", "people", "head", "staff", "11:20");
    await happened("recognition.posted", "community", "staff", "ops", "11:45");
    await happened("leave_request.approved", "people", "ceo", "ops", "15:05");

    // Alerts on a People rule: three open about the staff member and Ada (one over a week old), one cleared today.
    const rule = (await one(
      `INSERT INTO home_alert_rule (key, name, metric, threshold, severity, permission_key)
       VALUES ('confirmation_due.summaries', 'Confirmation Due', 'confirmation_due', 30, 'medium', 'people.view') RETURNING home_alert_rule_id`,
    )).home_alert_rule_id;
    const alert = (subject, who, severity, daysAgo, cleared = false) =>
      q(
        `INSERT INTO home_alert (home_alert_rule_id, subject_type, subject_id, subject_employee_id, title, severity, raised_at, cleared_at, outcome)
         VALUES ($1, 'employee', $2, $3, 'Confirmation due', $4, now() - make_interval(days => $5), CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN 'cleared' END)`,
        [rule, subject, p[who].employee_id, severity, daysAgo, cleared],
      );
    await alert(`${p.staff.employee_id}:a`, "staff", "high", 10);
    await alert(`${p.staff.employee_id}:b`, "staff", "medium", 0);
    await alert(p.ops.employee_id, "ops", "low", 2);
    await alert(`${p.staff.employee_id}:c`, "staff", "high", 1, true);

    // Report files the head received: two done (one emailed) and a failed one of one report, one waiting of another.
    const report = async (name) =>
      (await one("INSERT INTO saved_report (owner_user_id, name, report_key, definition) VALUES ($1, $2, 'leave_requests', '{}') RETURNING saved_report_id", [p.head.user_id, name])).saved_report_id;
    const weekly = await report("Weekly Leave");
    const monthly = await report("Monthly Leave");
    const file = (number, reportId, format, status, emailed = false) =>
      q("INSERT INTO home_report_run (number, saved_report_id, recipient_user_id, format, status, emailed_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END)", [
        number,
        reportId,
        p.head.user_id,
        format,
        status,
        emailed,
      ]);
    await file("RPT-0901", weekly, "pdf", "done", true);
    await file("RPT-0902", weekly, "xlsx", "done");
    await file("RPT-0903", weekly, "pdf", "failed");
    await file("RPT-0904", monthly, "pdf", "pending");

    // Imports: two committed staff sheets (seven and three rows in, one and two refused), a failed one, one uploaded.
    const sheet = (await one(
      `INSERT INTO document (doc_type, original_name, storage_key, mime, bytes, entity_type, entity_id, sensitivity, scan_status, source)
       VALUES ('import_sheet', 'staff.xlsx', 'imports/2026/11/summaries.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 10, 'import_batch', 'x', 'normal', 'skipped', 'upload')
       RETURNING document_id`,
    )).document_id;
    const batch = (number, status, stats) =>
      q("INSERT INTO import_batch (number, importer_key, document_id, file_name, status, stats) VALUES ($1, 'staff', $2, 'staff.xlsx', $3, $4)", [number, sheet, status, JSON.stringify(stats)]);
    await batch("IMP-0901", "committed", { rows: 8, create: 5, update: 2, error: 1, duplicate: 0 });
    await batch("IMP-0902", "committed", { rows: 5, create: 3, update: 0, error: 0, duplicate: 2 });
    await batch("IMP-0903", "failed", {});
    await batch("IMP-0904", "uploaded", {});
    await drain();
  }, 180_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("each summary answers the CEO with figures and never a row", async () => {
    for (const key of SUMMARIES) {
      const res = await authorise.runSummary(pool, await userOf("ceo"), key, {});
      expect([key, c.assistant.AiSummaryResult.safeParse(res.result).success]).toEqual([key, true]);
      expect([key, "data" in res, "rows" in res.result]).toEqual([key, false, false]);
    }
  });

  test("projects.summary: every project, its tasks stacked Done, Open and Overdue, only those the reader could open", async () => {
    const all = await summaryOf("ceo", "projects.summary");
    expect(figuresOf(all)).toMatchObject({ projects: 3, active: 2, completed: 1, past_due: 1, tasks: 4, open: 3, done: 1, overdue: 1 });
    const walk = groupOf(all, "project").rows;
    expect(walk.map((r) => r.label)).toEqual(["PRJ-0901 Ikeja Walk"]);
    expect(partsOf(walk[0])).toEqual([["Done", 1], ["Open", 2], ["Overdue", 1]]);
    expect(groupOf(all, "status").rows.map((r) => [r.label, r.value])).toEqual([["Active", 2], ["Completed", 1]]);
    // The parts reach the pane as a stacked bar, one series a part.
    const o = engine.pane.overviewOf(
      { summary: "projects.summary", figures: ["projects", "open", "overdue"], chart: { kind: "stacked_bar", title: "Tasks by project", group: "project" } },
      [{ n: 1, key: "projects.summary", kind: "summary", ok: true, result: all }],
    );
    expect(() => c.assistant.AiOverview.parse(o)).not.toThrow();
    expect(o.chart.series.map((s) => s.label)).toEqual(["Done", "Open", "Overdue"]);
    // The staff member sees every project, but only their own three tasks.
    expect(figuresOf(await summaryOf("staff", "projects.summary"))).toMatchObject({ projects: 3, tasks: 3, open: 2, overdue: 1 });
    expect((await summaryOf("ceo", "projects.summary", { status: "active", by: "status" })).groups[0]).toMatchObject({ by: "status", rows: [{ key: "active", value: 2 }] });
  });

  test("calendar.summary: the person's own month by kind and by week, meetings' hours without the declined one", async () => {
    const mine = await summaryOf("staff", "calendar.summary", { month: march });
    expect(figuresOf(mine)).toEqual({ items: 6, meetings: 2, invitations: 1, task_deadlines: 1, leave_days: 2, performance: 0, meeting_hours: 2.5 });
    expect(groupOf(mine, "kind").rows.map((r) => [r.label, r.value])).toEqual([["Meeting", 3], ["Event", 1], ["Deadline", 1], ["Leave", 1]]);
    const weeks = groupOf(mine, "week").rows;
    expect(weeks.reduce((n, r) => n + r.value, 0)).toBe(6);
    expect(weeks[0].label).toMatch(/^Week of \d\d\/\d\d$/);
    // A kind no week has is left out of the legend.
    expect(weeks[0].parts.map((x) => x.label)).toEqual(["Meeting", "Event", "Deadline", "Leave"]);
    expect((await summaryOf("staff", "calendar.summary", { month: march, by: "week" })).groups[0].by).toBe("week");
    // The head's month holds none of it: their own calendar, whatever their grant.
    expect((await summaryOf("head", "calendar.summary", { month: march })).total).toBe(1);
  });

  test("training.summary: every place for a manager, stacked by where each stands; anyone else their own", async () => {
    const all = await summaryOf("ops", "training.summary");
    expect(figuresOf(all)).toMatchObject({ courses: 2, library: 1, people: 3, places: 4, completed: 1, in_progress: 1, overdue: 1, not_started: 1, certificates: 1, completion_rate: 25 });
    const safety = groupOf(all, "course").rows.find((r) => r.label === "TRN-0901 Field Safety");
    expect(partsOf(safety)).toEqual([["Completed", 1], ["In Progress", 1], ["Overdue", 0], ["Not Started", 1]]);
    expect(partsOf(groupOf(await summaryOf("ops", "training.summary", { by: "department" }), "department").rows.find((r) => r.key === dept.programmes))).toEqual([
      ["Completed", 1],
      ["In Progress", 0],
      ["Overdue", 1],
      ["Not Started", 1],
    ]);
    expect(all.series[0].label).toBe("Completions by month");
    expect(figuresOf(await summaryOf("staff", "training.summary"))).toMatchObject({ places: 2, completed: 1, overdue: 1 });
    expect(figuresOf(await summaryOf("head", "training.summary"))).toMatchObject({ places: 1, not_started: 1 });
  });

  test("policies.summary: the states and who has acknowledged, by policy and department, for policies.manage alone", async () => {
    const all = await summaryOf("ops", "policies.summary", { kind: "document" });
    expect(figuresOf(all)).toMatchObject({ policies: 3, in_force: 2, draft: 1, asked: 8, acknowledged: 1, ack_waiting: 4, ack_overdue: 3, acknowledged_rate: 12.5 });
    const rows = groupOf(all, "policy").rows;
    expect(partsOf(rows.find((r) => r.label === "POL-0901 Dress Code"))).toEqual([["Acknowledged", 1], ["Waiting", 0], ["Overdue", 3]]);
    expect(partsOf(rows.find((r) => r.label === "POL-0902 Remote Work"))).toEqual([["Acknowledged", 0], ["Waiting", 4], ["Overdue", 0]]);
    const byDept = groupOf(await summaryOf("ops", "policies.summary", { kind: "document", by: "department" }), "department").rows;
    expect(partsOf(byDept.find((r) => r.key === dept.programmes))).toEqual([["Acknowledged", 1], ["Waiting", 2], ["Overdue", 1]]);
    expect(groupOf(all, "state").rows.map((r) => [r.label, r.value])).toEqual([["In Force", 2], ["Draft", 1]]);
    // Anyone without policies.manage gets no figures, as policies.list gives them an empty page.
    expect(await summaryOf("staff", "policies.summary")).toEqual({ figures: [], groups: [], series: [], total: 0 });
  });

  test("sops.summary: every published SOP for everyone, a writer's drafts and archived ones beside them", async () => {
    expect(figuresOf(await summaryOf("staff", "sops.summary"))).toMatchObject({ sops: 2, published: 2, changing: 0, draft: 0, archived: 0, recent: 2 });
    expect(figuresOf(await summaryOf("head", "sops.summary"))).toMatchObject({ sops: 3, published: 2, changing: 1, draft: 1, archived: 0 });
    const all = await summaryOf("ops", "sops.summary");
    expect(figuresOf(all)).toMatchObject({ sops: 4, published: 2, changing: 1, draft: 1, archived: 1 });
    expect(partsOf(groupOf(all, "department").rows.find((r) => r.key === dept.programmes))).toEqual([["Published", 1], ["Draft", 1], ["Archived", 0]]);
    expect(groupOf(all, "state").rows.map((r) => [r.label, r.value])).toEqual([["Published", 2], ["Draft", 1], ["Archived", 1]]);
    // Without a writer's archived row, the department grouping names no Archived part.
    expect(partsOf(groupOf(await summaryOf("head", "sops.summary"), "department").rows[0]).map(([l]) => l)).toEqual(["Published", "Draft"]);
  });

  test("announcements.summary: read rates for the poster; anyone else only what they received and read", async () => {
    const poster = await summaryOf("ops", "announcements.summary");
    expect(figuresOf(poster)).toMatchObject({ published: 2, scheduled: 1, urgent: 1, reached: 8, average_read: 37.5 });
    expect(groupOf(poster, "announcement").rows.map((r) => [r.label, partsOf(r)])).toEqual([
      ["Office Closed", [["Read", 1], ["Not Read", 3]]],
      ["Walk on Saturday", [["Read", 2], ["Not Read", 2]]],
    ]);
    const mine = await summaryOf("staff", "announcements.summary");
    // Opened but not acknowledged: an urgent one is not yet read.
    expect(figuresOf(mine)).toEqual({ received: 2, read: 1, not_read: 1, urgent_waiting: 1 });
    expect(mine.figures.map((x) => x.key)).not.toContain("average_read");
    expect(groupOf(mine, "urgency").rows.map((r) => [r.label, r.value])).toEqual([["Normal", 1], ["Urgent", 1]]);
  });

  test("activity.summary: a day's events by kind within the reader's reach; by who acted, by hour; one person's", async () => {
    const all = await summaryOf("ops", "activity.summary", { date: day });
    expect(figuresOf(all)).toEqual({ events: 4, actors: 4, subjects: 2, kinds: 3 });
    expect(groupOf(all, "kind").rows.map((r) => [r.label, r.value])).toEqual([["Leave Approved", 2], ["New Employee", 1], ["Recognition", 1]]);
    expect(all.series[0]).toMatchObject({ key: "hour", label: "Events by hour" });
    expect(all.series[0].points.map((x) => x.at)).toEqual(["09:00", "11:00", "15:00"]);
    expect(groupOf(await summaryOf("ops", "activity.summary", { date: day, by: "module" }), "module").rows.map((r) => r.value)).toEqual([3, 1]);
    expect(groupOf(await summaryOf("ops", "activity.summary", { date: day, by: "person" }), "person").rows).toHaveLength(4);
    // The head reaches their team and #general, never the CEO's approval for Ada; the staff member #general alone.
    expect((await summaryOf("head", "activity.summary", { date: day })).total).toBe(3);
    expect((await summaryOf("staff", "activity.summary", { date: day })).total).toBe(1);
    expect((await summaryOf("ops", "activity.summary", { date: day, employee_id: h.people.staff.employee_id })).total).toBe(3);
    // A period: by day.
    const year_ = await summaryOf("ops", "activity.summary", { from: lagos.addDays(day, -10), to: lagos.addDays(day, 10) });
    expect(year_.series[0]).toMatchObject({ key: "day", points: [{ at: day, value: 4 }] });
  });

  test("alerts.summary: the alerts the reader may clear, by category stacked by severity, by rule and by age", async () => {
    const all = await summaryOf("ceo", "alerts.summary");
    expect(figuresOf(all)).toMatchObject({ open: 3, overdue: 1, high: 1, cleared_week: 1, dismissed_week: 0, oldest_days: 10 });
    expect(partsOf(groupOf(all, "category").rows[0])).toEqual([["High", 1], ["Medium", 1], ["Low", 1]]);
    expect(groupOf(all, "category").rows[0].label).toBe("People");
    expect(groupOf(await summaryOf("ceo", "alerts.summary", { by: "rule" }), "rule").rows).toEqual([{ key: expect.any(String), label: "Confirmation Due", value: 3, count: null }]);
    expect(groupOf(await summaryOf("ceo", "alerts.summary", { by: "age" }), "age").rows.map((r) => [r.label, r.value])).toEqual([
      ["Under a Day", 1],
      ["1 to 3 Days", 1],
      ["7 Days or More", 1],
    ]);
    expect((await summaryOf("ceo", "alerts.summary", { state: "cleared" })).total).toBe(1);
    // Nobody but the CEO sees an alert about themselves: Ada sees the staff member's two open ones, never her own.
    expect((await summaryOf("ops", "alerts.summary")).total).toBe(2);
    // The head clears their team's alerts, never Ada's; the staff member clears none.
    expect((await summaryOf("head", "alerts.summary")).total).toBe(2);
    expect(await summaryOf("staff", "alerts.summary")).toEqual({ figures: [], groups: [], series: [], total: 0 });
  });

  test("runs.summary: the files the person received, by status, by report stacked, by format", async () => {
    const mine = await summaryOf("head", "runs.summary");
    expect(figuresOf(mine)).toEqual({ files: 4, done: 2, pending: 1, failed: 1, skipped: 0, emailed: 1 });
    expect(groupOf(mine, "status").rows.map((r) => [r.label, r.value])).toEqual([["Done", 2], ["Waiting", 1], ["Failed", 1]]);
    const weekly = groupOf(mine, "report").rows.find((r) => r.label === "Weekly Leave");
    // Skipped is no part: no report has one.
    expect(partsOf(weekly)).toEqual([["Done", 2], ["Waiting", 0], ["Failed", 1]]);
    expect(groupOf(mine, "format").rows.map((r) => [r.label, r.value])).toEqual([["PDF", 3], ["Excel", 1]]);
    expect((await summaryOf("head", "runs.summary", { by: "report" })).groups[0].by).toBe("report");
    // Ada received none; the staff member holds no home.reports.
    expect((await summaryOf("ops", "runs.summary")).total).toBe(0);
    expect(await summaryOf("staff", "runs.summary")).toEqual({ figures: [], groups: [], series: [], total: 0 });
  });

  test("imports.summary: every import, by importer stacked by rows imported and refused; settings view alone", async () => {
    const all = await summaryOf("ops", "imports.summary");
    expect(figuresOf(all)).toEqual({ imports: 4, committed: 2, reverted: 0, failed: 1, in_progress: 1, imported: 10, refused: 3, created: 8, updated: 2 });
    const staff = groupOf(all, "importer").rows[0];
    expect([staff.value, staff.count, partsOf(staff)]).toEqual([13, 4, [["Imported", 10], ["Refused", 3]]]);
    expect(groupOf(all, "status").rows.map((r) => [r.label, r.value])).toEqual([["Committed", 2], ["Failed", 1], ["Uploaded", 1]]);
    await expect(summaryOf("staff", "imports.summary")).rejects.toMatchObject({ code: "AI_READ_FORBIDDEN" });
  });

  test("a period narrows a summary only when asked: a month long past counts nothing", async () => {
    for (const key of ["training.summary", "announcements.summary", "imports.summary"])
      expect([key, (await summaryOf("ops", key, { month: `${year - 3}-01` })).total]).toEqual([key, 0]);
    expect((await summaryOf("head", "runs.summary", { month: `${year - 3}-01` })).total).toBe(0);
  });

  test("a member of staff is offered the summaries of the lists they read, and Try Asking offers them a chart", async () => {
    const staff = await userOf("staff");
    const offered = (await authorise.allowedSummaries(staff)).map((s) => s.key);
    expect(offered).toEqual(expect.arrayContaining(["projects.summary", "calendar.summary", "training.summary", "sops.summary", "announcements.summary", "activity.summary"]));
    expect(offered).not.toContain("imports.summary");
    const { questions } = await assistant.suggestionsFor(staff);
    expect(questions.length).toBeLessThanOrEqual(6);
    expect(questions.filter((x) => /^(Chart|Show) /.test(x)).length).toBeGreaterThan(0);
    // The staff member does not manage policies, so no chart offered to them names them.
    expect(questions).not.toContain("Chart who has acknowledged each policy");
  });

  test("every read names its summary: these lists name theirs", () => {
    const named = {
      "projects.list": "projects.summary",
      "calendar.month": "calendar.summary",
      "training.library": "training.summary",
      "training.progress": "training.summary",
      "training.overdue": "training.summary",
      "policies.list": "policies.summary",
      "sops.list": "sops.summary",
      "announcements.list": "announcements.summary",
      "activity.list": "activity.summary",
      "alerts.mine": "alerts.summary",
      "runs.mine": "runs.summary",
      "imports.history": "imports.summary",
    };
    for (const [read, summary] of Object.entries(named)) expect([read, registry.read(read).summary]).toEqual([read, summary]);
    for (const r of registry.reads()) expect([r.key, typeof r.summary]).toEqual([r.key, "string"]);
  });
});
