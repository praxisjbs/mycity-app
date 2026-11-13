"use strict";
/**
 * Recruitment · Offers end to end (docs/guides/offers.md §3 steps 1 to 5, §6): New Offer from a
 * shortlisted candidate with the score snapshot, the monthly range, Submit for Approval through the
 * `recruitment.offer` flow (the head of the hiring department, then the CEO), the letter generated and
 * its signature request opened at approval, the Offer Signatory signing in the hub, Send Offer with the
 * candidate's link, the candidate signing or declining on the public page, Withdraw, Not Progressing,
 * the Offers settings, and New Offer as an assistant card (offers.create). The real migrations through
 * HTTP, every response parsed with its contract (APP_ENV=test). The mail queue is mocked.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/offers
 *
 * Refuses to run unless the database name ends in "_test". Every person here is invented.
 */
const request = require("supertest");
const schemas = require("@mycity/contract");
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
const { one, drain, harness } = require("./helpers/ai-actions");
const documents = require("../../src/shared/documents/generate");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const area = (formatted) =>
  token.sign({ source: "search", formatted, lat: 6.45, lon: 3.42, provider_id: `test:${formatted}`, kind: "area", city: "Lagos", state: "Lagos", country_code: "ng", timezone: "Africa/Lagos", verified: true, pending: false });

