"use strict";
/**
 * Knowledge Hub · SOPs end to end (docs/guides/knowledge.md §3, §5 to §9): who writes (a
 * department's head, by the post or its filled seat, or `sops.manage`), the draft and its steps (a
 * screen the route map knows, a file from the upload engine), publishing Version N with a note and
 * the department told, Procedures under a screen, versions, Discard Changes, archiving, Draft With
 * AI, ⌘K and Praxis AI's reads, on the real migrations and through HTTP (every response parsed with
 * its contract, APP_ENV=test).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/knowledge-sops
 *
 * Every person and procedure is invented.
 */
const request = require("supertest");
const sharp = require("sharp");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const aiRegistry = require("../../src/shared/ai/registry");
const authorise = require("../../src/shared/ai/authorise");
const realtime = require("../../src/services/realtime/emitter");
const drafts = require("../../src/services/ai/drafts");
const pdfText = require("../../src/services/media/pdf-text");
const versions = require("../../src/modules/knowledge/knowledge.versions");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));
jest.mock("../../src/services/ai/llm.service", () => ({
  ...jest.requireActual("../../src/services/ai/llm.service"),
  complete: jest.fn(),
}));
const ai = require("../../src/services/ai/llm.service");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Sop-Steps9Test";
const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

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

describeDb("Knowledge Hub · SOPs against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const departments = {};
  const sops = {};
  const files = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    put: (path, body = {}) => request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    upload: (name, buffer, type) =>
      request(app)
        .post("/api/v1/documents")
        .set("Authorization", `Bearer ${tokens[who]}`)
        .field("purpose", "document")
        .attach("file", buffer, { filename: name, contentType: type }),
  });
  const noticesOf = (who, key) =>
    q("SELECT title, body, entity_type, entity_id FROM notification WHERE user_id = $1 AND event_key = $2 ORDER BY created_at", [
      people[who].user.user_id,
      key,
    ]).then((r) => r.rows);
  const employeeOf = (who) => people[who].employee.employee_id;

  /** A whole draft: Campaign Launch's, with the changes given. */
  const campaign = (over = {}) => ({
    title: "Campaign Launch",
    purpose: "How Marketing takes a campaign from brief to launch day.",
    scope: "Every paid or partner campaign.",
    roles: ["Campaign Lead", "Designer"],
    steps: [
      { text: "Write the **brief** and agree the budget.", who: "Campaign Lead" },
      { text: "Add the new partner's contact as an employee record.", who: "Campaign Lead", screen_key: "people/employees" },
      { text: "Design the launch assets.", who: "Designer", document_id: files.brief },
    ],
    ...over,
  });

  async function signIn(who) {
    ip += 1;
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", `10.76.0.${ip}`)
      .send({ email: `${who}@mycity.test`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.access_token;
  }

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    aiRegistry.load();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const make = (who, first, last, role, department, { ceo = false } = {}) =>
      tx(async (client) => {
        people[who] = await createAdmin(
          client,
          {
            employee: {
              first_name: first,
              last_name: last,
              work_email: `${who}@mycity.test`,
              phone: "08031234567",
              job_title: "Officer",
              department_name: department,
              start_date: "2026-01-05",
              employment_type: "full_time",
              work_pattern: "on_site",
            },
            role_code: role,
            is_ceo: ceo,
          },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ops", "Ngozi", "Eze", "operations_people", "Operations");
    await make("head", "Kemi", "Lawal", "employee", "Marketing");
    await make("member", "Femi", "Ola", "employee", "Marketing");
    await make("sales", "Tayo", "Ade", "employee", "Sales");
    await make("seat", "Musa", "Bello", "employee", "Finance");
    await make("mgmt", "Bola", "Okeke", "management", "Management");
    await make("ceo", "Ada", "Nwosu", "management", "Management", { ceo: true });
    for (const who of ["ops", "head", "sales", "seat", "mgmt"]) departments[who] = people[who].employee.department_id;

    // Kemi heads Marketing; Bola holds Manage SOPs on top of management's grants, which lack knowledge delete.
    await q("UPDATE department SET head_employee_id = $1 WHERE department_id = $2", [employeeOf("head"), departments.head]);
    await q(
      `INSERT INTO user_capability (user_id, capability_id)
       SELECT $1, capability_id FROM capability WHERE code = 'sops.manage'`,
      [people.mgmt.user.user_id],
    );
    await grantsCache.invalidateUser(people.mgmt.user.user_id);
    await grantsCache.bumpTeamVersion();
    await drain();
    for (const who of Object.keys(people)) tokens[who] = await signIn(who);

    const staged = await as("head").upload("brief.pdf", pdf(), "application/pdf");
    expect(staged.status).toBe(201);
    files.brief = staged.body.document_id;
  });

  beforeEach(() => jest.spyOn(realtime, "toUser").mockReturnValue(true));
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("only a writer of the department starts an SOP: numbered, with an empty draft", async () => {
    const body = { department_id: departments.head, title: "Campaign Launch" };
    expect((await as("member").post("/knowledge/sops", body)).body.error.code).toBe("NOT_SOP_WRITER");
    expect((await as("sales").post("/knowledge/sops", body)).status).toBe(403);
    expect((await as("head").post("/knowledge/sops", { ...body, title: "Go" })).status).toBe(422);

    const res = await as("head").post("/knowledge/sops", body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      number: "SOP-0001",
      department_name: "Marketing",
      state: "draft",
      in_force: null,
      can_edit: true,
      can_archive: true,
      draft: { title: "Campaign Launch", purpose: null, roles: [], steps: [], has_changes: true },
    });
    sops.campaign = res.body.sop_id;

    // Manage SOPs writes any department's; the head of Marketing writes no other.
    expect((await as("head").post("/knowledge/sops", { department_id: departments.sales, title: "Quote Follow Up" })).status).toBe(403);
    const sales = await as("ops").post("/knowledge/sops", { department_id: departments.sales, title: "Quote Follow Up" });
    expect(sales.status).toBe(201);
    expect(sales.body).toMatchObject({ number: "SOP-0002", can_edit: true, can_archive: true });
    sops.quote = sales.body.sop_id;

    const created = await one("SELECT count(*)::int AS n FROM audit_ledger WHERE action = 'sop.created'");
    expect(created.n).toBe(2);
  });

  test("a draft is its writers' alone: the department's head, Manage SOPs, the CEO", async () => {
    expect((await as("member").get(`/knowledge/sops/${sops.campaign}`)).status).toBe(404);
    expect((await as("member").get("/knowledge/sops")).body.data).toEqual([]);
    expect((await as("member").get("/knowledge/sops?state=draft")).body.data).toEqual([]);

    const head = await as("head").get("/knowledge/sops?state=draft");
    expect(head.body.data.map((r) => r.number)).toEqual(["SOP-0001"]);
    expect(head.body.data[0]).toMatchObject({ state: "draft", version: null, has_draft: true, department_name: "Marketing" });

    const ops = await as("ops").get("/knowledge/sops?state=draft&sort=number");
    expect(ops.body.data.map((r) => r.number)).toEqual(["SOP-0001", "SOP-0002"]);
    expect((await as("ceo").get(`/knowledge/sops/${sops.campaign}`)).body.can_edit).toBe(true);

    // The chips name the departments whose SOPs the reader may see; New SOP's Department, those they write for.
    const names = async (who, query = "") => (await as(who).get(`/knowledge/sops/departments${query}`)).body.data.map((d) => d.name);
    expect(await names("member")).toEqual([]);
    expect(await names("head")).toEqual(["Marketing"]);
    expect(await names("ops")).toEqual(["Marketing", "Sales"]);
    expect(await names("member", "?writable=true")).toEqual([]);
    expect(await names("head", "?writable=true")).toEqual(["Marketing"]);
    expect(await names("ops", "?writable=true")).toEqual(expect.arrayContaining(["Finance", "Management", "Marketing", "Operations", "Sales"]));
    expect((await as("ops").get(`/knowledge/sops?state=draft&department_id=${departments.sales}`)).body.data).toHaveLength(1);
  });

  test("Save Draft checks every step: a screen the hub has, a file from the upload engine", async () => {
    const path = `/knowledge/sops/${sops.campaign}/draft`;
    expect((await as("member").put(path, campaign())).body.error.code).toBe("NOT_SOP_WRITER");

    const unknown = await as("head").put(path, campaign({ steps: [{ text: "Open the board." }, { text: "Move the card.", screen_key: "people/nowhere" }] }));
    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toMatchObject({ code: "UNKNOWN_SCREEN", fields: { "steps.1.screen_key": ["Pick a screen"] } });

    const loose = await as("head").put(path, campaign({ steps: [{ text: "Attach the plan.", document_id: "8b1f6a40-0000-4000-8000-000000000009" }] }));
    expect(loose.body.error).toMatchObject({ code: "DOCUMENT_NOT_STAGED", fields: { "steps.0.document_id": ["Upload it again"] } });
    // Someone else's upload is theirs to attach, not the head's.
    const theirs = await as("member").upload("theirs.pdf", pdf(), "application/pdf");
    expect((await as("head").put(path, campaign({ steps: [{ text: "Attach it.", document_id: theirs.body.document_id }] }))).status).toBe(422);

    expect((await as("head").put(path, campaign({ purpose: "Too short" }))).status).toBe(422);
    expect((await as("head").put(path, campaign({ roles: Array.from({ length: 11 }, (_, i) => `Role ${i}`) }))).status).toBe(422);

    const saved = await as("head").put(path, campaign());
    expect(saved.status).toBe(200);
    expect(saved.body.draft).toMatchObject({ title: "Campaign Launch", roles: ["Campaign Lead", "Designer"], has_changes: true, updated_by_name: "Kemi Lawal" });
    expect(saved.body.draft.steps).toEqual([
      expect.objectContaining({ position: 1, who: "Campaign Lead", screen_key: null, screen_label: null, document_id: null }),
      expect.objectContaining({ position: 2, screen_key: "people/employees", screen_label: "People · Employees" }),
      expect.objectContaining({ position: 3, document_id: files.brief, document_name: "brief.pdf" }),
    ]);
    expect(saved.body.draft.steps[0].blocks).toEqual([
      { kind: "paragraph", spans: [{ text: "Write the ", bold: false, italic: false, href: null }, { text: "brief", bold: true, italic: false, href: null }, { text: " and agree the budget.", bold: false, italic: false, href: null }] },
    ]);
    // The file is the SOP's now, read as the SOP is.
    expect(await one("SELECT doc_type, entity_type, entity_id FROM document WHERE document_id = $1", [files.brief])).toEqual({
      doc_type: "sop_file",
      entity_type: "sop",
      entity_id: sops.campaign,
    });
    expect((await as("sales").get(`/documents/${files.brief}`)).status).toBe(200);

    // Saved again: one draft, its steps written whole, the file it holds named again without a claim.
    const again = await as("head").put(path, campaign({ steps: campaign().steps.slice(1) }));
    expect(again.body.draft.steps.map((s) => s.position)).toEqual([1, 2]);
    expect((await one("SELECT count(*)::int AS n FROM sop_version WHERE sop_id = $1", [sops.campaign])).n).toBe(1);
    await as("head").put(path, campaign());
    const audit = await one("SELECT before, after FROM audit_ledger WHERE action = 'sop.draft_saved' ORDER BY created_at DESC LIMIT 1");
    expect(audit.after.steps).toHaveLength(3);
    expect(audit.before.steps).toHaveLength(2);
  });

  test("Publish SOP asks for a purpose and a step, makes Version 1 and tells the department", async () => {
    expect((await as("ops").post(`/knowledge/sops/${sops.quote}/publish`, {})).body.error.code).toBe("SOP_NO_PURPOSE");
    await as("ops").put(`/knowledge/sops/${sops.quote}/draft`, { title: "Quote Follow Up", purpose: "How Sales follows up a quote within a week.", roles: [], steps: [] });
    expect((await as("ops").post(`/knowledge/sops/${sops.quote}/publish`, {})).body.error.code).toBe("SOP_NO_STEPS");
    expect((await as("member").post(`/knowledge/sops/${sops.campaign}/publish`, {})).status).toBe(403);

    const res = await as("head").post(`/knowledge/sops/${sops.campaign}/publish`, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "published", draft: null, title: "Campaign Launch" });
    expect(res.body.in_force).toMatchObject({ version: 1, note: null, published_by_name: "Kemi Lawal", purpose: campaign().purpose });
    const sop = { number: "SOP-0001", department_id: departments.head };
    const steps = res.body.in_force.steps.map((s) => ({ text: s.text, who: s.who, screen_key: s.screen_key, document_id: s.document_id }));
    expect(res.body.in_force.content_hash).toBe(versions.hashOf(sop, { title: "Campaign Launch", purpose: campaign().purpose, scope: campaign().scope, roles: campaign().roles, steps }, 1));

    await drain();
    const [notice] = await noticesOf("member", "sop.published");
    expect(notice).toEqual({ title: "New SOP", body: "Campaign Launch, Version 1.", entity_type: "sop", entity_id: sops.campaign });
    expect(await noticesOf("sales", "sop.published")).toEqual([]);
    expect(await noticesOf("head", "sop.published")).toEqual([]);

    // Everyone reads it now; only its writers may change it.
    const read = await as("sales").get(`/knowledge/sops/${sops.campaign}`);
    expect(read.body).toMatchObject({ can_edit: false, can_archive: false, draft: null, state: "published" });
    expect(read.body.in_force.steps).toHaveLength(3);
    const list = await as("member").get("/knowledge/sops");
    expect(list.body.data).toEqual([expect.objectContaining({ number: "SOP-0001", state: "published", version: 1, has_draft: false })]);
    expect((await as("member").get(`/knowledge/sops?department_id=${departments.sales}`)).body.data).toEqual([]);
    expect((await as("member").get("/knowledge/sops?q=launch")).body.page.total).toBe(1);
    expect((await as("member").get("/knowledge/sops?q=SOP-0001")).body.page.total).toBe(1);
    expect((await as("member").get("/knowledge/sops?sort=-salary")).status).toBe(422);
    expect((await as("sales").get("/knowledge/sops/departments")).body.data.map((d) => d.name)).toEqual(["Marketing"]);
  });

  test("Procedures: the published SOPs whose steps name the screen in view", async () => {
    const here = await as("sales").get("/knowledge/sops/for-screen?screen_key=people/employees");
    expect(here.status).toBe(200);
    expect(here.body.data).toEqual([expect.objectContaining({ sop_id: sops.campaign, title: "Campaign Launch", department_name: "Marketing" })]);
    expect((await as("sales").get("/knowledge/sops/for-screen?screen_key=workspace/tasks")).body.data).toEqual([]);
    expect((await as("sales").get("/knowledge/sops/for-screen?screen_key=People")).status).toBe(422);
  });

  test("a new version needs a change and a note; numbers are never reused; Discard Changes keeps the version in force", async () => {
    const path = `/knowledge/sops/${sops.campaign}`;
    await as("head").put(`${path}/draft`, campaign());
    const same = await as("head").get(path);
    expect(same.body.draft.has_changes).toBe(false);
    expect((await as("head").post(`${path}/publish`, { note: "Nothing really changed" })).body.error.code).toBe("NO_CHANGES");

    const changed = campaign({ steps: [...campaign().steps, { text: "Post the launch in #announcements.", who: "Campaign Lead", screen_key: "community/announcements" }] });
    await as("head").put(`${path}/draft`, changed);
    expect((await as("head").post(`${path}/publish`, {})).body.error).toMatchObject({ code: "VALIDATION", fields: { note: ["Required"] } });
    expect((await as("head").post(`${path}/publish`, { note: "Short" })).status).toBe(422);
    const v2 = await as("ops").post(`${path}/publish`, { note: "Added the launch post" });
    expect(v2.status).toBe(200);
    expect(v2.body.in_force).toMatchObject({ version: 2, note: "Added the launch post", published_by_name: "Ngozi Eze" });
    await drain();
    expect((await noticesOf("member", "sop.published")).map((n) => n.title)).toEqual(["New SOP", "SOP updated"]);
    expect((await noticesOf("head", "sop.published")).map((n) => n.title)).toEqual(["SOP updated"]);

    const history = await as("member").get(`${path}/versions`);
    expect(history.body.data.map((r) => [r.version, r.note])).toEqual([[2, "Added the launch post"], [1, null]]);
    const first = await as("member").get(`/knowledge/sops/versions/${history.body.data[1].sop_version_id}`);
    expect(first.body).toMatchObject({ version: 1, number: "SOP-0001", department_name: "Marketing" });
    expect(first.body.steps).toHaveLength(3);
    expect((await as("member").get(`/knowledge/sops/versions/${sops.campaign}`)).status).toBe(404);

    await as("head").put(`${path}/draft`, campaign({ title: "Campaign Launch Plan" }));
    const dropped = await as("head").post(`${path}/draft/discard`, {});
    expect(dropped.body).toMatchObject({ draft: null, title: "Campaign Launch", in_force: expect.objectContaining({ version: 2 }) });
    expect((await as("head").post(`${path}/draft/discard`, {})).body.error.code).toBe("NO_DRAFT");
    expect((await as("head").post(`${path}/publish`, { note: "Nothing saved to publish" })).body.error.code).toBe("NO_DRAFT");
    expect((await one("SELECT count(*)::int AS n FROM audit_ledger WHERE action = 'sop.draft_discarded'")).n).toBe(1);
  });

  test("the headship is the authority: a filled head seat writes, and the post's end ends it at once", async () => {
    const seat = await one(
      "INSERT INTO org_seat (title, department_id, status, filled_by_employee_id) VALUES ('Head of Finance', $1, 'filled', $2) RETURNING org_seat_id",
      [departments.seat, employeeOf("seat")],
    );
    const body = { department_id: departments.seat, title: "Month End Close" };
    expect((await as("seat").post("/knowledge/sops", body)).status).toBe(403);
    await q("UPDATE department SET head_seat_id = $1 WHERE department_id = $2", [seat.org_seat_id, departments.seat]);
    const res = await as("seat").post("/knowledge/sops", body);
    expect(res.status).toBe(201);
    sops.close = res.body.sop_id;

    await q("UPDATE department SET head_seat_id = NULL WHERE department_id = $1", [departments.seat]);
    expect((await as("seat").put(`/knowledge/sops/${sops.close}/draft`, { title: "Month End Close", roles: [], steps: [] })).status).toBe(403);
    expect((await as("seat").get(`/knowledge/sops/${sops.close}`)).status).toBe(404);
  });

  test("Archive SOP: the head, or Manage SOPs with knowledge delete; then it is gone from the list, Procedures and ⌘K", async () => {
    const path = `/knowledge/sops/${sops.campaign}`;
    const mgmt = await as("mgmt").get(path);
    expect(mgmt.body).toMatchObject({ can_edit: true, can_archive: false });
    expect((await as("mgmt").post(`${path}/archive`, { reason: "Replaced by the new plan" })).body.error.code).toBe("NOT_SOP_WRITER");
    expect((await as("member").post(`${path}/archive`, { reason: "Replaced by the new plan" })).status).toBe(403);
    expect((await as("head").post(`${path}/archive`, { reason: "Short" })).status).toBe(422);

    const before = await as("member").get("/search?q=campaign");
    expect(before.body.groups.find((g) => g.type === "sop").items.map((h) => h.link)).toEqual([`/knowledge?tab=sops&id=${sops.campaign}`]);

    const res = await as("head").post(`${path}/archive`, { reason: "Replaced by the new plan" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "archived", archive_reason: "Replaced by the new plan", can_edit: false, can_archive: false });
    expect((await as("head").post(`${path}/archive`, { reason: "Replaced by the new plan" })).body.error.code).toBe("SOP_ARCHIVED");
    expect((await as("head").put(`${path}/draft`, campaign())).body.error.code).toBe("SOP_ARCHIVED");

    expect((await as("member").get(path)).status).toBe(404);
    expect((await as("member").get("/knowledge/sops")).body.data).toEqual([]);
    expect((await as("member").get("/knowledge/sops/for-screen?screen_key=people/employees")).body.data).toEqual([]);
    expect((await as("member").get("/knowledge/sops?state=archived")).body.data).toEqual([]);
    expect((await as("head").get("/knowledge/sops?state=archived")).body.data.map((r) => r.state)).toEqual(["archived"]);
    expect((await as("head").get(path)).body.in_force.version).toBe(2);
    const after = await as("member").get("/search?q=campaign");
    expect(after.body.groups.find((g) => g.type === "sop")).toBeUndefined();
  });

  test("Draft With AI: a writer's, a suggestion only, from a pasted procedure or a PDF's text", async () => {
    const body = { department_id: departments.head, text: "Brief the designer. Then email ada@mycity.test the plan. Then launch on Friday." };
    expect((await as("member").post("/knowledge/sops/draft-with-ai", body)).body.error.code).toBe("NOT_SOP_WRITER");
    // With no AI set up, it says so and nothing else happens.
    const off = await as("head").post("/knowledge/sops/draft-with-ai", body);
    expect(off.status).toBe(503);
    expect(off.body.error.code).toBe("AI_UNAVAILABLE");
    expect(ai.complete).not.toHaveBeenCalled();

    jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
    ai.complete.mockImplementationOnce(async (req) => {
      expect(req).toMatchObject({ purpose: "sop-draft", module: "knowledge" });
      expect(req.input.department).toBe("Marketing");
      // The address is shielded on the way out, and put back in the answer.
      expect(req.input.procedure).not.toContain("ada@mycity.test");
      const token = /KEPT\d{3}/.exec(req.input.procedure)[0];
      return {
        output: {
          title: "Campaign Launch",
          purpose: "How a campaign goes live.",
          scope: null,
          roles: ["Designer"],
          steps: [
            { text: "Brief the designer.", who: "Designer" },
            { text: `Email ${token} the plan.`, who: null },
            { text: "Launch on Friday.", who: null },
          ],
        },
      };
    });
    const versionsBefore = (await one("SELECT count(*)::int AS n FROM sop_version")).n;
    const res = await as("head").post("/knowledge/sops/draft-with-ai", body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      title: "Campaign Launch",
      purpose: "How a campaign goes live.",
      scope: null,
      roles: ["Designer"],
      steps: [
        { text: "Brief the designer.", who: "Designer" },
        { text: "Email ada@mycity.test the plan.", who: null },
        { text: "Launch on Friday.", who: null },
      ],
    });
    expect((await one("SELECT count(*)::int AS n FROM sop_version")).n).toBe(versionsBefore);

    // A PDF: its text is read; a scan has none, and nothing is sent.
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 200, b: 200 } } }).png().toBuffer();
    const image = await as("head").upload("plan.png", png, "image/png");
    expect(image.status).toBe(201);
    expect((await as("head").post("/knowledge/sops/draft-with-ai", { department_id: departments.head, document_id: image.body.document_id })).body.error.code).toBe("NOT_A_PDF");
    const scan = await as("head").upload("scan.pdf", pdf(), "application/pdf");
    jest.spyOn(pdfText, "read").mockResolvedValueOnce(null);
    const none = await as("head").post("/knowledge/sops/draft-with-ai", { department_id: departments.head, document_id: scan.body.document_id });
    expect(none.body.error).toMatchObject({ code: "NO_TEXT", fields: { document_id: ["No text in this file"] } });
    expect(ai.complete).toHaveBeenCalledTimes(1);

    jest.spyOn(pdfText, "read").mockResolvedValueOnce("Close the books on the last working day.");
    ai.complete.mockImplementationOnce(async (req) => {
      expect(req.input.procedure).toBe("Close the books on the last working day.");
      return { output: { title: "Month End", purpose: "Closing the month.", scope: null, roles: [], steps: [{ text: "Close the books on the last working day.", who: null }] } };
    });
    const fromPdf = await as("head").post("/knowledge/sops/draft-with-ai", { department_id: departments.head, document_id: scan.body.document_id });
    expect(fromPdf.status).toBe(200);
    expect(fromPdf.body.steps).toHaveLength(1);
    // Someone else's upload is not theirs to read.
    const theirs = await as("member").upload("theirs.pdf", pdf(), "application/pdf");
    expect((await as("head").post("/knowledge/sops/draft-with-ai", { department_id: departments.head, document_id: theirs.body.document_id })).status).toBe(404);
    expect((await as("head").post("/knowledge/sops/draft-with-ai", { department_id: departments.head })).status).toBe(422);
  });

  test("Praxis AI reads what the reader may read, citing the version", async () => {
    await as("ops").put(`/knowledge/sops/${sops.quote}/draft`, {
      title: "Quote Follow Up",
      purpose: "How Sales follows up a quote within a week.",
      roles: ["Sales Officer"],
      steps: [{ text: "Call the client three days after the quote.", who: "Sales Officer" }],
    });
    await as("ops").post(`/knowledge/sops/${sops.quote}/publish`, {});
    const actor = await grantsCache.getAuthUser(pool, people.member.user.user_id);
    const list = await authorise.runRead(pool, actor, "sops.list", {});
    expect(list.data.map((r) => r.title)).toEqual(["Quote Follow Up"]);
    const read = await authorise.runRead(pool, actor, "sops.read", { id: sops.quote });
    expect(read.data).toMatchObject({ version: 1, steps: [expect.objectContaining({ who: "Sales Officer" })] });
    expect(read.citations).toEqual([expect.objectContaining({ type: "sop", id: sops.quote, label: "SOP-0002 Quote Follow Up, Version 1" })]);
    await expect(authorise.runRead(pool, actor, "sops.read", { id: sops.close })).rejects.toMatchObject({ status: 404 });
  });
});
