"use strict";
/**
 * Partnerships · Work (docs/guides/partnerships.md §6.7, §6.12, §6.16, Appendix A PR 5;
 * docs/guides/workspace.md §6 Connect to Partner): the real migrations on a throwaway database, the
 * whole app through HTTP, every response parsed with its contract (APP_ENV=test).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/partnerships-work
 *
 * Connect to Partner on tasks, projects and events, never widening who sees them; the Work tab's
 * hidden counts; deliverables raised once a signing; the deal's event days moved and called off;
 * the inactivity follow-up once a quiet spell; a lead's work moving to its partner. Every
 * organisation and person is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0] || null;
const PASSWORD = "Partners-Work9Links";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

const STAGES = [
  ["prospect_identified", "Prospect Identified", "prospect"],
  ["initial_contact", "Initial Contact", "contacted"],
  ["proposal_sent", "Proposal Sent", "proposal"],
  ["partnership_signed", "Partnership Signed", "signed"],
  ["active_partnership", "Active Partnership", "active"],
  ["closed_lost", "Closed Lost", "closed_lost"],
  ["on_hold", "On Hold", "on_hold"],
];

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

describeDb("partnerships: work connected to a partner", () => {
  let app;
  const people = {};
  const tokens = {};
  const cat = {};
  let ip = 0;

  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`);
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path, body = {}) => auth(request(app).post(`/api/v1${path}`)).send(body),
      patch: (path, body = {}) => auth(request(app).patch(`/api/v1${path}`)).send(body),
      upload: (name) => auth(request(app).post("/api/v1/documents")).attach("file", PDF, { filename: name, contentType: "application/pdf" }),
    };
  };
  const emp = (who) => people[who].employee.employee_id;
  const ok = (res, status = 200) => {
    expect([res.status, res.body.error]).toEqual([status, undefined]);
    return res.body;
  };

  const newLead = async (who, name, deal = {}) =>
    ok(
      await as(who).post("/partnerships/leads", {
        name,
        partner_category_id: cat.event,
        region: { scope: "national" },
        owner_id: emp(who),
        contact: { first_name: "Ngozi", last_name: "Adebayo", email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.test` },
        deal: { title: `${name} 2026`, owner_id: emp(who), ...deal },
      }),
      201,
    );
  const newPartner = async (who, name, deal = {}, extra = {}) =>
    ok(
      await as(who).post("/partnerships/partners", {
        name,
        partner_category_id: cat.event,
        region: { scope: "national" },
        owner_id: emp(who),
        contact: { first_name: "Femi", last_name: "Bello", email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.test` },
        deal: { title: `${name} Edition`, owner_id: emp(who), ...deal },
        ...extra,
      }),
      201,
    );
  const signedCopy = async (who) => ok(await as(who).upload("signed.pdf"), 201).document_id;

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const sample = (first, last, email, job, department) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: department,
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
    });
    const make = (key, first, last, role, job, department = "Growth", isCeo = false) =>
      tx(async (client) => {
        people[key] = await createAdmin(client, { employee: sample(first, last, `${key}@mycity.test`, job, department), role_code: role, is_ceo: isCeo }, PASSWORD, {
          allowAdditional: true,
        });
      });
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("manager", "Kemi", "Alade", "manager", "Growth Lead");
    await make("staff", "Musa", "Danjuma", "employee", "Growth Officer");
    await make("other", "Zainab", "Lawal", "employee", "Growth Officer", "Marketing");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("manager"), emp("staff")]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    for (const [i, [code, label, meaning]] of STAGES.entries()) {
      await q(
        `INSERT INTO reference_value (domain, code, label, display_order, metadata) VALUES ('partnership_stage', $1, $2, $3, $4::jsonb)
         ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, metadata = EXCLUDED.metadata, active = true`,
        [code, label, (i + 1) * 10, JSON.stringify({ meaning })],
      );
    }
    await q("UPDATE reference_value SET active = false WHERE domain = 'partnership_stage' AND metadata = '{}'::jsonb");
    cat.event = (await one("INSERT INTO partner_category (name, default_validity_days, display_order) VALUES ('Event', 30, 1) RETURNING partner_category_id")).partner_category_id;
    // The Events checklist, as Categories enters it: one item after signing, one before the event, one retired.
    await q(
      `INSERT INTO partner_category_checklist_item (partner_category_id, title, due_from, due_days, position, active) VALUES
         ($1, 'Event registration on MyCityApp', 'signing', 7, 1, true),
         ($1, 'Amplification across our channels', 'event_start', 3, 2, true),
         ($1, 'A retired item', 'signing', 1, 3, false)`,
      [cat.event],
    );
    await drain();
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.72.0.${ip}`).send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  describe("Connect to Partner (§6.16)", () => {
    let lead;
    let leadDeal;
    let theirs;
    beforeAll(async () => {
      const made = await newLead("staff", "Lekki Food Fair");
      lead = made.lead.lead_id;
      leadDeal = made.deal.deal_id;
      theirs = (await newLead("other", "Enugu Coal City Expo")).lead.lead_id;
    });

    test("New Task, New Project and New Event connect to a lead and its deal, named for the person", async () => {
      const task = ok(await as("staff").post("/tasks", { title: "Book the tasting tables", lead_id: lead, deal_id: leadDeal }), 201);
      expect(task.partner_link).toEqual({ partner_id: null, lead_id: lead, deal_id: leadDeal, name: "Lekki Food Fair", number: "LED-0001", deal_number: expect.stringMatching(/^DEAL-/), deal_title: "Lekki Food Fair 2026" });
      const project = ok(await as("staff").post("/projects", { name: "Food Fair Launch", lead_id: lead }), 201);
      expect(project.partner_link).toMatchObject({ lead_id: lead, deal_id: null, name: "Lekki Food Fair" });
      const event = ok(
        await as("staff").post("/calendar", { title: "Tasting with the organisers", starts_at: "2026-12-01T10:00:00Z", ends_at: "2026-12-01T11:00:00Z", lead_id: lead, deal_id: leadDeal }),
        201,
      );
      expect(event.partner_link).toMatchObject({ lead_id: lead, deal_id: leadDeal, name: "Lekki Food Fair" });
    });

    test("a record the person cannot see, a deal not its own, or a deal alone is refused on its field", async () => {
      const unseen = await as("staff").post("/tasks", { title: "Peek", lead_id: theirs });
      expect([unseen.status, unseen.body.error.fields]).toEqual([422, { lead_id: ["Not a lead you can see"] }]);
      const other = (await as("other").get(`/partnerships/leads/${theirs}`)).body.deal.deal_id;
      const wrongDeal = await as("ops").post("/projects", { name: "Mixed up", lead_id: lead, deal_id: other });
      expect([wrongDeal.status, wrongDeal.body.error.fields]).toEqual([422, { deal_id: ["Not one of its open deals"] }]);
      const alone = await as("staff").post("/tasks", { title: "Deal alone", deal_id: leadDeal });
      expect([alone.status, alone.body.error.fields]).toEqual([422, { partner_id: ["Pick the partner first"] }]);
      const both = await as("staff").post("/tasks", { title: "Both", lead_id: lead, partner_id: lead });
      expect(both.status).toBe(422);
    });

    test("a task made in a connected project takes its link; Disconnect clears it; the filter narrows the list", async () => {
      const project = ok(await as("staff").post("/projects", { name: "Fair Logistics", lead_id: lead, deal_id: leadDeal }), 201);
      const inside = ok(await as("staff").post("/tasks", { title: "Hire the generators", project_id: project.project_id }), 201);
      expect(inside.partner_link).toMatchObject({ lead_id: lead, deal_id: leadDeal });
      const loose = ok(await as("staff").post("/tasks", { title: "Not for a partner" }), 201);
      expect(loose.partner_link).toBeNull();
      const filtered = ok(await as("staff").get(`/tasks?lead_id=${lead}`));
      expect(filtered.data.map((t) => t.title)).toEqual(expect.arrayContaining(["Book the tasting tables", "Hire the generators"]));
      expect(filtered.data.map((t) => t.title)).not.toContain("Not for a partner");
      const projects = ok(await as("staff").get(`/projects?lead_id=${lead}`));
      expect(projects.data.map((p) => p.name).sort()).toEqual(["Fair Logistics", "Food Fair Launch"]);
      const off = ok(await as("staff").patch(`/tasks/${inside.task_id}`, { lead_id: null }));
      expect(off.partner_link).toBeNull();
      // A new record clears the deal unless one is given.
      const moved = ok(await as("staff").patch(`/projects/${project.project_id}`, { lead_id: null }));
      expect(moved.partner_link).toBeNull();
    });

    test("connecting never widens access: the task stays out of sight, its partner unnamed to a watcher who cannot see it", async () => {
      const task = ok(await as("staff").post("/tasks", { title: "Confirm the venue deposit", lead_id: lead, deal_id: leadDeal, watcher_ids: [emp("other")] }), 201);
      const watched = ok(await as("other").get(`/tasks/${task.task_id}`));
      expect(watched.partner_link).toEqual({ partner_id: null, lead_id: lead, deal_id: leadDeal, name: null, number: null, deal_number: null, deal_title: null });
      // Seeing the lead through Partnerships opens no task on Workspace.
      const solo = ok(await as("staff").post("/tasks", { title: "Private prep", lead_id: lead }), 201);
      expect((await as("other").get(`/tasks/${solo.task_id}`)).status).toBe(404);
    });

    test("the Work tab lists what the reader may see and counts the rest", async () => {
      const deal = (await as("staff").get(`/partnerships/leads/${lead}`)).body.deal.deal_id;
      // `other` joins the deal's team, so they see the lead in Partnerships, never staff's own tasks.
      ok(await as("staff").patch(`/partnerships/deals/${deal}`, { member_ids: [emp("other")] }));
      const mine = ok(await as("staff").get(`/partnerships/work?lead_id=${lead}&kind=task`));
      expect(mine.data.length).toBeGreaterThanOrEqual(3);
      expect(mine.hidden).toEqual({ projects: 0, tasks: 0, events: 0 });
      const theirsView = ok(await as("other").get(`/partnerships/work?lead_id=${lead}&kind=task`));
      // The watched task is theirs to open; the rest are counted, never listed.
      expect(theirsView.data.map((t) => t.title)).toEqual(["Confirm the venue deposit"]);
      expect(theirsView.hidden.tasks).toBe(mine.data.length - 1);
      expect(theirsView.hidden.events).toBe(1);
      expect(theirsView.hidden.projects).toBe(0);
      const projects = ok(await as("other").get(`/partnerships/work?lead_id=${lead}&kind=project`));
      expect(projects.data.length).toBe(1);
      expect((await as("other").get(`/partnerships/work?lead_id=${theirs}&kind=task`)).status).toBe(200);
      expect((await as("staff").get(`/partnerships/work?lead_id=${theirs}&kind=task`)).status).toBe(404);
      // The 360's Overview names the next events the reader may see.
      expect((await as("staff").get(`/partnerships/leads/${lead}`)).body.overview.events.map((e) => e.title)).toEqual(["Tasting with the organisers"]);
      expect((await as("other").get(`/partnerships/leads/${lead}`)).body.overview.events).toEqual([]);
    });

    test("the pickers offer the records and open deals the person sees", async () => {
      const records = ok(await as("staff").get("/partnerships/work/records?q=lekki"));
      expect(records.data).toEqual([{ kind: "lead", id: lead, number: "LED-0001", name: "Lekki Food Fair", category: "Event" }]);
      expect(ok(await as("staff").get("/partnerships/work/records?q=enugu")).data).toEqual([]);
      const deals = ok(await as("staff").get(`/partnerships/work/deals?lead_id=${lead}`));
      expect(deals.data).toEqual([expect.objectContaining({ deal_id: leadDeal, status: "open", record_name: "Lekki Food Fair" })]);
    });

    test("a lead that becomes a partner takes its work with it", async () => {
      const copy = await signedCopy("staff");
      const converted = ok(await as("staff").post(`/partnerships/leads/${lead}/convert`, { signed_copy_document_id: copy }));
      const partnerId = converted.partner_id;
      const left = await one("SELECT count(*)::int AS n FROM task WHERE lead_id = $1", [lead]);
      expect(left.n).toBe(0);
      const moved = ok(await as("staff").get(`/tasks?partner_id=${partnerId}`));
      expect(moved.data.map((t) => t.title)).toEqual(expect.arrayContaining(["Book the tasting tables", "Confirm the venue deposit"]));
      expect(await one("SELECT count(*)::int AS n FROM project WHERE partner_id = $1", [partnerId])).toEqual({ n: 1 });
      expect(await one("SELECT count(*)::int AS n FROM calendar_event WHERE partner_id = $1 AND entity_type IS NULL", [partnerId])).toEqual({ n: 1 });
      const relinked = await q("SELECT event_key FROM event_log WHERE entity_type = 'lead' AND entity_id = $1 AND event_key LIKE '%.relinked' ORDER BY event_key", [lead]);
      expect(relinked.rows.map((r) => r.event_key)).toEqual(["calendar_event.relinked", "project.relinked", "task.relinked"]);
    });
  });

  describe("signing: deliverables and the event days (§6.7, §6.16)", () => {
    const deliverables = (dealId) => q("SELECT dd.title, t.title AS task, t.primary_assignee_id, t.partner_id, t.deal_id, t.project_id, to_char(t.due_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS due FROM deal_deliverable dd JOIN task t ON t.task_id = dd.task_id WHERE dd.deal_id = $1 ORDER BY dd.title", [dealId]).then((r) => r.rows);
    const keptEvent = (dealId) => one("SELECT calendar_event_id, title, starts_at, ends_at, all_day, visibility, cancelled_at, owner_employee_id, partner_id, deal_id FROM calendar_event WHERE entity_type = 'partner' AND deal_id = $1", [dealId]);

    test("a signing raises the active checklist once, inside the deal's project, and puts its days on the team's calendar", async () => {
      const made = await newLead("staff", "Ikoyi Lights Festival", { event_title: "Ikoyi Lights", event_starts_on: "2026-12-20", event_ends_on: "2026-12-22", member_ids: [emp("manager")] });
      const dealId = made.deal.deal_id;
      const project = ok(await as("staff").post("/projects", { name: "Lights Delivery", lead_id: made.lead.lead_id, deal_id: dealId }), 201);
      const copy = await signedCopy("staff");
      ok(await as("staff").post(`/partnerships/deals/${dealId}/stage`, { stage: "partnership_signed", signed_copy_document_id: copy }));
      await drain();
      const raised = await deliverables(dealId);
      expect(raised.map((d) => d.title)).toEqual(["Amplification across our channels", "Event registration on MyCityApp"]);
      const partnerId = (await one("SELECT partner_id FROM partnership_opportunity WHERE partnership_opportunity_id = $1", [dealId])).partner_id;
      for (const d of raised) {
        expect(d).toMatchObject({ primary_assignee_id: emp("staff"), partner_id: partnerId, deal_id: dealId, project_id: project.project_id });
      }
      expect(raised[0]).toMatchObject({ task: "Amplification across our channels · Ikoyi Lights Festival 2026", due: "2026-12-17" });
      // The same event again raises nothing twice.
      const signed = await one("SELECT event_id FROM event_log WHERE event_key = 'deal.signed' AND entity_id = $1", [dealId]);
      await require("../../src/modules/partner_pipeline/partner_pipeline.deliverables").raise({ payload: { deal_id: dealId }, actor_user_id: null, event_id: signed.event_id });
      expect((await deliverables(dealId)).length).toBe(2);

      const ev = await keptEvent(dealId);
      expect(ev).toMatchObject({ title: "Ikoyi Lights", all_day: true, visibility: "attendees", cancelled_at: null, owner_employee_id: emp("staff"), partner_id: partnerId, deal_id: dealId });
      const attendees = await q("SELECT employee_id FROM calendar_event_attendee WHERE calendar_event_id = $1", [ev.calendar_event_id]);
      expect(attendees.rows.map((r) => r.employee_id)).toEqual([emp("manager")]);
      // The deal keeps it: Edit Event and Call Off refuse it.
      const edit = await as("staff").patch(`/calendar/${ev.calendar_event_id}`, { title: "Mine now" });
      expect([edit.status, edit.body.error.code]).toEqual([409, "EVENT_OWNED_BY_RECORD"]);

      // New dates move it; Closed Lost calls it off.
      ok(await as("staff").patch(`/partnerships/deals/${dealId}`, { event_starts_on: "2026-12-27", event_ends_on: "2026-12-28" }));
      await drain();
      const moved = await keptEvent(dealId);
      expect(moved.calendar_event_id).toBe(ev.calendar_event_id);
      expect(new Date(moved.starts_at).toISOString()).toBe("2026-12-26T23:00:00.000Z");
      expect(new Date(moved.ends_at).toISOString()).toBe("2026-12-28T23:00:00.000Z");
      ok(await as("staff").post(`/partnerships/deals/${dealId}/stage`, { stage: "closed_lost", reason: "The festival was called off this year" }));
      await drain();
      expect((await keptEvent(dealId)).cancelled_at).not.toBeNull();
    });

    test("New Partner signed before the hub raises no deliverables; with a signed copy it does", async () => {
      const before = await newPartner("staff", "Eko Hotels Group", { event_starts_on: "2026-12-05" }, { signed_before_hub: true });
      await drain();
      const beforeDeal = before.deals[0].deal_id;
      expect(await deliverables(beforeDeal)).toEqual([]);
      expect(await keptEvent(beforeDeal)).toMatchObject({ cancelled_at: null });
      const copy = await signedCopy("staff");
      const withCopy = await newPartner("staff", "Lagos Jazz Series", {}, { signed_copy_document_id: copy });
      await drain();
      expect((await deliverables(withCopy.deals[0].deal_id)).length).toBe(2);
    });

    test("a deal the tracker import signed raises nothing", async () => {
      const partners = require("../../src/modules/partners/partners.service");
      const actor = { ...people.staff.user, employee_id: emp("staff") };
      const made = await tx((client) =>
        partners.createIn(
          client,
          actor,
          { name: "Imported Arts Ltd", partner_category_id: cat.event, region: { scope: "national" }, owner_id: emp("staff"), deal: { title: "Arts Week", owner_id: emp("staff"), event_starts_on: "2026-12-10" }, signed_before_hub: true },
          { held: false, source: "import" },
        ),
      );
      await drain();
      expect(await deliverables(made.deal_id)).toEqual([]);
      expect(await keptEvent(made.deal_id)).toBeNull();
    });
  });

  describe("the inactivity follow-up (§6.12)", () => {
    const sweep = (now) => require("../../src/modules/partner_pipeline/partner_pipeline.inactivity").sweep({ now });

    test("no rule enabled, no follow-up; then one follow-up a quiet spell", async () => {
      const made = await newPartner("staff", "Quiet Waters Resort", {}, { signed_before_hub: true });
      const partnerId = made.partner.partner_id;
      const dealId = made.deals[0].deal_id;
      await drain();
      await q("UPDATE partner SET created_at = now() - interval '60 days' WHERE partner_id = $1", [partnerId]);
      expect(await sweep(new Date())).toEqual({ skipped: "no rule" });
      await q(
        "INSERT INTO home_alert_rule (key, name, metric, threshold, severity, permission_key, enabled) VALUES ('partner_inactivity.test', 'Partner Inactivity', 'partner_inactivity', 30, 'medium', 'partnerships', true)",
      );
      const first = await sweep(new Date());
      expect(first.followed_up).toBeGreaterThanOrEqual(1);
      const tasks = await q("SELECT title, primary_assignee_id, partner_id, priority FROM task WHERE partner_id = $1 AND title LIKE 'Follow up with%'", [partnerId]);
      expect(tasks.rows).toEqual([{ title: "Follow up with Quiet Waters Resort", primary_assignee_id: emp("staff"), partner_id: partnerId, priority: "high" }]);
      expect(await one("SELECT health FROM partnership_opportunity WHERE partnership_opportunity_id = $1", [dealId])).toEqual({ health: "follow_up_required" });
      const line = await one("SELECT source, to_stage FROM partnership_stage_history WHERE partnership_opportunity_id = $1 AND kind = 'health' ORDER BY changed_at DESC LIMIT 1", [dealId]);
      expect(line).toEqual({ source: "system", to_stage: "follow_up_required" });

      // Run again the same morning, or the next: the spell is followed up once.
      await sweep(new Date());
      await sweep(new Date(Date.now() + 86400000));
      expect((await q("SELECT 1 FROM task WHERE partner_id = $1 AND title LIKE 'Follow up with%'", [partnerId])).rows.length).toBe(1);

      // Contact ends the spell; a new quiet spell later is followed up again.
      await q("INSERT INTO partner_interaction (partner_id, interaction_type, occurred_at, subject, summary, owner_id) VALUES ($1, 'call', now() - interval '45 days', 'Call', 'Spoke about the next season.', $2)", [partnerId, emp("staff")]);
      await sweep(new Date());
      expect((await q("SELECT 1 FROM task WHERE partner_id = $1 AND title LIKE 'Follow up with%'", [partnerId])).rows.length).toBe(2);
      expect((await q("SELECT dedup_key FROM partner_follow_up WHERE partner_id = $1", [partnerId])).rows.length).toBe(2);
    });
  });
});
