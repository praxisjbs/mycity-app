"use strict";
/**
 * Partnerships · agreements end to end (docs/guides/partnerships.md §6.8, §6.9, Appendix A PR 6): the real
 * migrations on a throwaway database, the whole app through HTTP, every response parsed with its contract
 * (APP_ENV=test). Generate Agreement from a category's template, Draft, Submit, the Partner Agreement flow
 * through the approval engine, Send for Signature, the public signing page with its emailed code and a drawn
 * signature, the seal and both verdicts, conversion on signing, a decline and Send Again, a signed copy on
 * paper, the daily job's dates, scope and Close. The mail queue is mocked: what is queued is what would be
 * sent; the PDF renderer is a stand-in, enough for the hashes.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/partnerships-agreements
 *
 * MyCity's stages and the Events category are entered here as Categories enters them (A26). Every
 * organisation and person is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const queues = require("../../src/jobs/queues");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const documents = require("../../src/shared/documents/generate");
const storage = require("../../src/services/storage/storage.service");
const vault = require("../../src/shared/documents/vault");
const renewals = require("../../src/modules/agreements/agreements.renewals");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0] || null;
const PASSWORD = "Agreements-Sealed7Copy";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
/** A 1x1 PNG, as the pad would send a (very small) signature. */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const STAGES = [
  ["prospect_identified", "Prospect Identified", "prospect"],
  ["initial_contact", "Initial Contact", "contacted"],
  ["proposal_sent", "Proposal Sent", "proposal"],
  ["negotiation", "Negotiation", "negotiation"],
  ["partnership_signed", "Partnership Signed", "signed"],
  ["active_partnership", "Active Partnership", "active"],
  ["closed_lost", "Closed Lost", "closed_lost"],
  ["on_hold", "On Hold", "on_hold"],
];

const chip = (field) => `<span data-field="${field}">{{ ${field} }}</span>`;
/** The Events category's Deal Merchant Agreement as the template editor saves it (§6.8). */
const WORDING = [
  "<h2>Deal Merchant Agreement</h2>",
  `<p>Date: <span data-field="today">{{ longdate today }}</span></p>`,
  `<p>Business Name: ${chip("partner.name")}</p>`,
  `<p>Contact person: ${chip("contact.full_name")}</p>`,
  `<p>Event: ${chip("deal.event_title")}</p>`,
  `<p>Opening hours: ${chip("ask.opening_hours")}</p>`,
  "<h2>Financials</h2>",
  `<p>${chip("deal.options")}</p>`,
  "<h2>Fine Print</h2>",
  `<p>${chip("category.checklist")}</p>`,
  "<p>The above prices, specifications and conditions are hereby accepted by both parties.</p>",
  `<p>Name of Representative: ${chip("signer.name")}</p>`,
  `<p>Signature: ${chip("signer.signature")}</p>`,
].join("");
const ASKS = [{ key: "opening_hours", label: "Opening Hours", type: "text", default: "24hrs" }];

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

