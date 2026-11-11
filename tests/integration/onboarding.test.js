"use strict";
/**
 * Recruitment · Onboarding up to the documentation gate (docs/guides/offers.md §3 steps 5 to 7, §5,
 * §6): the Checklist and Plans settings with MyCity's seeded New Joiner list and default plan, the
 * Upload Documents link mailed at acceptance, the hire's page (the privacy notice first, files,
 * typed values, two guarantors, the BVN), Operations & People verifying and rejecting, the reference
 * checks, and the case moving to pre-onboarding once the contract is signed last. Send Reminder and
 * Not Progressing stop the earlier links. The real migrations through HTTP, every response parsed
 * with its contract (APP_ENV=test). The mail queue is mocked.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/onboarding
 *
 * Refuses to run unless the database name ends in "_test". Every person here is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const queues = require("../../src/jobs/queues");
const { rebuild } = require("./helpers/schema");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const lagos = require("../../src/shared/time/lagos");
const token = require("../../src/shared/places/token");
const documents = require("../../src/shared/documents/generate");
const vault = require("../../src/shared/documents/vault");
const { atomically } = require("../../src/shared/db/tx");
const { one, drain, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const area = (formatted) =>
  token.sign({ source: "search", formatted, lat: 6.45, lon: 3.42, provider_id: `test:${formatted}`, kind: "area", city: "Lagos", state: "Lagos", country_code: "ng", timezone: "Africa/Lagos", verified: true, pending: false });

const mails = (template) => queues.enqueue.mock.calls.filter((c) => c[0] === "email-send" && c[1] === template).map((c) => c[2]);
const codesSent = () => mails("signature-code").map((m) => m.data.code);
const lastTo = (template, email) => mails(template).filter((m) => m.to.email === email).pop();
const signToken = (mail) => mail.data.sign_url.split("/").pop();
const uploadToken = (mail) => mail.data.documents_url.split("/").pop();
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describeDb("Recruitment · Onboarding to the documentation gate, against the real migrations", () => {
  let app;
  let h;
  let vacancyId;
  let departmentId;
  let n = 0;
  const pub = () => ({
    get: (path) => request(app).get(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()),
    post: (path) => request(app).post(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()),
  });

  /** Render every pending document as the worker's pdf-render job does, then run the outbox. */
  async function rendered() {
    for (let round = 0; round < 3; round += 1) {
      await drain();
      const { rows } = await pool.query("SELECT document_id FROM document WHERE render_status = 'pending' ORDER BY created_at");
      if (rows.length === 0) break;
      for (const r of rows) await documents.renderPending(r.document_id, { db: pool });
    }
    await drain();
  }

  /** The candidate signs on their link: code, then signature. */
  async function signs(t, name) {
    expect((await pub().post(`/sign/${t}/code`).send({})).status).toBe(200);
    expect((await pub().post(`/sign/${t}/code/verify`).send({ code: codesSent().pop() })).status).toBe(200);
    const signed = await pub().post(`/sign/${t}/sign`).send({ full_name: name, method: "draw", signature_png: PNG, consent: true });
    expect(signed.status).toBe(200);
    await rendered();
  }

  /**
   * A shortlisted candidate through New Offer, approval, both signatures on the offer: the hire's
   * case at documentation with their Upload Documents link mailed. Answers the case and the link.
   */
  async function hiredToDocumentation(first) {
    n += 1;
    const email = `${first.toLowerCase()}.adeyemi@example.test`;
    const k = await one("INSERT INTO candidate (first_name, last_name, email) VALUES ($1, 'Adeyemi', $2) RETURNING candidate_id", [first, email]);
    const a = await one(
      "INSERT INTO application (number, vacancy_id, candidate_id, source, stage, status) VALUES ($1, $2, $3, 'careers', 'shortlist', 'active') RETURNING application_id",
      [`APP-${String(800 + n).padStart(4, "0")}`, vacancyId, k.candidate_id],
    );
    const made = await h.as("ops").post("/recruitment/offers").send({
      application_id: a.application_id,
      job_title: "Partnerships Manager",
      start_date: lagos.addDays(lagos.today(), 21),
      reports_to: "Chief Executive Officer",
      role_function: "Partnerships",
      role_scope: "Company-wide",
      employment_type: "full_time",
      work_pattern: "hybrid",
      office_days: 2,
      annual_leave_days: 15,
      probation_months: 3,
      working_hours: "Monday to Friday, 9:00 a.m. to 5:00 p.m.",
      pay_lines: [{ name: "Basic Salary", monthly_amount: "450000.00" }],
      job_description: "## Key Responsibilities\n\n- Sign and grow the venues and brands in the city guides.",
    });
    expect(made.status).toBe(201);
    const offerId = made.body.offer_id;
    const sub = await h.as("ops").post(`/recruitment/offers/${offerId}/submit`).send({});
    expect(sub.status).toBe(200);
    expect((await h.as("hod").post(`/workflow/instances/${sub.body.workflow_instance_id}/approve`).send({})).status).toBe(200);
    expect((await h.as("ceo").post(`/workflow/instances/${sub.body.workflow_instance_id}/approve`).send({})).status).toBe(200);
    await drain();
    expect((await h.as("ops").post(`/recruitment/offers/${offerId}/sign`).send({ full_name: "Ada Obi", title: "Operations & People Lead", method: "type", typed: "Ada Obi", consent: true })).status).toBe(200);
    expect((await h.as("ops").post(`/recruitment/offers/${offerId}/send`).send({})).status).toBe(200);
    await signs(signToken(lastTo("offer-sent", email)), `${first} Adeyemi`);
    const kase = await one("SELECT onboarding_case_id, employee_id, application_id FROM onboarding_case WHERE offer_id = $1", [offerId]);
    const mail = lastTo("onboarding-documents", email);
    expect(mail).toBeTruthy();
    return { ...kase, email, mail, link: uploadToken(mail), name: `${first} Adeyemi` };
  }

  const itemNamed = (pack, title) => pack.items.find((i) => i.title === title);

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "hod", first: "Ife", last: "Ojo", email: "hod@mycity.test", job: "Head of Partnerships", role: "head_of_department", password: "Head#Programmes26", department: "Partnerships" },
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "staff", first: "Tunde", last: "Ade", email: "tunde@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Partnerships" },
    ]);
    await grantsCache.bumpTeamVersion();
    await drain();
    departmentId = (await one("SELECT department_id FROM department WHERE name = 'Partnerships'")).department_id;
    await pool.query("UPDATE department SET head_employee_id = $2, head_seat_id = NULL WHERE department_id = $1", [departmentId, h.people.hod.employee_id]);
    await h.as("ops").put("/recruitment/offers/settings/signatory").send({ signatory_employee_id: h.people.ops.employee_id });
    const made = await h.as("ops").post("/recruitment/vacancies").send({
      title: "Partnerships Manager",
      department_id: departmentId,
      hiring_manager_id: h.people.hod.employee_id,
      positions: 3,
      employment_type: "full_time",
      work_pattern: "hybrid",
      location: { token: area("Lekki, Lagos") },
      salary_min: "400000.00",
      salary_max: "600000.00",
      description: "The Partnerships Manager signs and grows the venues, brands and creators that make the city guides worth opening.",
      requirements: "Five years closing partnerships in media or hospitality.",
      closes_on: lagos.addDays(lagos.today(), 30),
      publish: true,
    });
    expect(made.status).toBe(201);
    vacancyId = made.body.vacancy_id;
  }, 120_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("the Checklist settings start from MyCity's New Joiner list; a requirement is added, kept unique and switched off", async () => {
    const page = await h.as("ops").get("/recruitment/onboarding/requirements?sort=display_order");
    expect(page.status).toBe(200);
    expect(page.body.data.map((r) => r.code)).toEqual([
      "proof_of_address",
      "valid_id",
      "certificates",
      "evidence_of_separation",
      "birth_certificate",
      "employee_data_form",
      "mylagosapp_wallet_id",
      "passport_photo",
      "account_opening_form",
    ]);
    expect(page.body.data.find((r) => r.code === "mylagosapp_wallet_id").kind).toBe("number");

    const added = await h.as("ops").post("/recruitment/onboarding/requirements").send({ code: "medical_report", name: "Medical Report", required: false });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ code: "medical_report", kind: "file", required: false, active: true, display_order: 100 });
    const twice = await h.as("ops").post("/recruitment/onboarding/requirements").send({ code: "medical_report", name: "Medical Report" });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("CODE_TAKEN");
    const off = await h.as("ops").patch(`/recruitment/onboarding/requirements/${added.body.document_requirement_id}`).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);

    // Settings are Operations & People's: a member of staff without recruitment edit is refused.
    expect((await h.as("staff").get("/recruitment/onboarding/requirements")).status).toBe(403);
  });

  test("the Plans settings: the default Your First 30 Days, one plan a department, an SOP must be in force", async () => {
    const page = await h.as("ops").get("/recruitment/onboarding/plans");
    expect(page.status).toBe(200);
    const def = page.body.data.find((p) => p.department_id === null);
    expect(def).toMatchObject({ name: "Your First 30 Days", active: true, step_count: 4 });
    const full = await h.as("ops").get(`/recruitment/onboarding/plans/${def.onboarding_plan_id}`);
    expect(full.body.steps.map((s) => [s.title, s.owner_role, s.due_offset_days])).toEqual([
      ["HR Induction", "case_owner", 0],
      ["Week 1", "line_manager", 7],
      ["Weeks 2 to 3", "line_manager", 21],
      ["Week 4", "line_manager", 30],
    ]);

    const plan = {
      department_id: departmentId,
      name: "Partnerships Onboarding",
      steps: [
        { title: "Meet the partnerships team", owner_role: "head_of_department", due_offset_days: 1 },
        { title: "Shadow two venue visits", owner_role: "line_manager", due_offset_days: 10 },
      ],
    };
    const made = await h.as("ops").post("/recruitment/onboarding/plans").send(plan);
    expect(made.status).toBe(201);
    expect(made.body.steps.map((s) => s.position)).toEqual([1, 2]);
    const second = await h.as("ops").post("/recruitment/onboarding/plans").send({ ...plan, name: "Another" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("PLAN_EXISTS");
    const noSop = await h.as("ops").put(`/recruitment/onboarding/plans/${made.body.onboarding_plan_id}`).send({
      ...plan,
      steps: [{ ...plan.steps[0], sop_id: "00000000-0000-4000-8000-000000000001" }],
    });
    expect(noSop.status).toBe(422);
    expect(noSop.body.error.code).toBe("SOP_NOT_FOUND");
    const saved = await h.as("ops").put(`/recruitment/onboarding/plans/${made.body.onboarding_plan_id}`).send({ ...plan, steps: [plan.steps[1]] });
    expect(saved.status).toBe(200);
    expect(saved.body.steps).toHaveLength(1);
  });

  test("the hire sends everything on their link; verified, checked and the contract signed, the case moves to pre-onboarding", async () => {
    // Two requirements keep the run short: one file, and the Wallet ID typed.
    await pool.query("UPDATE document_requirement SET active = (code IN ('valid_id', 'mylagosapp_wallet_id'))");
    const hire = await hiredToDocumentation("Bisi");
    expect(hire.mail.data).toMatchObject({ vacancy_title: "Partnerships Manager", due_on: lagos.addDays(lagos.today(), 21) });

    // The page: the privacy notice first, nothing taken before it.
    const first = await pub().get(`/onboard/${hire.link}`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ first_name: "Bisi", role: "Partnerships Manager", status: "documentation", privacy_acknowledged: false, bvn_entered: false });
    expect(first.body.privacy_notice.length).toBeGreaterThan(2);
    expect(first.body.items.map((i) => [i.title, i.kind, i.status])).toEqual([
      ["Valid ID", "file", "pending"],
      ["MyLagosApp Wallet ID", "number", "pending"],
    ]);
    const tooSoon = await pub().post(`/onboard/${hire.link}/files`).attach("file", PDF, "id.pdf");
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.error.code).toBe("PRIVACY_FIRST");
    expect((await pub().post(`/onboard/${hire.link}/privacy`).send({ consent: true })).body.privacy_acknowledged).toBe(true);

    // A file lands on the hire's employee record, quarantined, then is named on its item.
    const file = await pub().post(`/onboard/${hire.link}/files`).attach("file", PDF, "id.pdf");
    expect(file.status).toBe(200);
    const doc = await one("SELECT entity_type, entity_id, subject_employee_id, scan_status, doc_type FROM document WHERE document_id = $1", [file.body.document_id]);
    expect(doc).toEqual({ entity_type: "employee", entity_id: hire.employee_id, subject_employee_id: hire.employee_id, scan_status: "pending", doc_type: "employee_document" });
    const idItem = itemNamed(first.body, "Valid ID");
    const wallet = itemNamed(first.body, "MyLagosApp Wallet ID");
    expect((await pub().post(`/onboard/${hire.link}/items/${idItem.onboarding_checklist_item_id}`).send({ entered_value: "x" })).body.error.code).toBe("FILE_REQUIRED");
    expect((await pub().post(`/onboard/${hire.link}/items/${idItem.onboarding_checklist_item_id}`).send({ document_id: file.body.document_id })).status).toBe(200);
    expect((await pub().post(`/onboard/${hire.link}/items/${wallet.onboarding_checklist_item_id}`).send({ entered_value: "MLA-204417" })).status).toBe(200);

    // Two guarantors of different kinds; a personal one has known the hire four years or more.
    const g1 = { position: 1, kind: "previous_employer", full_name: "Kunle Bello", relationship: "Former manager", organisation: "Lagos Events Ltd", phone: "+2348031234567", form_document_id: file.body.document_id };
    expect((await pub().post(`/onboard/${hire.link}/guarantors`).send(g1)).status).toBe(200);
    const sameKind = await pub().post(`/onboard/${hire.link}/guarantors`).send({ ...g1, position: 2, full_name: "Tolu Bello" });
    expect(sameKind.status).toBe(422);
    expect(sameKind.body.error.code).toBe("SAME_KIND");
    const g2 = { position: 2, kind: "personal", full_name: "Ngozi Eze", relationship: "Family friend", phone: "+2348039876543", years_known: 3 };
    expect((await pub().post(`/onboard/${hire.link}/guarantors`).send(g2)).status).toBe(422);
    expect((await pub().post(`/onboard/${hire.link}/guarantors`).send({ ...g2, years_known: 9 })).status).toBe(200);

    // The BVN: eleven digits, on the employee record, never on any screen's shape.
    expect((await pub().post(`/onboard/${hire.link}/bvn`).send({ bvn: "1234" })).status).toBe(422);
    const bvn = await pub().post(`/onboard/${hire.link}/bvn`).send({ bvn: "22233344455" });
    expect(bvn.status).toBe(200);
    expect(bvn.body.bvn_entered).toBe(true);
    expect(await one("SELECT bvn FROM employee WHERE employee_id = $1", [hire.employee_id])).toEqual({ bvn: "22233344455" });
    const audit = await pool.query("SELECT before::text || after::text AS t FROM audit_ledger WHERE entity_id = $1", [hire.employee_id]).catch(() => ({ rows: [] }));
    expect(audit.rows.some((r) => String(r.t).includes("22233344455"))).toBe(false);

    // Operations & People: the case waits on the documents, the guarantors and the contract.
    let kase = (await h.as("ops").get(`/recruitment/onboarding/${hire.onboarding_case_id}`)).body;
    expect(kase.waiting_on).toEqual(["documents", "guarantors", "contract"]);
    expect(kase.bvn_entered).toBe(true);
    expect(JSON.stringify(kase)).not.toContain("22233344455");
    const list = await h.as("ops").get("/recruitment/onboarding?status=documentation");
    expect(list.body.data.find((r) => r.onboarding_case_id === hire.onboarding_case_id)).toMatchObject({ hire_name: hire.name, items_outstanding: 2 });

    // A file still being scanned waits; once clean it is verified.
    const verify = (itemId) => h.as("ops").post(`/recruitment/onboarding/${hire.onboarding_case_id}/items/${itemId}/verify`).send({});
    const scanning = await verify(idItem.onboarding_checklist_item_id);
    expect(scanning.status).toBe(409);
    expect(scanning.body.error.code).toBe("SCAN_PENDING");
    const client = await pool.connect();
    try {
      await atomically(client, () => vault.completeScan(client, file.body.document_id, { clean: true }));
    } finally {
      client.release();
    }
    expect((await verify(idItem.onboarding_checklist_item_id)).status).toBe(200);

    // A rejection goes back to the hire with its reason; they send it again.
    const rejected = await h.as("ops").post(`/recruitment/onboarding/${hire.onboarding_case_id}/items/${wallet.onboarding_checklist_item_id}/reject`).send({ reason: "This is not a Wallet ID." });
    expect(rejected.status).toBe(200);
    const seen = await pub().get(`/onboard/${hire.link}`);
    expect(itemNamed(seen.body, "MyLagosApp Wallet ID")).toMatchObject({ status: "rejected", rejected_reason: "This is not a Wallet ID." });
    expect((await pub().post(`/onboard/${hire.link}/items/${wallet.onboarding_checklist_item_id}`).send({ entered_value: "2044171190" })).status).toBe(200);
    kase = (await verify(wallet.onboarding_checklist_item_id)).body;
    expect(kase.waiting_on).toEqual(["guarantors", "contract"]);

    // Reference checks: a failure waits for a corrected guarantor, whose check starts again.
    const check = (g, status) =>
      h.as("ops").post(`/recruitment/onboarding/${hire.onboarding_case_id}/guarantors/${g.onboarding_guarantor_id}/check`).send({ check_status: status, check_note: "Called on the number given." });
    const [one1, one2] = kase.guarantors;
    expect((await check(one1, "passed")).status).toBe(200);
    kase = (await check(one2, "failed")).body;
    expect(kase.waiting_on).toEqual(["guarantors", "contract"]);
    const page = await pub().get(`/onboard/${hire.link}`);
    expect(page.body.guarantors.every((g) => g.check_note === null)).toBe(true);
    expect((await pub().post(`/onboard/${hire.link}/guarantors`).send({ ...g2, years_known: 9, full_name: "Ngozi Okeke" })).status).toBe(200);
    const passedAgain = await pub().post(`/onboard/${hire.link}/guarantors`).send({ ...g1, full_name: "Somebody Else" });
    expect(passedAgain.status).toBe(409);
    expect(passedAgain.body.error.code).toBe("ALREADY_CHECKED");
    kase = (await h.as("ops").get(`/recruitment/onboarding/${hire.onboarding_case_id}`)).body;
    expect(kase.guarantors[1]).toMatchObject({ full_name: "Ngozi Okeke", check_status: "pending" });
    kase = (await check(kase.guarantors[1], "passed")).body;
    expect(kase.waiting_on).toEqual(["contract"]);
    expect(kase.status).toBe("documentation");

    // The contract last: the company signs, then the hire, and the gate opens in that transaction.
    const ct = kase.contract;
    expect((await h.as("ops").post(`/recruitment/contracts/${ct.employment_contract_id}/sign`).send({ full_name: "Ada Obi", title: "Operations & People Lead", method: "type", typed: "Ada Obi", consent: true })).status).toBe(200);
    await signs(signToken(lastTo("contract-sent", hire.email)), hire.name);
    kase = (await h.as("ops").get(`/recruitment/onboarding/${hire.onboarding_case_id}`)).body;
    expect(kase).toMatchObject({ status: "pre_onboarding", waiting_on: [] });
    expect(kase.documentation_completed_at).toBeTruthy();
    expect(await one("SELECT stage, status FROM application WHERE application_id = $1", [hire.application_id])).toEqual({ stage: "pre_onboarding", status: "active" });

    // Documentation is settled: the page still opens, and takes nothing more.
    const after = await pub().get(`/onboard/${hire.link}`);
    expect(after.body.status).toBe("pre_onboarding");
    const late = await pub().post(`/onboard/${hire.link}/bvn`).send({ bvn: "11122233344" });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("DOCUMENTATION_DONE");
  }, 180_000);

  test("Send Reminder makes a fresh link and stops the earlier one; Not Progressing stops the link", async () => {
    const hire = await hiredToDocumentation("Chuka");
    const reminded = await h.as("ops").post(`/recruitment/onboarding/${hire.onboarding_case_id}/remind`).send({});
    expect(reminded.status).toBe(200);
    const fresh = uploadToken(lastTo("onboarding-documents", hire.email));
    expect(fresh).not.toBe(hire.link);
    expect((await pub().get(`/onboard/${hire.link}`)).status).toBe(404);
    expect((await pub().get(`/onboard/${fresh}`)).status).toBe(200);

    // Another hiring manager's reader sees none of it: the staff member holds no recruitment grant.
    expect((await h.as("staff").get(`/recruitment/onboarding/${hire.onboarding_case_id}`)).status).toBe(403);

    const np = await h.as("ops").post(`/recruitment/candidates/${hire.application_id}/not-progressed`).send({ rejection_reason: "Did not complete the documents in time." });
    expect(np.status).toBe(200);
    await drain();
    expect((await pub().get(`/onboard/${fresh}`)).status).toBe(404);
  }, 120_000);
});
