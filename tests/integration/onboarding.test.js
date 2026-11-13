"use strict";
/**
 * Recruitment · Onboarding from acceptance to hired (docs/guides/offers.md §3 steps 5 to 8, §5,
 * §6, §11): the Checklist and Plans settings with MyCity's seeded New Joiner list and default plan, the
 * Upload Documents link mailed at acceptance, the hire's page (the privacy notice first, files,
 * typed values, two guarantors, the BVN), Operations & People verifying and rejecting, the reference
 * checks, and the case moving to pre-onboarding once the contract is signed last. Send Reminder and
 * Not Progressing stop the earlier links. Then onboarding-dispatch on the start date (the plan's steps
 * with their owners, overdue steps reminded once, safe twice), Mark Step Done, Complete Onboarding
 * (the company email, the login, the application hired) and Withdraw. The real migrations through HTTP, every response parsed
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

const onboarding = require("../../src/modules/onboarding/onboarding.service");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const area = (formatted) =>
  token.sign({ source: "search", formatted, lat: 6.45, lon: 3.42, provider_id: `test:${formatted}`, kind: "area", city: "Lagos", state: "Lagos", country_code: "ng", timezone: "Africa/Lagos", verified: true, pending: false });

/** A door-level place, as a guarantor's or the hire's address must be (addresses are picked, F27). */
const building = (formatted) =>
  token.sign({ source: "search", formatted, lat: 6.6, lon: 3.35, provider_id: `test:${formatted}`, kind: "building", city: "Lagos", state: "Lagos", country_code: "ng", timezone: "Africa/Lagos", verified: true, pending: false });