const mails = (template) => queues.enqueue.mock.calls.filter((c) => c[0] === "email-send" && c[1] === template).map((c) => c[2]);
const codesSent = () => mails("signature-code").map((m) => m.data.code);
const tokenOf = (mail) => mail.data.sign_url.split("/").pop();
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describeDb("Recruitment · Offers against the real migrations", () => {
  let app;
  let h;
  let vacancyId;
  let n = 0;
  const pub = () => ({
    get: (path) => request(app).get(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()),
    post: (path) => request(app).post(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()).set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1"),
  });

  async function applicant(first, stage = "shortlist") {
    n += 1;
    const k = await one("INSERT INTO candidate (first_name, last_name, email) VALUES ($1, 'Okafor', $2) RETURNING candidate_id", [first, `${first.toLowerCase()}.okafor@example.test`]);
    const a = await one(
      "INSERT INTO application (number, vacancy_id, candidate_id, source, stage, status) VALUES ($1, $2, $3, 'careers', $4, 'active') RETURNING application_id",
      [`APP-${String(900 + n).padStart(4, "0")}`, vacancyId, k.candidate_id, stage],
    );
    return a.application_id;
  }

  const terms = (applicationId, monthly = ["400000.00", "30000.00", "20000.00"]) => ({
    application_id: applicationId,
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
    pay_lines: [
      { name: "Basic Salary", monthly_amount: monthly[0] },
      { name: "Internet & Recharge Allowance", monthly_amount: monthly[1] },
      { name: "Transportation Allowance", monthly_amount: monthly[2] },
    ],
    job_description: "## Key Responsibilities\n\n- Sign and grow the venues and brands in the city guides.",
  });

  /**
   * The document requirements a case's checklist is built from. Send Offer is refused while there is
   * no required one (guide §11), so every send below makes sure of these beside the seeded New Joiner
   * list (5399), which a test below switches off.
   */
  async function requirements() {
    await pool.query(
      `INSERT INTO document_requirement (code, name, required, display_order)
       VALUES ('valid_id', 'A valid ID', true, 1), ('passport_photo', 'Passport photograph', true, 2),
              ('nysc', 'NYSC certificate', false, 3)
       ON CONFLICT (code) DO UPDATE SET active = true, required = EXCLUDED.required`,
    );
  }

  /**
   * Render every pending document as the worker's pdf-render job does, then run the outbox: a sealed
   * copy's hash is recorded and its mails queued only once it is rendered.
   */
  async function rendered() {
    for (let round = 0; round < 3; round += 1) {
      await drain();
      const { rows } = await pool.query("SELECT document_id FROM document WHERE render_status = 'pending' ORDER BY created_at");
      if (rows.length === 0) break;
      for (const r of rows) await documents.renderPending(r.document_id, { db: pool });
    }
    await drain();
  }

  /** Submit, both approvals, the outbox: the offer approved with its letter and request. */
  async function approved(offerId) {
    const sub = await h.as("ops").post(`/recruitment/offers/${offerId}/submit`).send({});
    expect(sub.status).toBe(200);
    expect(sub.body.status).toBe("approval");
    const instance = sub.body.workflow_instance_id;
    expect((await h.as("hod").post(`/workflow/instances/${instance}/approve`).send({})).status).toBe(200);
    expect((await h.as("ceo").post(`/workflow/instances/${instance}/approve`).send({})).status).toBe(200);
    await drain();
    return (await h.as("ops").get(`/recruitment/offers/${offerId}`)).body;
  }

  async function signedAndSent(offerId) {
    await requirements();
    const signed = await h.as("ops").post(`/recruitment/offers/${offerId}/sign`).send({ full_name: "Ada Obi", title: "Operations & People Lead", method: "type", typed: "Ada Obi", consent: true });
    expect(signed.status).toBe(200);
    const sent = await h.as("ops").post(`/recruitment/offers/${offerId}/send`).send({});
    expect(sent.status).toBe(200);
    return sent.body;
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
    const dept = (await one("SELECT department_id FROM department WHERE name = 'Partnerships'")).department_id;
    await pool.query("UPDATE department SET head_employee_id = $2, head_seat_id = NULL WHERE department_id = $1", [dept, h.people.hod.employee_id]);
    const made = await h.as("ops").post("/recruitment/vacancies").send({
      title: "Partnerships Manager",
      department_id: dept,
      hiring_manager_id: h.people.hod.employee_id,
      positions: 1,
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

  test("New Offer starts from the vacancy; the monthly total is checked against its range; one open offer an application", async () => {
    const appId = await applicant("Chidi");
    const start = await h.as("ops").get(`/recruitment/offers/draft?application_id=${appId}`);
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ candidate_name: "Chidi Okafor", job_title: "Partnerships Manager", salary_min: "400000.00", salary_max: "600000.00" });
    expect(start.body.pay_lines).toEqual([{ name: "Basic Salary", monthly_amount: "400000.00" }]);

    const outside = await h.as("ops").post("/recruitment/offers").send(terms(appId, ["700000.00", "0.00", "0.00"]));
    expect(outside.status).toBe(422);
    expect(outside.body.error.fields).toEqual({ range_reason: ["Say why"] });

    const made = await h.as("ops").post("/recruitment/offers").send(terms(appId));
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ status: "draft", currency: "NGN", monthly_total: "450000.00", annual_compensation: "5400000.00", outside_range: false, can_edit: true, can_submit: true, can_sign: false });
    expect(made.body.number).toMatch(/^OFF-\d{4}$/);
    expect(made.body.letter.join("\n")).toContain("Basic Salary · ₦400,000.00");
    expect(made.body.letter.join("\n")).toContain("Schedule A: Role Description");

    expect((await h.as("ops").post("/recruitment/offers").send(terms(appId))).body.error.code).toBe("OFFER_OPEN");
    // An application not yet at Shortlist takes no offer; staff do not reach Offers at all.
    const early = await applicant("Bisi", "interview");
    expect((await h.as("ops").post("/recruitment/offers").send(terms(early))).status).toBe(409);
    expect((await h.as("staff").get("/recruitment/offers")).status).toBe(403);

    const edited = await h.as("ops").patch(`/recruitment/offers/${made.body.offer_id}`).send({ pay_lines: [{ name: "Basic Salary", monthly_amount: "650000.00" }], range_reason: "Matched a competing offer" });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ outside_range: true, range_reason: "Matched a competing offer", monthly_total: "650000.00" });

    const list = await h.as("ops").get("/recruitment/offers?status=draft");
    expect(list.body.data.map((o) => o.offer_id)).toContain(made.body.offer_id);
    // The board's Offer column opens a card's offer by its application.
    const mine = await h.as("ops").get(`/recruitment/offers?application_id=${appId}`);
    expect(mine.body.data.map((o) => o.offer_id)).toEqual([made.body.offer_id]);
    expect((await h.as("ops").get(`/recruitment/offers?application_id=${early}`)).body.data).toEqual([]);
    expect((await h.as("ops").get("/recruitment/offers/summary")).body.drafts).toBeGreaterThanOrEqual(1);
  });

  test("Submit needs the Offer Signatory; approval generates the letter and opens its request; the signatory signs, then Send", async () => {
    const appId = await applicant("Emeka");
    const offer = (await h.as("ops").post("/recruitment/offers").send(terms(appId))).body;
    expect((await h.as("ops").post(`/recruitment/offers/${offer.offer_id}/submit`).send({})).body.error.code).toBe("NO_SIGNATORY");

    const named = await h.as("ops").put("/recruitment/offers/settings/signatory").send({ signatory_employee_id: h.people.ops.employee_id });
    expect(named.status).toBe(200);
    expect(named.body.signatory.display_name).toBe("Ada Obi");

    const after = await approved(offer.offer_id);
    expect(after).toMatchObject({ status: "approved", can_sign: true, can_send: false });
    expect(after.document).toBeTruthy();
    expect(after.signers.map((s) => [s.name, s.role, s.status])).toEqual([
      ["Ada Obi", "mycity", "pending"],
      ["Emeka Okafor", "candidate", "pending"],
    ]);
    expect(await one("SELECT terms_version, approved_at IS NOT NULL AS stamped FROM offer WHERE offer_id = $1", [offer.offer_id])).toEqual({ terms_version: 0, stamped: true });

    // Not before the company has signed; and only the signatory signs for it.
    expect((await h.as("ops").post(`/recruitment/offers/${offer.offer_id}/send`).send({})).body.error.code).toBe("NOT_SIGNED");
    expect((await h.as("hod").post(`/recruitment/offers/${offer.offer_id}/sign`).send({ full_name: "Ife Ojo", method: "type", typed: "Ife Ojo", consent: true })).status).toBe(403);

    const sent = await signedAndSent(offer.offer_id);
    expect(sent).toMatchObject({ status: "sent", can_resend: true, can_send: false });
    expect(sent.expires_at).toBeTruthy();
    // Send moves the card to the Offer column (candidates.advanceIn).
    expect(await one("SELECT stage FROM application WHERE application_id = $1", [appId])).toEqual({ stage: "offer" });
    const [mail] = mails("offer-sent").filter((m) => m.to.email === "emeka.okafor@example.test");
    expect(mail.data).toMatchObject({ vacancy_title: "Partnerships Manager", reference: offer.number });
    // No link is kept or sits in the outbox.
    const t = tokenOf(mail);
    expect(JSON.stringify((await one("SELECT coalesce(json_agg(payload), '[]'::json) AS p FROM event_log WHERE event_key LIKE 'offer.%'")).p)).not.toContain(t);

    // The candidate reads the same letter and signs: the offer is accepted, the copy sealed.
    const page = await pub().get(`/sign/${t}`);
    expect(page.status).toBe(200);
    expect(page.body.letter.join("\n")).toContain("Total Monthly Compensation");
    expect((await pub().post(`/sign/${t}/code`).send({})).status).toBe(200);
    expect((await pub().post(`/sign/${t}/code/verify`).send({ code: codesSent().pop() })).status).toBe(200);
    const signed = await pub().post(`/sign/${t}/sign`).send({ full_name: "Emeka Okafor", method: "draw", signature_png: PNG, consent: true });
    expect(signed.status).toBe(200);
    expect(signed.body.state).toBe("signed");
    await drain();
    const done = (await h.as("ops").get(`/recruitment/offers/${offer.offer_id}`)).body;
    expect(done).toMatchObject({ status: "accepted", can_withdraw: false });
    expect(done.document.document_id).not.toBe(after.document.document_id);
    const hashes = await one("SELECT array_agg(DISTINCT content_hash) AS h FROM signature WHERE signature_request_id = (SELECT signature_request_id FROM offer WHERE offer_id = $1)", [offer.offer_id]);
    expect(hashes.h).toHaveLength(1);
  }, 60_000);

  test("Send Offer is refused while the onboarding checklist has no required item", async () => {
    const appId = await applicant("Chidera");
    await requirements();
    await h.as("ops").put("/recruitment/offers/settings/signatory").send({ signatory_employee_id: h.people.ops.employee_id });
    const offer = (await h.as("ops").post("/recruitment/offers").send(terms(appId))).body;
    await approved(offer.offer_id);
    expect((await h.as("ops").post(`/recruitment/offers/${offer.offer_id}/sign`).send({ full_name: "Ada Obi", method: "type", typed: "Ada Obi", consent: true })).status).toBe(200);

    await pool.query("UPDATE document_requirement SET active = false");
    const refusedSend = await h.as("ops").post(`/recruitment/offers/${offer.offer_id}/send`).send({});
    expect(refusedSend.status).toBe(422);
    expect(refusedSend.body.error.code).toBe("NO_REQUIREMENTS");

    await requirements();
    expect((await h.as("ops").post(`/recruitment/offers/${offer.offer_id}/send`).send({})).status).toBe(200);
  }, 60_000);

  test("Submit needs the employment type and the work pattern: the employee is created from them", async () => {
    const appId = await applicant("Zainab");
    await h.as("ops").put("/recruitment/offers/settings/signatory").send({ signatory_employee_id: h.people.ops.employee_id });
    const offer = (await h.as("ops").post("/recruitment/offers").send(terms(appId))).body;
    // Edit Offer cannot clear it (an empty field leaves it as it was); a draft the assistant's card made
    // can lack it, as this one now does.
    await pool.query("UPDATE offer SET work_pattern = NULL WHERE offer_id = $1", [offer.offer_id]);
    const refusedSubmit = await h.as("ops").post(`/recruitment/offers/${offer.offer_id}/submit`).send({});
    expect(refusedSubmit.status).toBe(422);
    expect(refusedSubmit.body.error.code).toBe("NO_WORK_PATTERN");
  }, 60_000);

  test("acceptance makes the employee, the case and the contract in one transaction, then the hire signs", async () => {
    const appId = await applicant("Nkem");
    await requirements();
    await h.as("ops").put("/recruitment/offers/settings/signatory").send({ signatory_employee_id: h.people.ops.employee_id });
    const offer = (await h.as("ops").post("/recruitment/offers").send(terms(appId))).body;
    await approved(offer.offer_id);
    await signedAndSent(offer.offer_id);
    const [offerMail] = mails("offer-sent").filter((m) => m.to.email === "nkem.okafor@example.test");

    // The candidate signs: one transaction does the rest.
    const t = tokenOf(offerMail);
    expect((await pub().post(`/sign/${t}/code`).send({})).status).toBe(200);
    expect((await pub().post(`/sign/${t}/code/verify`).send({ code: codesSent().pop() })).status).toBe(200);
    expect((await pub().post(`/sign/${t}/sign`).send({ full_name: "Nkem Okafor", method: "draw", signature_png: PNG, consent: true })).status).toBe(200);
    await rendered();

    // The employee: no seat, no login; the candidate's address their personal email, where the hire's
    // mail goes, and the work email a placeholder of the offer's own until onboarding completes.
    const hire = await one(
      "SELECT staff_number, work_email::text AS work_email, personal_email::text AS personal_email, job_title, start_date::text AS start_date, employment_type, work_pattern, line_manager_id, confirmation_due_on::text AS confirmation_due_on FROM employee WHERE personal_email = $1",
      ["nkem.okafor@example.test"],
    );
    expect(hire).toMatchObject({
      work_email: `${offer.number.toLowerCase()}@hire.invalid`,
      personal_email: "nkem.okafor@example.test",
      job_title: "Partnerships Manager",
      employment_type: "full_time",
      work_pattern: "hybrid",
      line_manager_id: null,
    });
    expect(hire.staff_number).toBeTruthy();
    // Three months' probation from the start date, by the calendar (lagos.addMonths).
    expect(hire.confirmation_due_on).toBe(lagos.addMonths(hire.start_date, 3));
    expect(await one("SELECT count(*)::int AS n FROM app_user WHERE email = $1", ["nkem.okafor@example.test"])).toEqual({ n: 0 });

    // The card is at Documentation, not Hired: hireIn waits for Complete Onboarding (PR 6).
    expect(await one("SELECT stage, status FROM application WHERE application_id = $1", [appId])).toEqual({ stage: "documentation", status: "active" });

    // The case, with one checklist item for each active requirement.
    const kase = await one("SELECT onboarding_case_id, status, employee_id, starts_on FROM onboarding_case WHERE offer_id = $1", [offer.offer_id]);
    expect(kase.status).toBe("documentation");
    expect(kase.employee_id).toBeTruthy();
    const items = await one("SELECT count(*)::int AS n FROM onboarding_checklist_item WHERE onboarding_case_id = $1", [kase.onboarding_case_id]);
    // One item an active requirement: MyCity's New Joiner list (seed 5399) and the test's own.
    expect(items).toEqual(await one("SELECT count(*)::int AS n FROM document_requirement WHERE active = true"));

    // The contract: generated, waiting for the company, the hire second.
    const row = await one("SELECT employment_contract_id, number::text AS number, status FROM employment_contract WHERE onboarding_case_id = $1", [kase.onboarding_case_id]);
    expect(row.status).toBe("draft");
    expect(row.number).toMatch(/^CON-\d{4}$/);
    const contract = (await h.as("ops").get(`/recruitment/contracts/${row.employment_contract_id}`)).body;
    expect(contract).toMatchObject({ status: "draft", can_sign: true, can_resend: false });
    expect(contract.signers.map((x) => [x.role, x.status])).toEqual([
      ["mycity", "pending"],
      ["employee", "pending"],
    ]);

    // The candidate's sealed offer is offer-signed with the copy, not signature-completed.
    const sealed = mails("offer-signed").filter((m) => m.to.email === "nkem.okafor@example.test");
    expect(sealed).toHaveLength(1);
    expect(sealed[0].data).toMatchObject({ vacancy_title: "Partnerships Manager", reference: offer.number });
    expect(sealed[0].attachments).toHaveLength(1);
    expect(mails("signature-completed").filter((m) => m.to.email === "nkem.okafor@example.test")).toHaveLength(0);
    // The company's signatory still gets the service's own.
    expect(mails("signature-completed").filter((m) => m.to.email === "ops@mycity.test").length).toBeGreaterThan(0);

    // No contract link exists before the company signs.
    expect(mails("contract-sent")).toHaveLength(0);
    const tooEarly = await h.as("ops").post(`/recruitment/contracts/${row.employment_contract_id}/resend`).send({});
    expect(tooEarly.status).toBe(409);

    // Sign for Company: the hire's link is made and mailed.
    const companySigned = await h.as("ops").post(`/recruitment/contracts/${row.employment_contract_id}/sign`).send({ full_name: "Ada Obi", title: "Operations & People Lead", method: "type", typed: "Ada Obi", consent: true });
    expect(companySigned.status).toBe(200);
    expect(companySigned.body).toMatchObject({ status: "sent", can_sign: false, can_resend: true });
    const [contractMail] = mails("contract-sent").filter((m) => m.to.email === "nkem.okafor@example.test");
    expect(contractMail.data).toMatchObject({ vacancy_title: "Partnerships Manager", reference: row.number });

    // The hire signs their own link: the contract is signed and sealed.
    const ct = tokenOf(contractMail);
    const contractPage = await pub().get(`/sign/${ct}`);
    expect(contractPage.status).toBe(200);
    expect(contractPage.body.letter.join("\n")).toContain("Contract of Employment");
    expect((await pub().post(`/sign/${ct}/code`).send({})).status).toBe(200);
    expect((await pub().post(`/sign/${ct}/code/verify`).send({ code: codesSent().pop() })).status).toBe(200);
    expect((await pub().post(`/sign/${ct}/sign`).send({ full_name: "Nkem Okafor", method: "draw", signature_png: PNG, consent: true })).status).toBe(200);
    await drain();
    expect(await one("SELECT status FROM employment_contract WHERE employment_contract_id = $1", [row.employment_contract_id])).toEqual({ status: "signed" });
    // The case stays at documentation: the checklist is still owed (PR 6).
    expect(await one("SELECT status FROM onboarding_case WHERE onboarding_case_id = $1", [kase.onboarding_case_id])).toEqual({ status: "documentation" });
  }, 90_000);

  test("a refused send shows on the offer; Change Email corrects the address and sends a fresh link", async () => {
    const appId = await applicant("Ifunanya");
    await h.as("ops").put("/recruitment/offers/settings/signatory").send({ signatory_employee_id: h.people.ops.employee_id });
    const offer = (await h.as("ops").post("/recruitment/offers").send(terms(appId))).body;
    await approved(offer.offer_id);
    const sent = await signedAndSent(offer.offer_id);
    expect(sent).toMatchObject({ candidate_email: "ifunanya.okafor@example.test", send_refused_at: null, can_change_email: true });
    const [first] = mails("offer-sent").filter((m) => m.to.email === "ifunanya.okafor@example.test");
    const oldToken = tokenOf(first);

    // The mail server refused the address for good (system mail keeps it on Refused Addresses).
    await require("../../src/shared/integrations/refusals").record({ emails: ["ifunanya.okafor@example.test"], template: "offer-sent", smtp_code: 550, reply: "no such user" });
    const refusedNow = (await h.as("ops").get(`/recruitment/offers/${offer.offer_id}`)).body;
    expect(refusedNow.send_refused_at).toBeTruthy();

    // An address another candidate holds is refused; a good one is put on the candidate and the signer.
    const other = await applicant("Bola");
    const taken = await one("SELECT k.email::text AS email FROM application a JOIN candidate k USING (candidate_id) WHERE a.application_id = $1", [other]);
    const clash = await h.as("ops").post(`/recruitment/offers/${offer.offer_id}/recipient`).send({ email: taken.email });
    expect(clash.status).toBe(409);
    expect(clash.body.error.fields).toEqual({ email: ["Another candidate has it"] });

    const fixed = await h.as("ops").post(`/recruitment/offers/${offer.offer_id}/recipient`).send({ email: "ifunanya.okafor@example.org" });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ candidate_email: "ifunanya.okafor@example.org", send_refused_at: null, status: "sent" });
    expect(await one("SELECT k.email::text AS email FROM application a JOIN candidate k USING (candidate_id) WHERE a.application_id = $1", [appId])).toEqual({ email: "ifunanya.okafor@example.org" });
    expect(await one("SELECT signer_email::text AS e FROM signature WHERE signature_request_id = (SELECT signature_request_id FROM offer WHERE offer_id = $1) AND signer_role = 'candidate'", [offer.offer_id])).toEqual({ e: "ifunanya.okafor@example.org" });
    const [again] = mails("offer-sent").filter((m) => m.to.email === "ifunanya.okafor@example.org");
    expect(again).toBeTruthy();
    // The old link stops working; the new one opens the offer.
    expect((await pub().get(`/sign/${oldToken}`)).status).toBe(404);
    expect((await pub().get(`/sign/${tokenOf(again)}`)).status).toBe(200);
    // Only a sent offer's address is changed here.
    const draft = (await h.as("ops").post("/recruitment/offers").send(terms(await applicant("Tayo")))).body;
    expect((await h.as("ops").post(`/recruitment/offers/${draft.offer_id}/recipient`).send({ email: "tayo@example.org" })).body.error.code).toBe("NOT_SENT");
  }, 60_000);

  test("Rejected returns to draft with the reason; a declined offer ends and the application takes a new one", async () => {
    const appId = await applicant("Ngozi");
    const offer = (await h.as("ops").post("/recruitment/offers").send(terms(appId))).body;
    const sub = await h.as("ops").post(`/recruitment/offers/${offer.offer_id}/submit`).send({});
    expect((await h.as("hod").post(`/workflow/instances/${sub.body.workflow_instance_id}/reject`).send({ reason: "Start a week later" })).status).toBe(200);
    await drain();
    const back = (await h.as("ops").get(`/recruitment/offers/${offer.offer_id}`)).body;
    expect(back).toMatchObject({ status: "draft", end_reason: "Start a week later", can_submit: true });

    await approved(offer.offer_id);
    await signedAndSent(offer.offer_id);
    const t = tokenOf(mails("offer-sent").filter((m) => m.to.email === "ngozi.okafor@example.test").pop());
    const declined = await pub().post(`/sign/${t}/decline`).send({ reason: "I accepted another role." });
    expect(declined.status).toBe(200);
    const ended = (await h.as("ops").get(`/recruitment/offers/${offer.offer_id}`)).body;
    expect(ended).toMatchObject({ status: "declined", end_reason: "I accepted another role." });
    // The card went back from Offer to Shortlist with the reason, and a new offer may be made.
    expect(await one("SELECT stage FROM application WHERE application_id = $1", [appId])).toEqual({ stage: "shortlist" });
    expect((await h.as("ops").post("/recruitment/offers").send(terms(appId))).status).toBe(201);
  }, 60_000);

  test("Withdraw ends the link (read only, on Offer Withdrawn); Not Progressing withdraws the application's open offer", async () => {
    const appId = await applicant("Kemi");
    const offer = (await h.as("ops").post("/recruitment/offers").send(terms(appId))).body;
    await approved(offer.offer_id);
    await signedAndSent(offer.offer_id);
    const t = tokenOf(mails("offer-sent").filter((m) => m.to.email === "kemi.okafor@example.test").pop());
    const out = await h.as("ops").post(`/recruitment/offers/${offer.offer_id}/withdraw`).send({ reason: "The role was put on hold." });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: "withdrawn", end_reason: "The role was put on hold." });
    // The link opens on Offer Withdrawn, read only, without the letter (AJ, 13/11/2026).
    expect((await pub().get(`/sign/${t}`)).body).toMatchObject({ state: "withdrawn", letter: [] });
    expect(await one("SELECT stage FROM application WHERE application_id = $1", [appId])).toEqual({ stage: "shortlist" });

    const other = await applicant("Femi");
    const draftOffer = (await h.as("ops").post("/recruitment/offers").send(terms(other))).body;
    expect((await h.as("ops").post(`/recruitment/candidates/${other}/not-progressed`).send({ rejection_reason: "The role was filled by another candidate." })).status).toBe(200);
    await drain();
    expect(await one("SELECT status, end_reason FROM offer WHERE offer_id = $1", [draftOffer.offer_id])).toEqual({ status: "withdrawn", end_reason: "The candidate was not progressed" });
  }, 60_000);

  test("Offers settings: the standard wording is checked against its variables, saved as a version and restored", async () => {
    const start = await h.as("ops").get("/recruitment/offers/settings/letter");
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ version: 0, is_default: true });
    expect(start.body.variables).toEqual(expect.arrayContaining(["job_title", "pay_lines", "monthly_total"]));
    const bad = await h.as("ops").put("/recruitment/offers/settings/letter").send({ body: `${start.body.body}\n\n{{ salary_band }}` });
    expect(bad.status).toBe(422);
    const saved = await h.as("ops").put("/recruitment/offers/settings/letter").send({ body: `${start.body.body}\n\nWe look forward to working with you.` });
    expect(saved.body).toMatchObject({ version: 1, is_default: false });
    const restored = await h.as("ops").post("/recruitment/offers/settings/letter/restore").send({});
    expect(restored.body).toMatchObject({ version: 2, body: start.body.body });
  });

  test("offers.create: New Offer as the assistant's card drafts from the vacancy with the basic salary given", async () => {
    const manifest = require("../../src/modules/offers/offers.ai");
    const action = manifest.actions.find((a) => a.key === "offers.create");
    expect(action).toBeTruthy();
    const appId = await applicant("Tolu");
    const offer = await action.run(
      { application_id: appId, start_date: lagos.addDays(lagos.today(), 30), basic_salary: "450000.00" },
      { ...h.people.ops, scope: { scope: "all", scope_ids: null } },
    );
    expect(offer).toMatchObject({ status: "draft", job_title: "Partnerships Manager", monthly_total: "450000.00", outside_range: false });
    expect(offer.pay_lines.map((l) => l.name)).toEqual(["Basic Salary"]);
  });

  test("offers.create outside the vacancy's range asks for the reason, never a stock one", async () => {
    const action = require("../../src/modules/offers/offers.ai").actions.find((a) => a.key === "offers.create");
    const actor = { ...h.people.ops, scope: { scope: "all", scope_ids: null } };
    const appId = await applicant("Yemi");
    const card = { application_id: appId, start_date: lagos.addDays(lagos.today(), 30), basic_salary: "750000.00" };
    await expect(action.run(card, actor)).rejects.toMatchObject({ code: "RANGE_REASON", fields: { range_reason: expect.any(Array) } });
    expect(schemas.offers.OfferCard.safeParse({ ...card, range_reason: "Matched a competing offer." }).success).toBe(true);
    const offer = await action.run({ ...card, range_reason: "Matched a competing offer." }, actor);
    expect(offer).toMatchObject({ outside_range: true, range_reason: "Matched a competing offer." });
  });

  test("a vacancy typed contract or internship makes an offer in the employee's spellings, which acceptance takes", async () => {
    const dept = (await one("SELECT department_id FROM department WHERE name = 'Partnerships'")).department_id;
    for (const [type, expected, first] of [["contract", "contractor", "Obi"], ["internship", "intern", "Ada"]]) {
      const v = await h.as("ops").post("/recruitment/vacancies").send({
        title: `Field Producer (${type})`,
        department_id: dept,
        hiring_manager_id: h.people.hod.employee_id,
        positions: 1,
        employment_type: type,
        work_pattern: "on_site",
        location: { token: area("Ikeja, Lagos") },
        salary_min: "150000.00",
        salary_max: "250000.00",
        description: "Produces the short field videos that show each venue in the city guides at its best.",
        requirements: "A portfolio of short-form video.",
        closes_on: lagos.addDays(lagos.today(), 30),
        publish: true,
      });
      expect(v.status).toBe(201);
      n += 1;
      const email = `${first.toLowerCase()}.${type}@example.test`;
      const k = await one("INSERT INTO candidate (first_name, last_name, email) VALUES ($1, 'Nwosu', $2) RETURNING candidate_id", [first, email]);
      const a = await one(
        "INSERT INTO application (number, vacancy_id, candidate_id, source, stage, status) VALUES ($1, $2, $3, 'careers', 'shortlist', 'active') RETURNING application_id",
        [`APP-${String(900 + n).padStart(4, "0")}`, v.body.vacancy_id, k.candidate_id],
      );
      const d = await h.as("ops").get(`/recruitment/offers/draft?application_id=${a.application_id}`);
      expect(d.status).toBe(200);
      expect(d.body.employment_type).toBe(expected);
      const made = await h.as("ops").post("/recruitment/offers").send({
        ...terms(a.application_id, ["200000.00", "0.00", "0.00"]),
        job_title: `Field Producer (${type})`,
        employment_type: d.body.employment_type,
        work_pattern: "on_site",
        office_days: null,
      });
      expect(made.status).toBe(201);
      await approved(made.body.offer_id);
      await signedAndSent(made.body.offer_id);
      const t = tokenOf(mails("offer-sent").filter((m) => m.to.email === email).pop());
      expect((await pub().post(`/sign/${t}/code`).send({})).status).toBe(200);
      expect((await pub().post(`/sign/${t}/code/verify`).send({ code: codesSent().pop() })).status).toBe(200);
      expect((await pub().post(`/sign/${t}/sign`).send({ full_name: `${first} Nwosu`, method: "type", typed: `${first} Nwosu`, consent: true })).status).toBe(200);
      expect(await one("SELECT status FROM offer WHERE offer_id = $1", [made.body.offer_id])).toEqual({ status: "accepted" });
      expect(await one("SELECT employment_type FROM employee WHERE personal_email = $1", [email])).toEqual({ employment_type: expected });
    }
  }, 180_000);

  test("Send Offer refuses someone already on the staff: acceptance would make them a second record", async () => {
    n += 1;
    const k = await one("INSERT INTO candidate (first_name, last_name, email) VALUES ('Tunde', 'Ade', 'tunde@mycity.test') RETURNING candidate_id");
    const a = await one(
      "INSERT INTO application (number, vacancy_id, candidate_id, source, stage, status) VALUES ($1, $2, $3, 'invited', 'shortlist', 'active') RETURNING application_id",
      [`APP-${String(900 + n).padStart(4, "0")}`, vacancyId, k.candidate_id],
    );
    const offer = (await h.as("ops").post("/recruitment/offers").send(terms(a.application_id))).body;
    await approved(offer.offer_id);
    await requirements();
    expect((await h.as("ops").post(`/recruitment/offers/${offer.offer_id}/sign`).send({ full_name: "Ada Obi", method: "type", typed: "Ada Obi", consent: true })).status).toBe(200);
    const sent = await h.as("ops").post(`/recruitment/offers/${offer.offer_id}/send`).send({});
    expect(sent.status).toBe(409);
    expect(sent.body.error).toMatchObject({ code: "CANDIDATE_IS_EMPLOYEE", message: "This candidate is already an employee" });
    expect(await one("SELECT status FROM offer WHERE offer_id = $1", [offer.offer_id])).toEqual({ status: "approved" });
  }, 90_000);

  test("a refusal at acceptance reaches the candidate as a plain retry, never another person's record", async () => {
    const appId = await applicant("Bayo");
    const offer = (await h.as("ops").post("/recruitment/offers").send(terms(appId))).body;
    await approved(offer.offer_id);
    await signedAndSent(offer.offer_id);
    // Someone already holds the address acceptance would give the hire: organisation refuses it.
    await pool.query("UPDATE employee SET work_email = $2 WHERE employee_id = $1", [h.people.staff.employee_id, `${offer.number.toLowerCase()}@hire.invalid`]);
    try {
      const t = tokenOf(mails("offer-sent").filter((m) => m.to.email === "bayo.okafor@example.test").pop());
      expect((await pub().post(`/sign/${t}/code`).send({})).status).toBe(200);
      expect((await pub().post(`/sign/${t}/code/verify`).send({ code: codesSent().pop() })).status).toBe(200);
      const signed = await pub().post(`/sign/${t}/sign`).send({ full_name: "Bayo Okafor", method: "type", typed: "Bayo Okafor", consent: true });
      expect(signed.status).toBe(409);
      expect(signed.body.error).toMatchObject({ code: "NOT_ACCEPTED", message: "We could not take your signature. Try again." });
      expect(JSON.stringify(signed.body)).not.toMatch(/employee|work email|archived/i);
      expect(await one("SELECT status FROM offer WHERE offer_id = $1", [offer.offer_id])).toEqual({ status: "sent" });
    } finally {
      await pool.query("UPDATE employee SET work_email = 'tunde@mycity.test' WHERE employee_id = $1", [h.people.staff.employee_id]);
    }
  }, 90_000);

  test("with its approval, Withdraw shows only for its submitter or the CEO, as the engine allows", async () => {
    const appId = await applicant("Sade");
    const made = (await h.as("ops").post("/recruitment/offers").send(terms(appId))).body;
    const sub = await h.as("ops").post(`/recruitment/offers/${made.offer_id}/submit`).send({});
    expect(sub.body).toMatchObject({ status: "approval", can_withdraw: true });
    // The Head of Department edits this vacancy's offers, but did not submit this one.
    expect((await h.as("hod").get(`/recruitment/offers/${made.offer_id}`)).body.can_withdraw).toBe(false);
    expect((await h.as("ceo").get(`/recruitment/offers/${made.offer_id}`)).body.can_withdraw).toBe(true);
    // Settings are Operations & People's: the summary says so, and the routes refuse a team grant.
    expect((await h.as("ops").get("/recruitment/offers/summary")).body.can_configure).toBe(true);
    expect((await h.as("hod").get("/recruitment/offers/summary")).body.can_configure).toBe(false);
    expect((await h.as("hod").get("/recruitment/offers/settings")).status).toBe(403);
    expect((await h.as("hod").put("/recruitment/offers/settings/signatory").send({ signatory_employee_id: h.people.hod.employee_id })).status).toBe(403);
  });

  test("approved while the signatory had no login: the signatory named later opens the letter by signing", async () => {
    await h.as("ops").put("/recruitment/offers/settings/signatory").send({ signatory_employee_id: h.people.ops.employee_id });
    const appId = await applicant("Uche");
    const made = (await h.as("ops").post("/recruitment/offers").send(terms(appId))).body;
    const sub = await h.as("ops").post(`/recruitment/offers/${made.offer_id}/submit`).send({});
    expect(sub.status).toBe(200);
    // The setting names someone with no login while the approval runs.
    const setting = await one("SELECT value FROM setting WHERE key = 'recruitment.offer_signatory'");
    await pool.query("UPDATE setting SET value = $1::jsonb WHERE key = 'recruitment.offer_signatory'", [JSON.stringify({ employee_id: h.people.staff.employee_id })]);
    await pool.query("UPDATE app_user SET status = 'suspended' WHERE user_id = $1", [h.people.staff.user_id]);
    try {
      expect((await h.as("hod").post(`/workflow/instances/${sub.body.workflow_instance_id}/approve`).send({})).status).toBe(200);
      expect((await h.as("ceo").post(`/workflow/instances/${sub.body.workflow_instance_id}/approve`).send({})).status).toBe(200);
      await drain();
    } finally {
      await pool.query("UPDATE app_user SET status = 'active' WHERE user_id = $1", [h.people.staff.user_id]);
      await pool.query("UPDATE setting SET value = $1::jsonb WHERE key = 'recruitment.offer_signatory'", [JSON.stringify(setting.value)]);
    }
    const approvedOffer = (await h.as("ops").get(`/recruitment/offers/${made.offer_id}`)).body;
    expect(approvedOffer).toMatchObject({ status: "approved", signers: [], can_sign: true });
    const signed = await h.as("ops").post(`/recruitment/offers/${made.offer_id}/sign`).send({ full_name: "Ada Obi", method: "type", typed: "Ada Obi", consent: true });
    expect(signed.status).toBe(200);
    expect(signed.body.signers.map((x) => [x.role, x.status])).toEqual([
      ["mycity", "signed"],
      ["candidate", "pending"],
    ]);
    expect(signed.body.can_send).toBe(true);
  }, 90_000);
});