async function drain() {
  for (let i = 0; i < 12; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

/** The worker's PDF render, with a stand-in for Chromium: each pending document stored and hashed. */
async function renderAll() {
  const { rows } = await q("SELECT document_id FROM document WHERE render_status = 'pending' ORDER BY created_at");
  for (const r of rows) await documents.renderPending(r.document_id, { db: pool, renderPdf: async (html) => Buffer.concat([PDF, Buffer.from(`% ${html.length}\n`)]) });
  await drain();
}

const mails = (template) => queues.enqueue.mock.calls.filter((c) => c[0] === "email-send" && c[1] === template).map((c) => c[2]);
const tokenOf = (url) => String(url).split("/").pop();
const lastCode = () => mails("signature-code").pop().data.code;

describeDb("partnerships: agreements, approval, signing and verification", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;
  let category;
  let countersignedKey;

  const nextIp = () => {
    ip += 1;
    return `10.76.${Math.floor(ip / 250)}.${(ip % 250) + 1}`;
  };
  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", nextIp());
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path, body = {}) => auth(request(app).post(`/api/v1${path}`)).send(body),
      patch: (path, body = {}) => auth(request(app).patch(`/api/v1${path}`)).send(body),
      upload: (name) => auth(request(app).post("/api/v1/documents")).attach("file", PDF, { filename: name, contentType: "application/pdf" }),
    };
  };
  const pub = () => ({
    get: (path) => request(app).get(`/api/public/v1${path}`).set("X-Forwarded-For", nextIp()),
    post: (path, body = {}) =>
      request(app).post(`/api/public/v1${path}`).set("X-Forwarded-For", nextIp()).set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari/604.1").send(body),
  });
  const emp = (who) => people[who].employee.employee_id;
  const ok = (res, status = 200) => {
    expect([res.status, res.body.error]).toEqual([status, undefined]);
    return res.body;
  };

  /** A lead with its deal, owned by the Growth officer, and its signatory contact. */
  async function newLead(name, deal = {}) {
    return ok(
      await as("staff").post("/partnerships/leads", {
        name,
        partner_category_id: category,
        region: { scope: "national" },
        owner_id: emp("staff"),
        contact: { first_name: "Ngozi", last_name: "Adebayo", job_title: "Founder", email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.test`, signatory: true },
        deal: {
          title: `${name} Partnership`,
          owner_id: emp("staff"),
          estimated_value: "2500000.00",
          options: [{ position: 1, label: "Regular", original_price: "12000.00", discount_pct: "10", deal_price: "10800.00" }],
          ...deal,
        },
      }),
      201,
    );
  }

  /** Generate, fill, submit and approve (Head of Department, then the CEO): an approved agreement. */
  async function approved(name, generate = {}) {
    const lead = await newLead(name, { event_title: `${name} Festival` });
    const made = ok(await as("staff").post("/partnerships/agreements", { deal_id: lead.deal.deal_id, ...generate }), 201);
    ok(await as("staff").patch(`/partnerships/agreements/${made.partnership_agreement_id}`, { starts_on: "2026-12-01", ends_on: "2027-11-30" }));
    const sent = ok(await as("staff").post(`/partnerships/agreements/${made.partnership_agreement_id}/submit`));
    ok(await as("hod").post(`/workflow/instances/${sent.workflow_instance_id}/approve`));
    await drain();
    ok(await as("ceo").post(`/workflow/instances/${sent.workflow_instance_id}/approve`));
    await drain();
    return { lead, a: ok(await as("staff").get(`/partnerships/agreements/${made.partnership_agreement_id}`)) };
  }

  /** The partner proves the email and draws their signature on the page their link opens. */
  async function partnerSigns(token, name = "Ngozi Adebayo") {
    ok(await pub().post(`/sign/${token}/code`));
    ok(await pub().post(`/sign/${token}/code/verify`, { code: lastCode() }));
    return ok(await pub().post(`/sign/${token}/sign`, { full_name: name, title: "Founder", method: "draw", signature_png: PNG, consent: true }));
  }

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const sample = (first, last, email, job, department) => ({
      first_name: first, last_name: last, work_email: email, phone: "08031234567", job_title: job, department_name: department,
      start_date: "2026-01-05", employment_type: "full_time", work_pattern: "on_site",
    });
    const make = (key, first, last, role, job, department = "Growth", isCeo = false) =>
      tx(async (client) => {
        people[key] = await createAdmin(client, { employee: sample(first, last, `${key}@mycity.test`, job, department), role_code: role, is_ceo: isCeo }, PASSWORD, { allowAdditional: true });
      });
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("ceo", "Ada", "Okafor", "management", "Chief Executive Officer", "Management", true);
    await make("hod", "Kemi", "Alade", "head_of_department", "Head of Growth");
    await make("staff", "Musa", "Danjuma", "employee", "Growth Officer");
    await make("other", "Zainab", "Lawal", "employee", "Brand Officer", "Marketing");
    await q("UPDATE department SET head_employee_id = $1 WHERE name = 'Growth'", [emp("hod")]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("hod"), emp("staff")]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    for (const [i, [code, label, meaning]] of STAGES.entries()) {
      await q(
        `INSERT INTO reference_value (domain, code, label, display_order, metadata) VALUES ('partnership_stage', $1, $2, $3, $4::jsonb)
         ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, metadata = EXCLUDED.metadata, active = true`,
        [code, label, (i + 1) * 10, JSON.stringify({ meaning })],
      );
    }
    await q("UPDATE reference_value SET active = false WHERE domain = 'partnership_stage' AND metadata = '{}'::jsonb");
    await drain();
    for (const key of Object.keys(people)) {
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", nextIp()).send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
    // The Events category, its delivery checklist and two templates, as Categories enters them.
    category = ok(await as("ops").post("/partnerships/categories", { name: "Event", default_commission_pct: "8", default_validity_days: 30 }), 201).partner_category_id;
    ok(await as("ops").post(`/partnerships/categories/${category}/checklist`, { title: "Event registration and check-in on MyCityApp", due_from: "signing", due_days: 7 }), 201);
    ok(await as("ops").post(`/partnerships/categories/${category}/templates`, { kind: "deal_merchant", label: "Deal Merchant Agreement", body_html: WORDING, asks: ASKS, is_default: true }), 201);
    const withCounter = ok(await as("ops").post(`/partnerships/categories/${category}/templates`, { kind: "mou", label: "Events MOU", body_html: WORDING, asks: ASKS, is_default: true, countersigned: true }), 201);
    countersignedKey = withCounter.templates.find((t) => t.kind === "mou").template_key;
  }, 180_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("an agreement runs its lifecycle to signed: generated, approved, signed on the page, sealed, verified, and its lead converted", async () => {
    const lead = await newLead("Harbour Lights");
    // Generate Agreement: the category's default template filled from the record; an empty field kept as its chip.
    const draft = ok(await as("staff").post("/partnerships/agreements", { deal_id: lead.deal.deal_id }), 201);
    expect(draft).toMatchObject({ status: "draft", kind: "deal_merchant", record: { type: "lead", name: "Harbour Lights" }, missing_fields: ["Event Title"], approval: null, signers: [] });
    expect(draft.number).toMatch(/^AGR-\d{4}-0001$/);
    expect(draft.template_version).toBe(1);
    expect(draft.body_html).toContain("Harbour Lights");
    expect(draft.body_html).toContain('data-field="deal.event_title"');
    expect(draft.fields).toMatchObject({ "partner.name": "Harbour Lights", "contact.full_name": "Ngozi Adebayo", "ask.opening_hours": "24hrs" });
    // The options as a table, the checklist as numbered clauses, the signer's names kept for signing.
    const table = draft.blocks.find((b) => b.kind === "table");
    expect(table.head.map((c) => c.map((s) => s.text).join(""))).toEqual(["", "Regular"]);
    expect(table.rows.map((r) => r[0].map((s) => s.text).join(""))).toEqual(["Original Price", "Discount", "Deal Price", "MyCity's Commission per Sale", "Merchant's Take per Sale"]);
    expect(draft.blocks.some((b) => b.kind === "numbered" && b.items[0][0].text.startsWith("Event registration"))).toBe(true);
    expect(JSON.stringify(draft.blocks)).toContain("[Event Title]");

    // Submit names what is empty; the start comes first too.
    const id = draft.partnership_agreement_id;
    const refused = await as("staff").post(`/partnerships/agreements/${id}/submit`);
    expect([refused.status, refused.body.error.code, refused.body.error.message]).toEqual([422, "FIELDS_MISSING", "Fill Event Title first"]);
    const filled = ok(await as("staff").patch(`/partnerships/agreements/${id}`, { fields: { "deal.event_title": "Harbour Lights Festival" } }));
    expect(filled.missing_fields).toEqual([]);
    expect(filled.body_html).toContain("Harbour Lights Festival");
    expect((await as("staff").post(`/partnerships/agreements/${id}/submit`)).body.error.fields).toEqual({ starts_on: ["Set the start date"] });
    ok(await as("staff").patch(`/partnerships/agreements/${id}`, { starts_on: "2026-12-01", ends_on: "2027-11-30", renewal_notice_days: 60 }));

    // The Partner Agreement flow: the Head of Department of the owner's department, then the CEO.
    const review = ok(await as("staff").post(`/partnerships/agreements/${id}/submit`));
    expect(review).toMatchObject({ status: "review", approval: { state: "waiting", stage: "Head of Department", waiting_on: "Kemi Alade" }, body_html: null });
    expect((await as("staff").post(`/partnerships/agreements/${id}/send`, { signers: review.suggested_signers, confirm: true })).body.error.code).toBe("NOT_APPROVED");
    expect((await as("staff").patch(`/partnerships/agreements/${id}`, { starts_on: "2026-12-02" })).body.error.code).toBe("NOT_DRAFT");
    ok(await as("hod").post(`/workflow/instances/${review.workflow_instance_id}/approve`));
    await drain();
    expect(ok(await as("staff").get(`/partnerships/agreements/${id}`))).toMatchObject({ status: "approval", approval: { state: "waiting", stage: "CEO" } });
    ok(await as("ceo").post(`/workflow/instances/${review.workflow_instance_id}/approve`));
    await drain();
    const approvedOne = ok(await as("staff").get(`/partnerships/agreements/${id}`));
    expect(approvedOne).toMatchObject({ status: "approval", approval: { state: "approved", stage: null, waiting_on: null }, countersigned: false });
    expect(approvedOne.suggested_signers).toEqual([{ contact_id: expect.any(String), name: "Ngozi Adebayo", title: "Founder", email: "harbour.lights@example.test", side: "partner" }]);

    // Send for Signature: the PDF rendered, the request opened, the link mailed after commit.
    queues.enqueue.mockClear();
    const sent = ok(await as("staff").post(`/partnerships/agreements/${id}/send`, { signers: approvedOne.suggested_signers, message: "Looking forward to the festival.", confirm: true }));
    expect(sent).toMatchObject({ status: "sent", signing: { status: "pending", end_reason: null }, signers: [{ name: "Ngozi Adebayo", side: "partner", state: "sent", method: null }] });
    expect(sent.document).toMatchObject({ mime_type: "application/pdf" });
    const link = mails("agreement-sign")[0];
    expect(link).toMatchObject({ to: { email: "harbour.lights@example.test" }, data: { reference: sent.number, record_name: "Harbour Lights", message: "Looking forward to the festival.", after: null } });
    await renderAll();

    // The signing page: the agreement as it will be signed, its heading following the document.
    const token = tokenOf(link.data.sign_url);
    const page = ok(await pub().get(`/sign/${token}`));
    expect(page).toMatchObject({ document_type: "agreement", reference: sent.number, state: "awaiting", signer_name: "Ngozi Adebayo" });
    expect(page.blocks.some((b) => b.kind === "table")).toBe(true);
    expect(page.letter.join(" ")).toContain("Harbour Lights Festival");
    await drain();
    expect(ok(await as("staff").get(`/partnerships/agreements/${id}`)).status).toBe("viewed");

    const signed = await partnerSigns(token);
    expect(signed.state).toBe("signed");
    // Signed in the same transaction: the deal at MyCity's first signed stage, the lead now a partner.
    const now = ok(await as("staff").get(`/partnerships/agreements/${id}`));
    expect(now).toMatchObject({ status: "signed", record: { type: "partner", name: "Harbour Lights" }, signed_outside: false });
    const deal = await one("SELECT stage, status, partner_id FROM partnership_opportunity WHERE partnership_opportunity_id = $1", [lead.deal.deal_id]);
    expect(deal).toMatchObject({ stage: "partnership_signed", status: "live" });
    expect((await one("SELECT status, converted_partner_id FROM lead WHERE lead_id = $1", [lead.lead.lead_id])).converted_partner_id).toBe(deal.partner_id);
    expect((await one("SELECT source FROM partnership_stage_history WHERE partnership_opportunity_id = $1 AND to_stage = 'partnership_signed'", [lead.deal.deal_id])).source).toBe("signature");

    // The seal: generated from the outbox, rendered, hashed, filed with the partner's documents, mailed to the signer and the owner.
    await drain();
    const sealing = await one("SELECT d.document_id, d.render_html FROM document d WHERE d.entity_type = 'agreement' AND d.entity_id = $1 AND d.render_status = 'pending'", [id]);
    const key = /\/verify\/t\/([A-Za-z0-9_-]{43})/.exec(sealing.render_html)[1];
    expect(sealing.render_html).toContain('class="lh-meta-qr"');
    expect(sealing.render_html).toContain('class="doc-signature"');
    await renderAll();
    const sealed = ok(await as("staff").get(`/partnerships/agreements/${id}`));
    expect(sealed.signed_document.document_id).toBe(sealing.document_id);
    expect(sealed.verify).toMatchObject({ reference: sent.number, url: expect.stringMatching(new RegExp(`/verify/${sent.number}$`)), qr: expect.stringMatching(/^data:image\/png;base64,/) });
    const docs = ok(await as("staff").get(`/partnerships/documents?partner_id=${deal.partner_id}`));
    expect(docs.data.map((d) => d.origin)).toContain("agreement");
    expect(mails("signature-completed").map((m) => m.to.email).sort()).toEqual(["harbour.lights@example.test", "staff@mycity.test"]);
    expect((await as("staff").get(`/partnerships/agreements/${id}/document`)).status).toBe(200);

    // Verification by reference: status, signers and the two verdicts, never the content.
    const byRef = ok(await pub().get(`/verify/${sent.number.toLowerCase()}`));
    expect(byRef).toMatchObject({ document_type: "agreement", status: "completed", record_status: "signed", content: "matches", artifact: "matches", signed_outside: false });
    expect(byRef.signers).toEqual([expect.objectContaining({ name: "Ngozi Adebayo", role: "partner", status: "signed", method: "draw" })]);
    expect(byRef.document).toBeUndefined();
    expect(JSON.stringify(byRef)).not.toContain("Harbour Lights Festival");
    // From the QR: the document too, as blocks.
    const byKey = ok(await pub().get(`/verify/t/${key}`));
    expect(byKey.document.blocks.some((b) => b.kind === "table")).toBe(true);
    expect(byKey.document.letter.join(" ")).toContain("Signed electronically");

    // content_hash recomputes from the agreement; artifact_hash is over the stored bytes.
    await q("UPDATE partnership_agreement SET body = body || ' ' WHERE partnership_agreement_id = $1", [id]);
    expect(ok(await pub().get(`/verify/${sent.number}`)).content).toBe("differs");
    await q("UPDATE partnership_agreement SET body = rtrim(body, ' ') WHERE partnership_agreement_id = $1", [id]);
    expect(ok(await pub().get(`/verify/${sent.number}`)).content).toBe("matches");
    const stored = await vault.get(pool, sealing.document_id);
    await storage.put(stored.storage_key, Buffer.concat([PDF, Buffer.from("% altered\n")]), { overwrite: true });
    expect(ok(await pub().get(`/verify/${sent.number}`)).artifact).toBe("differs");
  }, 120_000);

  test("countersigned: the partner first, MyCity second; a decline returns it to sent, voids the partner's signature, and Send Again stops the old links", async () => {
    const { a } = await approved("Lagos Food Week", { kind: "mou", template_key: countersignedKey });
    expect(a.countersigned).toBe(true);
    expect(a.suggested_signers.map((s) => [s.side, s.name])).toEqual([["partner", "Ngozi Adebayo"], ["mycity", "Ada Okafor"]]);
    expect((await as("staff").post(`/partnerships/agreements/${a.partnership_agreement_id}/send`, { signers: a.suggested_signers.slice(0, 1), confirm: true })).body.error.fields).toEqual({ signers: ["Add MyCity's signer"] });

    queues.enqueue.mockClear();
    ok(await as("staff").post(`/partnerships/agreements/${a.partnership_agreement_id}/send`, { signers: a.suggested_signers, confirm: true }));
    const [partnerLink, mycityLink] = mails("agreement-sign");
    expect(mycityLink.data.after).toBe("Ngozi Adebayo");
    const mycity = tokenOf(mycityLink.data.sign_url);
    expect((await pub().post(`/sign/${mycity}/code`)).body.error.code).toBe("NOT_YOUR_TURN");
    await partnerSigns(tokenOf(partnerLink.data.sign_url));
    expect(ok(await as("staff").get(`/partnerships/agreements/${a.partnership_agreement_id}`)).signers.map((s) => [s.side, s.state])).toEqual([["partner", "signed"], ["mycity", "sent"]]);

    // MyCity's signer declines: back to sent with Send Again, the partner's signature void and said so.
    const declined = ok(await pub().post(`/sign/${mycity}/decline`, { reason: "The commission figure needs correcting." }));
    expect(declined.signers.map((s) => s.status)).toEqual(["void", "declined"]);
    await drain();
    const back = ok(await as("staff").get(`/partnerships/agreements/${a.partnership_agreement_id}`));
    expect(back).toMatchObject({ status: "sent", signing: { status: "declined", end_reason: "The commission figure needs correcting." } });
    expect(back.signers.map((s) => s.state)).toEqual(["void", "declined"]);

    // Send Again with a corrected address: the old links stop working, the new ones open.
    queues.enqueue.mockClear();
    const corrected = back.suggested_signers.map((s) => (s.side === "partner" ? { ...s, email: "ngozi@lagosfoodweek.example.test" } : s));
    const again = ok(await as("staff").post(`/partnerships/agreements/${a.partnership_agreement_id}/send`, { signers: corrected, confirm: true }));
    expect(again.signers.map((s) => [s.email, s.state])).toEqual([["ngozi@lagosfoodweek.example.test", "sent"], ["ceo@mycity.test", "waiting"]]);
    expect((await pub().get(`/sign/${tokenOf(partnerLink.data.sign_url)}`)).status).toBe(404);
    const fresh = mails("agreement-sign")[0];
    expect(fresh.to.email).toBe("ngozi@lagosfoodweek.example.test");
    expect(ok(await pub().get(`/sign/${tokenOf(fresh.data.sign_url)}`)).state).toBe("awaiting");
    // Send Again to the same signers: the newest links replace these.
    queues.enqueue.mockClear();
    ok(await as("staff").post(`/partnerships/agreements/${a.partnership_agreement_id}/resend`));
    expect((await pub().get(`/sign/${tokenOf(fresh.data.sign_url)}`)).status).toBe(404);
    expect(mails("agreement-sign")).toHaveLength(2);
  }, 120_000);

  test("approval: changes asked for or rejected return it to draft with the reason", async () => {
    const lead = await newLead("Owerri Comedy Night", { event_title: "Owerri Comedy Night" });
    const made = ok(await as("staff").post("/partnerships/agreements", { deal_id: lead.deal.deal_id }), 201);
    const id = made.partnership_agreement_id;
    ok(await as("staff").patch(`/partnerships/agreements/${id}`, { starts_on: "2026-12-05" }));
    const first = ok(await as("staff").post(`/partnerships/agreements/${id}/submit`));
    ok(await as("hod").post(`/workflow/instances/${first.workflow_instance_id}/request-changes`, { reason: "Add the second ticket option." }));
    await drain();
    const returned = ok(await as("staff").get(`/partnerships/agreements/${id}`));
    expect(returned).toMatchObject({ status: "draft", returned_reason: "Add the second ticket option.", approval: null });
    expect((await one("SELECT state FROM workflow_instance WHERE workflow_instance_id = $1", [first.workflow_instance_id])).state).toBe("cancelled");
    const second = ok(await as("staff").post(`/partnerships/agreements/${id}/submit`));
    expect(second.returned_reason).toBeNull();
    ok(await as("hod").post(`/workflow/instances/${second.workflow_instance_id}/reject`, { reason: "Not this season." }));
    await drain();
    expect(ok(await as("staff").get(`/partnerships/agreements/${id}`))).toMatchObject({ status: "draft", returned_reason: "Not this season." });
  }, 120_000);

  test("Record Signed Copy: a paper signature sealed over the scan, verified by reference only, signed outside the hub", async () => {
    const { lead, a } = await approved("Ibadan Book Fair");
    const scan = ok(await as("staff").upload("signed-agreement.pdf"), 201);
    const future = await as("staff").post(`/partnerships/agreements/${a.partnership_agreement_id}/signed-copy`, { document_id: scan.document_id, signed_on: "2099-01-01", signed_by_name: "Ngozi Adebayo" });
    expect(future.body.error.fields).toEqual({ signed_on: ["Not in the future"] });
    const done = ok(await as("staff").post(`/partnerships/agreements/${a.partnership_agreement_id}/signed-copy`, { document_id: scan.document_id, signed_on: "2026-11-02", signed_by_name: "Ngozi Adebayo", signed_by_title: "Founder" }));
    expect(done).toMatchObject({ status: "signed", signed_outside: true, record: { type: "partner" }, signed_document: { document_id: scan.document_id } });
    expect(done.signers).toEqual([expect.objectContaining({ name: "Ngozi Adebayo", email: null, state: "signed", method: "paper" })]);
    expect(done.signed_at.slice(0, 10)).toBe("2026-11-02");
    expect((await one("SELECT status FROM lead WHERE lead_id = $1", [lead.lead.lead_id])).status).toBe("converted");
    const r = ok(await pub().get(`/verify/${a.number}`));
    expect(r).toMatchObject({ signed_outside: true, content: "matches", artifact: "matches", signers: [expect.objectContaining({ method: "paper" })] });
    const row = await one("SELECT verify_key_hash, sealed_document_id FROM signature_request WHERE subject_id = $1 AND status = 'completed'", [a.partnership_agreement_id]);
    expect(row).toEqual({ verify_key_hash: null, sealed_document_id: scan.document_id });
  }, 120_000);

  test("the daily job: active on its start, expiring at its notice date, the renewal reminder, Renew, and deals past validity completed", async () => {
    const { a } = await approved("Enugu Art Walk");
    const scan = ok(await as("staff").upload("art-walk.pdf"), 201);
    ok(await as("staff").post(`/partnerships/agreements/${a.partnership_agreement_id}/signed-copy`, { document_id: scan.document_id, signed_on: "2026-11-01", signed_by_name: "Ngozi Adebayo" }));
    const today = require("../../src/shared/time/lagos").today();
    const addDays = require("../../src/shared/time/lagos").addDays;
    await q("UPDATE partnership_agreement SET starts_on = $2, ends_on = $3, renewal_notice_days = 30 WHERE partnership_agreement_id = $1", [a.partnership_agreement_id, addDays(today, -1), addDays(today, 200)]);
    expect(await renewals.sweep()).toMatchObject({ activated: expect.any(Number) });
    expect((await one("SELECT status FROM partnership_agreement WHERE partnership_agreement_id = $1", [a.partnership_agreement_id])).status).toBe("active");
    await q("UPDATE partnership_agreement SET ends_on = $2 WHERE partnership_agreement_id = $1", [a.partnership_agreement_id, addDays(today, 20)]);
    await renewals.sweep();
    expect((await one("SELECT status FROM partnership_agreement WHERE partnership_agreement_id = $1", [a.partnership_agreement_id])).status).toBe("expiring");
    const due = await renewals.remindersDue(pool, { now: new Date() });
    expect(due.filter((d) => d.entity_id === a.partnership_agreement_id).map((d) => d.occurrence)).toEqual(["notice"]);
    expect(ok(await as("staff").get("/partnerships/agreements/renewals")).data.map((r) => r.number)).toContain(a.number);
    expect(ok(await as("staff").get("/partnerships/agreements/summary")).renewals_180).toBeGreaterThanOrEqual(1);
    // Verification reads an agreement past its end as expired.
    await q("UPDATE partnership_agreement SET ends_on = $2 WHERE partnership_agreement_id = $1", [a.partnership_agreement_id, addDays(today, -1)]);
    expect(ok(await pub().get(`/verify/${a.number}`)).record_status).toBe("expired");
    await q("UPDATE partnership_agreement SET ends_on = $2 WHERE partnership_agreement_id = $1", [a.partnership_agreement_id, addDays(today, 20)]);

    // Renew: the next agreement drafted from this one; this one renewed when the next is signed.
    const next = ok(await as("staff").post(`/partnerships/agreements/${a.partnership_agreement_id}/renew`, { starts_on: addDays(today, 21), ends_on: addDays(today, 386) }), 201);
    expect(next).toMatchObject({ status: "draft", renews_agreement_id: a.partnership_agreement_id, template_key: a.template_key, deal_id: a.deal_id });
    expect((await as("staff").post(`/partnerships/agreements/${a.partnership_agreement_id}/renew`, { starts_on: addDays(today, 21) })).body.error.code).toBe("RENEWAL_OPEN");
    const sub = ok(await as("staff").post(`/partnerships/agreements/${next.partnership_agreement_id}/submit`));
    ok(await as("hod").post(`/workflow/instances/${sub.workflow_instance_id}/approve`));
    await drain();
    ok(await as("ceo").post(`/workflow/instances/${sub.workflow_instance_id}/approve`));
    await drain();
    const scan2 = ok(await as("staff").upload("art-walk-2027.pdf"), 201);
    ok(await as("staff").post(`/partnerships/agreements/${next.partnership_agreement_id}/signed-copy`, { document_id: scan2.document_id, signed_on: today, signed_by_name: "Ngozi Adebayo" }));
    expect(ok(await as("staff").get(`/partnerships/agreements/${a.partnership_agreement_id}`)).status).toBe("renewed");

    // A live deal past the later of its validity and its event's end is completed, its partner dormant.
    await q("UPDATE partnership_opportunity SET valid_until = $2, event_ends_on = $3 WHERE partnership_opportunity_id = $1", [a.deal_id, addDays(today, -10), addDays(today, -2)]);
    const out = await renewals.sweep();
    expect(out.deals_completed).toBeGreaterThanOrEqual(1);
    const deal = await one("SELECT status, partner_id FROM partnership_opportunity WHERE partnership_opportunity_id = $1", [a.deal_id]);
    expect(deal.status).toBe("completed");
    expect((await one("SELECT status FROM partner WHERE partner_id = $1", [deal.partner_id])).status).toBe("dormant");
  }, 120_000);

  test("scope follows the deal; Close ends an open request; a lost deal takes no agreement", async () => {
    const { a } = await approved("Port Harcourt Jazz");
    expect((await as("other").get(`/partnerships/agreements/${a.partnership_agreement_id}`)).status).toBe(404);
    expect(ok(await as("other").get("/partnerships/agreements")).data.map((r) => r.number)).not.toContain(a.number);
    expect(ok(await as("hod").get("/partnerships/agreements")).data.map((r) => r.number)).toContain(a.number);
    expect((await as("other").post(`/partnerships/agreements/${a.partnership_agreement_id}/close`, { reason: "Not mine to close at all." })).status).toBe(404);

    queues.enqueue.mockClear();
    ok(await as("staff").post(`/partnerships/agreements/${a.partnership_agreement_id}/send`, { signers: a.suggested_signers, confirm: true }));
    const token = tokenOf(mails("agreement-sign")[0].data.sign_url);
    const closed = ok(await as("staff").post(`/partnerships/agreements/${a.partnership_agreement_id}/close`, { reason: "The festival was called off this year." }));
    expect(closed).toMatchObject({ status: "closed", close_reason: "The festival was called off this year.", signing: { status: "revoked" } });
    expect((await pub().get(`/sign/${token}`)).status).toBe(404);
    expect((await as("staff").post(`/partnerships/agreements/${a.partnership_agreement_id}/close`, { reason: "Again, to be very sure." })).body.error.code).toBe("CLOSED");

    const lost = await newLead("Abuja Night Market");
    ok(await as("staff").post(`/partnerships/leads/${lost.lead.lead_id}/lose`, { reason: "They chose another platform." }));
    expect((await as("staff").post("/partnerships/agreements", { deal_id: lost.deal.deal_id })).body.error.code).toBe("DEAL_LOST");
  }, 120_000);
});