/** A guarantor as MyCity's Guarantor Form asks for them; `docs` the signed form and the ID copy. */
const guarantorBody = (position, kind, docs = {}, extra = {}) => ({
  position,
  kind,
  full_name: kind === "previous_employer" ? "Kunle Bello" : "Ngozi Eze",
  relationship: kind === "previous_employer" ? "Former manager" : "Family friend",
  ...(kind === "previous_employer" ? { organisation: "Lagos Events Ltd" } : { years_known: 9 }),
  phone: kind === "previous_employer" ? "+2348031234567" : "+2348039876543",
  date_of_birth: "1974-04-12",
  contact_address: { token: building("12 Allen Avenue, Ikeja") },
  residential_address: { token: building("4 Bode Thomas Street, Surulere") },
  convicted: false,
  recommends: true,
  ...(docs.form ? { form_document_id: docs.form } : {}),
  ...(docs.id ? { id_document_id: docs.id } : {}),
  ...extra,
});

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
  async function hiredToDocumentation(first, { candidateId = null, vacancy = null } = {}) {
    n += 1;
    const email = `${first.toLowerCase()}.adeyemi@example.test`;
    const k = candidateId
      ? { candidate_id: candidateId }
      : await one("INSERT INTO candidate (first_name, last_name, email) VALUES ($1, 'Adeyemi', $2) RETURNING candidate_id", [first, email]);
    const a = await one(
      "INSERT INTO application (number, vacancy_id, candidate_id, source, stage, status) VALUES ($1, $2, $3, 'careers', 'shortlist', 'active') RETURNING application_id",
      [`APP-${String(800 + n).padStart(4, "0")}`, vacancy || vacancyId, k.candidate_id],
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
    return { ...kase, offer_id: offerId, candidate_id: k.candidate_id, email, mail, link: uploadToken(mail), name: `${first} Adeyemi` };
  }

  const itemNamed = (pack, title) => pack.items.find((i) => i.title === title);

  /**
   * A hire through documentation the short way: only the Wallet ID on the checklist, two guarantors
   * passed, the BVN, both signatures on the contract. Answers the hire, their case at pre-onboarding.
   */
  async function toPreOnboarding(first, bvn) {
    await pool.query("UPDATE document_requirement SET active = (code = 'mylagosapp_wallet_id')");
    const hire = await hiredToDocumentation(first);
    expect((await pub().post(`/onboard/${hire.link}/privacy`).send({ consent: true })).status).toBe(200);
    const wallet = (await pub().get(`/onboard/${hire.link}`)).body.items[0];
    expect((await pub().post(`/onboard/${hire.link}/items/${wallet.onboarding_checklist_item_id}`).send({ entered_value: "2044171190" })).status).toBe(200);
    const form = (await pub().post(`/onboard/${hire.link}/files`).attach("file", PDF, "guarantor-form.pdf")).body.document_id;
    const docs = { form, id: form };
    expect((await pub().post(`/onboard/${hire.link}/guarantors`).send(guarantorBody(1, "previous_employer", docs))).status).toBe(200);
    expect((await pub().post(`/onboard/${hire.link}/guarantors`).send(guarantorBody(2, "personal", docs))).status).toBe(200);
    expect((await pub().post(`/onboard/${hire.link}/bvn`).send({ bvn })).status).toBe(200);
    expect((await pub().post(`/onboard/${hire.link}/address`).send({ home_address: { token: building("9 Admiralty Way, Lekki") } })).status).toBe(200);
    const url = `/recruitment/onboarding/${hire.onboarding_case_id}`;
    expect((await h.as("ops").post(`${url}/items/${wallet.onboarding_checklist_item_id}/verify`).send({})).status).toBe(200);
    let kase = (await h.as("ops").get(url)).body;
    for (const g of kase.guarantors)
      expect((await h.as("ops").post(`${url}/guarantors/${g.onboarding_guarantor_id}/check`).send({ check_status: "passed" })).status).toBe(200);
    expect((await h.as("ops").post(`/recruitment/contracts/${kase.contract.employment_contract_id}/sign`).send({ full_name: "Ada Obi", title: "Operations & People Lead", method: "type", typed: "Ada Obi", consent: true })).status).toBe(200);
    await signs(signToken(lastTo("contract-sent", hire.email)), hire.name);
    kase = (await h.as("ops").get(url)).body;
    expect(kase.status).toBe("pre_onboarding");
    return { ...hire, url };
  }

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
    // On the hire's Documents tab it reads as what it is, not as the file's own name.
    expect((await one("SELECT title FROM document WHERE document_id = $1", [file.body.document_id])).title).toBe("Valid ID");
    expect((await pub().post(`/onboard/${hire.link}/items/${wallet.onboarding_checklist_item_id}`).send({ entered_value: "MLA-204417" })).status).toBe(200);

    // Two guarantors of different kinds; a personal one has known the hire four years or more. Each
    // as MyCity's Guarantor Form asks: born when, both addresses picked, the two answers, then the
    // signed form and an ID copy (the second guarantor's come later).
    const form = await pub().post(`/onboard/${hire.link}/files`).attach("file", PDF, "form.pdf");
    const docs = { form: form.body.document_id, id: file.body.document_id };
    const g1 = guarantorBody(1, "previous_employer", docs);
    const typed = await pub().post(`/onboard/${hire.link}/guarantors`).send({ ...g1, contact_address: "12 Allen Avenue" });
    expect(typed.status).toBe(422);
    const owned = await pub().post(`/onboard/${hire.link}/guarantors`).send({ ...g1, convicted: true });
    expect(owned.status).toBe(422);
    expect(JSON.stringify(owned.body.error)).toContain("conviction_details");
    expect((await pub().post(`/onboard/${hire.link}/guarantors`).send(g1)).status).toBe(200);
    const sameKind = await pub().post(`/onboard/${hire.link}/guarantors`).send({ ...g1, position: 2, full_name: "Tolu Bello" });
    expect(sameKind.status).toBe(422);
    expect(sameKind.body.error.code).toBe("SAME_KIND");
    const g2 = guarantorBody(2, "personal", {}, { years_known: 3 });
    expect((await pub().post(`/onboard/${hire.link}/guarantors`).send(g2)).status).toBe(422);
    expect((await pub().post(`/onboard/${hire.link}/guarantors`).send({ ...g2, years_known: 9 })).status).toBe(200);
    const shown = (await pub().get(`/onboard/${hire.link}`)).body.guarantors[0];
    expect(shown).toMatchObject({ date_of_birth: "1974-04-12", contact_address: "12 Allen Avenue, Ikeja", convicted: false, recommends: true });
    expect(shown.id_document).toMatchObject({ document_id: file.body.document_id });
    expect((await one("SELECT count(*)::int AS n FROM place WHERE owner LIKE 'onboarding_guarantor.%'", [])).n).toBe(4);

    // The BVN: eleven digits, on the employee record, never on any screen's shape.
    expect((await pub().post(`/onboard/${hire.link}/bvn`).send({ bvn: "1234" })).status).toBe(422);
    const bvn = await pub().post(`/onboard/${hire.link}/bvn`).send({ bvn: "22233344455" });
    expect(bvn.status).toBe(200);
    expect(bvn.body.bvn_entered).toBe(true);
    expect(await one("SELECT bvn FROM employee WHERE employee_id = $1", [hire.employee_id])).toEqual({ bvn: "22233344455" });
    // Correctable until documentation completes (AJ, 12/11/2026): a slip is the hire's to fix.
    expect((await pub().post(`/onboard/${hire.link}/bvn`).send({ bvn: "22233344456" })).status).toBe(200);
    expect((await pub().post(`/onboard/${hire.link}/bvn`).send({ bvn: "22233344455" })).status).toBe(200);
    // The audit rows of the BVN's writes exist and never hold the number (before, after or metadata).
    await drain();
    const audit = await pool.query(
      `SELECT coalesce(before::text, '') || coalesce(after::text, '') || metadata::text AS t
         FROM audit_ledger WHERE entity_type = 'employee' AND entity_id = $1 AND 'bvn_entered' = ANY(changed_fields)`,
      [hire.employee_id],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    for (const r of audit.rows) expect(r.t).not.toMatch(/2223334445[56]/);
    const logged = await pool.query("SELECT payload::text AS t FROM event_log WHERE entity_id = $1", [hire.employee_id]);
    for (const r of logged.rows) expect(r.t).not.toMatch(/2223334445[56]/);

    // The home address: picked, never typed; until it is in, the gate waits on it.
    expect((await pub().post(`/onboard/${hire.link}/address`).send({ home_address: "9 Admiralty Way" })).status).toBe(422);
    let kase0 = (await h.as("ops").get(`/recruitment/onboarding/${hire.onboarding_case_id}`)).body;
    expect(kase0.waiting_on).toContain("address");
    const placed = await pub().post(`/onboard/${hire.link}/address`).send({ home_address: { token: building("9 Admiralty Way, Lekki") } });
    expect(placed.status).toBe(200);
    expect(placed.body.address_entered).toBe(true);
    kase0 = (await h.as("ops").get(`/recruitment/onboarding/${hire.onboarding_case_id}`)).body;
    expect(kase0.address_entered).toBe(true);
    expect(kase0.waiting_on).not.toContain("address");

    // Operations & People: the case waits on the documents, the guarantors and the contract.
    let kase = (await h.as("ops").get(`/recruitment/onboarding/${hire.onboarding_case_id}`)).body;
    expect(kase.waiting_on).toEqual(["documents", "guarantors", "contract"]);
    expect(kase.bvn_entered).toBe(true);
    expect(JSON.stringify(kase)).not.toContain("22233344455");
    const list = await h.as("ops").get("/recruitment/onboarding?status=documentation");
    expect(list.body.data.find((r) => r.onboarding_case_id === hire.onboarding_case_id)).toMatchObject({ hire_name: hire.name, items_outstanding: 2 });
    // The figures above the list count the case at documentation and the files it waits to check.
    const figures = await h.as("ops").get("/recruitment/onboarding/summary");
    expect(figures.status).toBe(200);
    expect(Object.keys(figures.body).sort()).toEqual(["can_configure", "completed_this_month", "documentation", "onboarding", "overdue_steps", "pre_onboarding", "to_verify"]);
    expect(figures.body.can_configure).toBe(true);
    expect(figures.body.documentation).toBeGreaterThanOrEqual(1);
    expect(figures.body.to_verify).toBeGreaterThanOrEqual(1);
    expect((await h.as("staff").get("/recruitment/onboarding/summary")).status).toBe(403);

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
    // Verified on the case, it is verified on the hire's record too: People never check it twice.
    expect((await one("SELECT verified_at IS NOT NULL AS verified FROM document WHERE document_id = $1", [file.body.document_id])).verified).toBe(true);

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
    // A passed check vouches for the signed form, filed under the guarantor's name and verified.
    expect(await one("SELECT title, verified_at IS NOT NULL AS verified FROM document WHERE document_id = $1", [form.body.document_id])).toEqual({ title: "Guarantor Form, Kunle Bello", verified: true });
    // No signed form or ID copy yet: the second cannot pass.
    const noForm = await check(one2, "passed");
    expect(noForm.status).toBe(409);
    expect(noForm.body.error.code).toBe("FORM_REQUIRED");
    kase = (await check(one2, "failed")).body;
    expect(kase.waiting_on).toEqual(["guarantors", "contract"]);
    const page = await pub().get(`/onboard/${hire.link}`);
    expect(page.body.guarantors.every((g) => g.check_note === null)).toBe(true);
    expect((await pub().post(`/onboard/${hire.link}/guarantors`).send({ ...g2, ...guarantorBody(2, "personal", docs), full_name: "Ngozi Okeke" })).status).toBe(200);
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
    // The hire's Documents tab (Employee 360): the signed offer and the signed contract, once each,
    // each sealed copy the next version of the copy it was signed on (AJ, 13/11/2026).
    const filed = await pool.query(
      `SELECT doc_type, version, supersedes_id IS NOT NULL AS follows FROM document
        WHERE subject_employee_id = $1 AND is_current AND doc_type IN ('offer_letter', 'employment_contract') ORDER BY doc_type`,
      [hire.employee_id],
    );
    expect(filed.rows).toEqual([
      { doc_type: "employment_contract", version: 2, follows: true },
      { doc_type: "offer_letter", version: 2, follows: true },
    ]);
    const mine = await h.as("ops").get(`/employees/${hire.employee_id}/documents`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.filter((d) => d.status === "signed")).toHaveLength(2);
    expect(kase.documentation_completed_at).toBeTruthy();
    expect(await one("SELECT stage, status FROM application WHERE application_id = $1", [hire.application_id])).toEqual({ stage: "pre_onboarding", status: "active" });

    // Documentation is settled: the page still opens, and takes nothing more.
    const after = await pub().get(`/onboard/${hire.link}`);
    expect(after.body.status).toBe("pre_onboarding");
    const late = await pub().post(`/onboard/${hire.link}/bvn`).send({ bvn: "11122233344" });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("DOCUMENTATION_DONE");
  }, 180_000);

  test("a rejection is mailed to the hire with a working link; the file sent again replaces the rejected one as its next version (AJ, 12/11/2026)", async () => {
    await pool.query("UPDATE document_requirement SET active = (code = 'valid_id')");
    const hire = await hiredToDocumentation("Remi");
    const url = `/recruitment/onboarding/${hire.onboarding_case_id}`;
    expect((await pub().post(`/onboard/${hire.link}/privacy`).send({ consent: true })).status).toBe(200);
    const idItem = (await pub().get(`/onboard/${hire.link}`)).body.items[0];
    const send = async (name) => {
      const f = await pub().post(`/onboard/${hire.link}/files`).attach("file", PDF, name);
      expect(f.status).toBe(200);
      expect((await pub().post(`/onboard/${hire.link}/items/${idItem.onboarding_checklist_item_id}`).send({ document_id: f.body.document_id })).status).toBe(200);
      return f.body.document_id;
    };
    const reject = (reason) => h.as("ops").post(`${url}/items/${idItem.onboarding_checklist_item_id}/reject`).send({ reason });
    const rejectedMails = () => mails("onboarding-document-rejected").filter((m) => m.to.email === hire.email);
    const doc = (id) => one("SELECT title, version, supersedes_id, is_current FROM document WHERE document_id = $1", [id]);
    const onRecord = async () =>
      (await pool.query("SELECT document_id FROM document WHERE entity_type = 'employee' AND entity_id = $1 AND is_current AND title = 'Valid ID'", [hire.employee_id])).rows.map((r) => r.document_id);

    // Rejected: the hire is mailed what and why, with a link of its own; the link they have still works.
    const first = await send("id-blurred.pdf");
    expect((await reject("The photo page is blurred.")).status).toBe(200);
    await drain();
    expect(rejectedMails()).toHaveLength(1);
    const mail = rejectedMails()[0];
    expect(mail.data).toMatchObject({ vacancy_title: "Partnerships Manager", document_title: "Valid ID", guarantor_name: null, reason: "The photo page is blurred." });
    expect((await pub().get(`/onboard/${uploadToken(mail)}`)).status).toBe(200);
    expect((await pub().get(`/onboard/${hire.link}`)).status).toBe(200);

    // Sent again: one entry on the hire's record, the rejected file kept as its first version.
    const second = await send("id.pdf");
    expect(await doc(second)).toEqual({ title: "Valid ID", version: 2, supersedes_id: first, is_current: true });
    expect((await doc(first)).is_current).toBe(false);
    expect(await onRecord()).toEqual([second]);

    // Rejected and sent again before the mail went: nothing is mailed, and the chain goes on.
    expect((await reject("Wrong document.")).status).toBe(200);
    const third = await send("id-again.pdf");
    await drain();
    expect(rejectedMails()).toHaveLength(1);
    expect(await doc(third)).toMatchObject({ version: 3, supersedes_id: second, is_current: true });
    expect(await onRecord()).toEqual([third]);

    // A guarantor whose check fails: mailed by name, never with the check's note; corrected, their new
    // form replaces the old one. A passed check is mailed to nobody.
    const form = (await pub().post(`/onboard/${hire.link}/files`).attach("file", PDF, "form.pdf")).body.document_id;
    expect((await pub().post(`/onboard/${hire.link}/guarantors`).send(guarantorBody(1, "previous_employer", { form, id: form }))).status).toBe(200);
    let g = (await h.as("ops").get(url)).body.guarantors[0];
    const check = (status) => h.as("ops").post(`${url}/guarantors/${g.onboarding_guarantor_id}/check`).send({ check_status: status, check_note: "Their number was not theirs." });
    expect((await check("failed")).status).toBe(200);
    await drain();
    expect(rejectedMails()).toHaveLength(2);
    const failed = rejectedMails()[1];
    expect(failed.data).toMatchObject({ document_title: null, guarantor_name: "Kunle Bello", reason: null });
    expect(JSON.stringify(failed)).not.toContain("Their number was not theirs");
    const form2 = (await pub().post(`/onboard/${hire.link}/files`).attach("file", PDF, "form-2.pdf")).body.document_id;
    expect((await pub().post(`/onboard/${hire.link}/guarantors`).send(guarantorBody(1, "previous_employer", { form: form2, id: form2 }))).status).toBe(200);
    expect(await doc(form2)).toMatchObject({ version: 2, supersedes_id: form, is_current: true });
    g = (await h.as("ops").get(url)).body.guarantors[0];
    expect((await check("passed")).status).toBe(200);
    await drain();
    expect(rejectedMails()).toHaveLength(2);
  }, 180_000);

  test("Send Reminder makes a fresh link and stops the earlier one; Not Progressing ends the case as Withdraw does", async () => {
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
    // No hire is left half onboarded: the case, its unsigned contract and the employee end with it.
    const ended = (await h.as("ops").get(`/recruitment/onboarding/${hire.onboarding_case_id}`)).body;
    expect(ended).toMatchObject({ status: "cancelled", end_reason: "Did not complete the documents in time.", can_withdraw: false });
    expect(ended.contract.status).toBe("cancelled");
    expect((await one("SELECT status FROM employee WHERE employee_id = $1", [hire.employee_id])).status).toBe("archived");
    expect((await one("SELECT status FROM application WHERE application_id = $1", [hire.application_id])).status).toBe("not_progressed");
    // The outbox delivering it twice changes nothing.
    expect(await onboarding.endForApplication(hire.application_id)).toBe(false);
    // Reopen would bring back an active card with no case, contract or employee behind it.
    const reopened = await h.as("ops").post(`/recruitment/candidates/${hire.application_id}/reopen`).send({});
    expect(reopened.status).toBe(409);
    expect(reopened.body.error).toMatchObject({ code: "MOVE_NOT_ALLOWED", message: "A hire past Offer cannot be reopened" });
    expect((await one("SELECT status FROM application WHERE application_id = $1", [hire.application_id])).status).toBe("not_progressed");
  }, 120_000);

  test("on the start date the plan's steps reach the case with their owners; overdue steps are reminded once; Complete Onboarding hires them", async () => {
    // The department's plan: one step for each owner role.
    const planRow = (await h.as("ops").get("/recruitment/onboarding/plans")).body.data.find((p) => p.department_id === departmentId);
    const steps = [
      { title: "Meet the partnerships team", owner_role: "head_of_department", due_offset_days: 0 },
      { title: "Hand in the Employee Data Form", owner_role: "hire", due_offset_days: 1 },
      { title: "Shadow two venue visits", owner_role: "line_manager", due_offset_days: 2 },
      { title: "First month review", owner_role: "case_owner", due_offset_days: 30 },
    ];
    expect((await h.as("ops").put(`/recruitment/onboarding/plans/${planRow.onboarding_plan_id}`).send({ department_id: departmentId, name: "Partnerships Onboarding", steps })).status).toBe(200);

    // The vacancy fills an Organogram seat that reports to Tunde: until hireIn fills it, the hire's
    // record names no line manager, so the seat says who it is.
    const seat = await one(
      "INSERT INTO org_seat (title, department_id, line_manager_id) VALUES ('Partnerships Manager', $1, $2) RETURNING org_seat_id",
      [departmentId, h.people.staff.employee_id],
    );
    await pool.query("UPDATE vacancy SET org_seat_id = $2 WHERE vacancy_id = $1", [vacancyId, seat.org_seat_id]);

    const hire = await toPreOnboarding("Dayo", "33344455566");
    const startsOn = lagos.addDays(lagos.today(), 21);
    const hod = h.people.hod;

    // Nothing starts before the start date, and Complete waits for onboarding.
    const early = await h.as("ops").post(`${hire.url}/complete`).send({ work_email: "dayo.adeyemi@mycity.test" });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("NOT_IN_ONBOARDING");
    await onboarding.dispatch({ today: lagos.addDays(startsOn, -1) });
    expect((await h.as("ops").get(hire.url)).body).toMatchObject({ status: "pre_onboarding", steps: [], can_complete: false, can_withdraw: true });

    // The start date: the case and the application move to onboarding; the steps are copied on, the
    // line manager's to the person the vacancy's seat reports to.
    const ran = await onboarding.dispatch({ today: startsOn });
    expect(ran.started).toBeGreaterThanOrEqual(1);
    let kase = (await h.as("ops").get(hire.url)).body;
    expect(kase.status).toBe("onboarding");
    expect(kase.steps.map((s) => [s.title, s.owner_role, s.owner_id, s.due_on, s.status])).toEqual([
      ["Meet the partnerships team", "head_of_department", hod.employee_id, startsOn, "pending"],
      ["Hand in the Employee Data Form", "hire", hire.employee_id, lagos.addDays(startsOn, 1), "pending"],
      ["Shadow two venue visits", "line_manager", h.people.staff.employee_id, lagos.addDays(startsOn, 2), "pending"],
      ["First month review", "case_owner", hod.employee_id, lagos.addDays(startsOn, 30), "pending"],
    ]);
    expect(kase.steps[1].owner_name).toBe(hire.name);
    expect(await one("SELECT stage, status FROM application WHERE application_id = $1", [hire.application_id])).toEqual({ stage: "onboarding", status: "active" });

    // Twice is safe: the case is not started again and its steps are not copied again.
    expect((await onboarding.dispatch({ today: startsOn })).started).toBe(0);
    expect((await one("SELECT count(*)::int AS n FROM onboarding_case_step WHERE onboarding_case_id = $1", [hire.onboarding_case_id])).n).toBe(4);

    // Mark Step Done, once.
    const done = (stepId) => h.as("ops").post(`${hire.url}/steps/${stepId}/done`).send({});
    expect((await done(kase.steps[0].onboarding_case_step_id)).status).toBe(200);
    const twice = await done(kase.steps[0].onboarding_case_step_id);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("STEP_DONE");

    // Three days on, the two steps still pending and past their day are reminded, once each: the
    // hire has no login yet, so theirs goes to the case's owner; Tunde's to Tunde.
    await onboarding.dispatch({ today: lagos.addDays(startsOn, 3) });
    await onboarding.dispatch({ today: lagos.addDays(startsOn, 4) });
    const { rows: overdue } = await pool.query(
      "SELECT payload FROM event_log WHERE event_key = 'onboarding.step_overdue' AND entity_id = $1 ORDER BY occurred_at",
      [hire.onboarding_case_id],
    );
    expect(overdue.map((r) => [r.payload.title, r.payload.remind_user_id])).toEqual([
      ["Hand in the Employee Data Form", hod.user_id],
      ["Shadow two venue visits", h.people.staff.user_id],
    ]);

    // Complete Onboarding needs every step done.
    const open = await h.as("ops").post(`${hire.url}/complete`).send({ work_email: "dayo.adeyemi@mycity.test" });
    expect(open.status).toBe(409);
    expect(open.body.error.code).toBe("STEPS_OPEN");
    // A Head of Department marks their own hire's steps done (team scope), and nothing more.
    const hodView = (await h.as("hod").get(hire.url)).body;
    expect(hodView).toMatchObject({ can_complete: false, can_withdraw: false, can_check: false });
    for (const s of kase.steps.slice(1)) expect((await h.as("hod").post(`${hire.url}/steps/${s.onboarding_case_step_id}/done`).send({})).status).toBe(200);
    expect((await h.as("hod").post(`${hire.url}/complete`).send({ work_email: "dayo.adeyemi@mycity.test" })).status).toBe(403);
    kase = (await h.as("ops").get(hire.url)).body;
    expect(kase.can_complete).toBe(true);

    // An address another employee holds is refused, and nothing of the step is kept.
    const taken = await h.as("ops").post(`${hire.url}/complete`).send({ work_email: "tunde@mycity.test" });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("EMPLOYEE_EXISTS");
    expect((await one("SELECT count(*)::int AS n FROM app_user WHERE employee_id = $1", [hire.employee_id])).n).toBe(0);
    expect((await h.as("ops").get(hire.url)).body.status).toBe("onboarding");

    // The company email: the work email, the login invited on it as Staff, the application hired.
    const completed = await h.as("ops").post(`${hire.url}/complete`).send({ work_email: "Dayo.Adeyemi@mycity.test" });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ status: "completed", can_complete: false, can_withdraw: false });
    expect(completed.body.completed_at).toBeTruthy();
    expect((await h.as("ops").get("/recruitment/onboarding/summary")).body.completed_this_month).toBeGreaterThanOrEqual(1);
    expect(await one("SELECT work_email::text AS work_email FROM employee WHERE employee_id = $1", [hire.employee_id])).toEqual({ work_email: "dayo.adeyemi@mycity.test" });
    const login = await one(
      `SELECT u.email::text AS email, array_agg(r.code::text) AS roles
         FROM app_user u JOIN user_role ur ON ur.user_id = u.user_id JOIN role r ON r.role_id = ur.role_id
        WHERE u.employee_id = $1 GROUP BY u.email`,
      [hire.employee_id],
    );
    expect(login).toEqual({ email: "dayo.adeyemi@mycity.test", roles: ["employee"] });
    expect(await one("SELECT stage, status FROM application WHERE application_id = $1", [hire.application_id])).toEqual({ stage: "hired", status: "hired" });
    expect((await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'application.hired' AND entity_id = $1", [hire.application_id])).n).toBe(1);

    // A completed case cannot be withdrawn.
    const late = await h.as("ops").post(`${hire.url}/withdraw`).send({ reason: "Changed their mind." });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("CASE_ENDED");
  }, 240_000);

  test("Withdraw ends the case: the contract cancelled, the link stopped, the employee archived, the application withdrawn", async () => {
    await pool.query("UPDATE document_requirement SET active = (code = 'mylagosapp_wallet_id')");
    const hire = await hiredToDocumentation("Efe");
    const url = `/recruitment/onboarding/${hire.onboarding_case_id}`;
    expect((await h.as("staff").post(`${url}/withdraw`).send({ reason: "Took another offer." })).status).toBe(403);

    const before = mails("candidate-not-progressed").length;
    const res = await h.as("ops").post(`${url}/withdraw`).send({ reason: "Took another offer before the start date." });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "cancelled", end_reason: "Took another offer before the start date.", can_withdraw: false });
    expect(res.body.cancelled_at).toBeTruthy();
    expect(res.body.contract.status).toBe("cancelled");
    await drain();
    expect((await pub().get(`/onboard/${hire.link}`)).status).toBe(404);
    expect((await one("SELECT status FROM employee WHERE employee_id = $1", [hire.employee_id])).status).toBe("archived");
    const withdrawn = await one("SELECT stage, status, withdrawn_at FROM application WHERE application_id = $1", [hire.application_id]);
    expect(withdrawn).toMatchObject({ stage: "documentation", status: "withdrawn" });
    expect(withdrawn.withdrawn_at).toBeTruthy();
    expect(mails("candidate-not-progressed").length).toBe(before);

    const again = await h.as("ops").post(`${url}/withdraw`).send({ reason: "Took another offer." });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("CASE_ENDED");
  }, 120_000);
  test("Operations & People's actions need the whole company's scope; a Head of Department reads their hire's case", async () => {
    await pool.query("UPDATE document_requirement SET active = (code = 'mylagosapp_wallet_id')");
    const hire = await hiredToDocumentation("Gozie");
    const url = `/recruitment/onboarding/${hire.onboarding_case_id}`;
    const theirs = await h.as("hod").get(url);
    expect(theirs.status).toBe(200);
    expect(theirs.body).toMatchObject({ can_check: false, can_complete: false, can_withdraw: false });
    expect(theirs.body.contract).toMatchObject({ can_resend: false, can_reissue: false });
    expect((await h.as("ops").get(url)).body).toMatchObject({ can_check: true, can_withdraw: true });
    const item = theirs.body.items[0].onboarding_checklist_item_id;
    for (const [path, body] of [
      [`${url}/items/${item}/verify`, {}],
      [`${url}/items/${item}/reject`, { reason: "Not readable." }],
      [`${url}/remind`, {}],
      [`${url}/withdraw`, { reason: "Not joining." }],
      [`/recruitment/contracts/${theirs.body.contract.employment_contract_id}/resend`, {}],
      [`/recruitment/contracts/${theirs.body.contract.employment_contract_id}/reissue`, {}],
      ["/recruitment/onboarding/requirements", { code: "hod_item", name: "A Head of Department's item" }],
      ["/recruitment/onboarding/plans", { department_id: departmentId, name: "Mine", steps: [] }],
    ])
      expect([path, (await h.as("hod").post(path).send(body)).status]).toEqual([path, 403]);
    expect((await h.as("hod").get("/recruitment/onboarding/requirements")).status).toBe(403);
    expect((await h.as("hod").get("/recruitment/contracts/settings/template")).status).toBe(403);
    expect((await h.as("hod").get("/recruitment/onboarding/summary")).body.can_configure).toBe(false);
  }, 120_000);

  test("a declined contract is reissued: a new one for the case, signed company then hire, each with a time to sign", async () => {
    await pool.query("UPDATE document_requirement SET active = (code = 'mylagosapp_wallet_id')");
    const hire = await hiredToDocumentation("Halima");
    const url = `/recruitment/onboarding/${hire.onboarding_case_id}`;
    const first = (await h.as("ops").get(url)).body.contract;
    const companySign = (id) =>
      h.as("ops").post(`/recruitment/contracts/${id}/sign`).send({ full_name: "Ada Obi", title: "Operations & People Lead", method: "type", typed: "Ada Obi", consent: true });
    expect((await companySign(first.employment_contract_id)).status).toBe(200);
    // The hire's link has a time limit, so a contract left unsigned lapses (signature-reminders).
    const req1 = await one("SELECT signature_request_id, expires_at FROM employment_contract ct JOIN signature_request r USING (signature_request_id) WHERE ct.employment_contract_id = $1", [first.employment_contract_id]);
    expect(req1.expires_at).toBeTruthy();
    expect(new Date(req1.expires_at).getTime()).toBeGreaterThan(Date.now() + 14 * 86_400_000);

    // A contract only cancelled is reissued.
    const early = await h.as("ops").post(`/recruitment/contracts/${first.employment_contract_id}/reissue`).send({});
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("NOT_CANCELLED");

    const t = signToken(lastTo("contract-sent", hire.email));
    expect((await pub().post(`/sign/${t}/decline`).send({ reason: "The start date does not suit me." })).status).toBe(200);
    await drain();
    let kase = (await h.as("ops").get(url)).body;
    expect(kase.status).toBe("documentation");
    expect(kase.contract).toMatchObject({ employment_contract_id: first.employment_contract_id, status: "cancelled", can_reissue: true });

    const again = await h.as("ops").post(`/recruitment/contracts/${first.employment_contract_id}/reissue`).send({});
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: "draft", can_sign: true });
    expect(again.body.employment_contract_id).not.toBe(first.employment_contract_id);
    expect(again.body.number).not.toBe(first.number);
    kase = (await h.as("ops").get(url)).body;
    expect(kase.contract.employment_contract_id).toBe(again.body.employment_contract_id);
    expect((await one("SELECT status FROM employment_contract WHERE employment_contract_id = $1", [first.employment_contract_id])).status).toBe("cancelled");
    // The cancelled one is not reissued twice.
    const twice = await h.as("ops").post(`/recruitment/contracts/${first.employment_contract_id}/reissue`).send({});
    expect(twice.status).toBe(409);

    expect((await companySign(again.body.employment_contract_id)).status).toBe(200);
    await signs(signToken(lastTo("contract-sent", hire.email)), hire.name);
    expect((await one("SELECT status, hire_name FROM employment_contract WHERE employment_contract_id = $1", [again.body.employment_contract_id]))).toEqual({ status: "signed", hire_name: hire.name });
    expect((await h.as("ops").get(url)).body.waiting_on).not.toContain("contract");
  }, 180_000);

  test("a hire withdrawn before keeps their address on the archived record; offered again, they accept as a new hire", async () => {
    await pool.query("UPDATE document_requirement SET active = (code = 'mylagosapp_wallet_id')");
    const first = await hiredToDocumentation("Ifeoma");
    expect((await h.as("ops").post(`/recruitment/onboarding/${first.onboarding_case_id}/withdraw`).send({ reason: "Could not start this month." })).status).toBe(200);
    expect((await one("SELECT status FROM employee WHERE employee_id = $1", [first.employee_id])).status).toBe("archived");

    // The same candidate, offered again for another role: the acceptance makes a new record.
    const role = await h.as("ops").post("/recruitment/vacancies").send({
      title: "Partnerships Associate",
      department_id: departmentId,
      hiring_manager_id: h.people.hod.employee_id,
      positions: 1,
      employment_type: "full_time",
      work_pattern: "hybrid",
      location: { token: area("Lekki, Lagos") },
      salary_min: "400000.00",
      salary_max: "600000.00",
      description: "The Partnerships Associate supports the team that signs venues, brands and creators for the city guides.",
      requirements: "Two years in partnerships or sales.",
      closes_on: lagos.addDays(lagos.today(), 30),
      publish: true,
    });
    expect(role.status).toBe(201);
    const second = await hiredToDocumentation("Ifeoma", { candidateId: first.candidate_id, vacancy: role.body.vacancy_id });
    expect(second.employee_id).not.toBe(first.employee_id);
    const rows = await pool.query(
      "SELECT status, work_email::text AS work_email FROM employee WHERE personal_email = $1 ORDER BY created_at",
      [first.email],
    );
    expect(rows.rows.map((r) => r.status)).toEqual(["archived", "active"]);
    expect(rows.rows[1].work_email).toMatch(/@hire\.invalid$/);
    // Every mail to the hire goes to their own address, never the placeholder.
    expect(second.mail.to.email).toBe(first.email);
    const kase = (await h.as("ops").get(`/recruitment/onboarding/${second.onboarding_case_id}`)).body;
    const signer = await one(
      `SELECT s.signer_email::text AS email FROM signature s JOIN employment_contract ct ON ct.signature_request_id = s.signature_request_id
        WHERE ct.employment_contract_id = $1 AND s.signer_role = 'employee'`,
      [kase.contract.employment_contract_id],
    );
    expect(signer.email).toBe(first.email);
  }, 180_000);

  test("Withdraw keeps the application's answer: one still active that cannot be withdrawn keeps the case open", async () => {
    await pool.query("UPDATE document_requirement SET active = (code = 'mylagosapp_wallet_id')");
    const hire = await hiredToDocumentation("Kelechi");
    const url = `/recruitment/onboarding/${hire.onboarding_case_id}`;
    // A card moved back to Offer by hand: withdrawnIn takes only Documentation to Onboarding.
    await pool.query("UPDATE application SET stage = 'offer' WHERE application_id = $1", [hire.application_id]);
    const refused = await h.as("ops").post(`${url}/withdraw`).send({ reason: "Not joining." });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("NOT_WITHDRAWN");
    expect((await h.as("ops").get(url)).body.status).toBe("documentation");
    expect((await one("SELECT status FROM employee WHERE employee_id = $1", [hire.employee_id])).status).toBe("active");
    await pool.query("UPDATE application SET stage = 'documentation' WHERE application_id = $1", [hire.application_id]);
  }, 120_000);

  test("a department's plan links only that department's SOPs; the company's default any", async () => {
    const other = (await one("SELECT department_id FROM department WHERE name = 'Operations'")).department_id;
    const sop = await one("INSERT INTO sop (number, department_id, title) VALUES ('SOP-9001', $1, 'Opening the office') RETURNING sop_id", [other]);
    const planRow = (await h.as("ops").get("/recruitment/onboarding/plans")).body.data.find((p) => p.department_id === departmentId);
    const full = (await h.as("ops").get(`/recruitment/onboarding/plans/${planRow.onboarding_plan_id}`)).body;
    const steps = full.steps.map((st) => ({ title: st.title, owner_role: st.owner_role, due_offset_days: st.due_offset_days }));
    const wrong = await h.as("ops").put(`/recruitment/onboarding/plans/${planRow.onboarding_plan_id}`).send({
      department_id: departmentId,
      name: full.name,
      steps: [{ ...steps[0], sop_id: sop.sop_id }, ...steps.slice(1)],
    });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe("SOP_OTHER_DEPARTMENT");
    const def = (await h.as("ops").get("/recruitment/onboarding/plans")).body.data.find((p) => p.department_id === null);
    const defFull = (await h.as("ops").get(`/recruitment/onboarding/plans/${def.onboarding_plan_id}`)).body;
    const ok = await h.as("ops").put(`/recruitment/onboarding/plans/${def.onboarding_plan_id}`).send({
      department_id: null,
      name: defFull.name,
      steps: defFull.steps.map((st, i) => ({ title: st.title, owner_role: st.owner_role, due_offset_days: st.due_offset_days, ...(i === 0 ? { sop_id: sop.sop_id } : {}) })),
    });
    expect(ok.status).toBe(200);
  });
});
