"use strict";
/**
 * Contracts and MoUs in the chat on the real migrations (docs/guides/praxis-ai.md §1.10 decisions 41
 * to 48, §6.18, Appendix A PR 2; partnerships.md §9), the chat's model scripted and the reader
 * stubbed: a signed MoU naming a lead whose agreement waits for its signature is read as
 * file.contract and drawn as Record Signed Copy, pressed after Confirm It's You, the agreement sealed
 * over the file and the lead converted; an MoU naming a partner with nothing waiting is filed among
 * its documents by Add Partner Document, its kind by name; a party nobody may edit asks whose it
 * is; a reader with Partnerships view alone gets the summary and the terms with no card.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-contracts
 *
 * Every organisation and person is invented.
 */
process.env.GEMINI_API_KEY = "test-key";
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
const registry = require("../../src/shared/ai/registry");
const ai = require("../../src/services/ai/llm.service");
const drafts = require("../../src/services/ai/drafts");
const documents = require("../../src/shared/documents/generate");
const lagos = require("../../src/shared/time/lagos");
const { q, one, drain, fresh, script, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const STAGES = [
  ["prospect_identified", "Prospect Identified", "prospect"],
  ["negotiation", "Negotiation", "negotiation"],
  ["partnership_signed", "Partnership Signed", "signed"],
  ["active_partnership", "Active Partnership", "active"],
  ["closed_lost", "Closed Lost", "closed_lost"],
];
const chip = (field) => `<span data-field="${field}">{{ ${field} }}</span>`;
const WORDING = [
  "<h2>Memorandum of Understanding</h2>",
  `<p>Between MyCity App Ltd and ${chip("partner.name")}</p>`,
  `<p>Name of Representative: ${chip("signer.name")}</p>`,
  `<p>Signature: ${chip("signer.signature")}</p>`,
].join("");

/** A made-up MoU as the reader returns it: MyCity and the festival, both signed. */
const reading = (party, extra = {}) => ({
  title: "Memorandum of Understanding",
  kind: "mou",
  parties: [
    { name: "MyCity App Ltd", role: "MyCity" },
    { name: party, role: "Partner" },
  ],
  signed_on: lagos.today(),
  starts_on: "2026-12-01",
  ends_on: "2027-11-30",
  notice_days: 30,
  value: "2500000.00",
  currency: "NGN",
  renewal: "Renews each year unless either party gives 30 days' notice.",
  obligations: [
    { party, obligation: "List every ticketed event on MyCityApp." },
    { party: "MyCity App Ltd", obligation: "Promote the festival to its users for six weeks." },
  ],
  signatories: [
    { name: "Ngozi Adebayo", title: "Founder", party },
    { name: "Ada Okafor", title: "Chief Executive Officer", party: "MyCity App Ltd" },
  ],
  ...extra,
});

describeDb("contracts and MoUs in the chat against the real migrations", () => {
  let app;
  let h;
  let category;
  const made = {};

  const ok = (res, status = 200) => {
    expect([res.status, res.body.error]).toEqual([status, undefined]);
    return res.body;
  };
  /** The reader answers from the stub; every other call goes on as it would. */
  const reads = (output) => {
    const real = ai.complete;
    return jest.spyOn(ai, "complete").mockImplementation(async (opts) => (opts.purpose === "agreement-document-read" ? { output, run_id: null } : real(opts)));
  };
  const stage = async (who, name = "mou.pdf") => ok(await h.as(who).post("/documents").field("purpose", "ai_attachment").attach("file", PDF, { filename: name, contentType: "application/pdf" }), 201);
  const attach = (who, staged, body = {}) => h.ask(who, { question: "", attachment: { document_id: staged.document_id, kind: "contract" }, shows: ["cards", "pane"], ...body });
  /** The worker's PDF render, with a stand-in for Chromium. */
  async function renderAll() {
    const { rows } = await q("SELECT document_id FROM document WHERE render_status = 'pending' ORDER BY created_at");
    for (const r of rows) await documents.renderPending(r.document_id, { db: pool, renderPdf: async (html) => Buffer.concat([PDF, Buffer.from(`% ${html.length}\n`)]) });
    await drain();
  }

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Ada", last: "Okafor", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26", department: "Management" },
      { who: "ops", first: "Tunde", last: "Bakare", email: "ops@mycity.test", job: "Operations Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "hod", first: "Kemi", last: "Alade", email: "hod@mycity.test", job: "Head of Growth", role: "head_of_department", password: "Head#Growth2026", department: "Growth" },
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Growth Officer", role: "employee", password: "Growth#Officer2026", department: "Growth" },
    ]);
    const emp = (who) => h.people[who].employee.employee_id;
    await q("UPDATE department SET head_employee_id = $1 WHERE name = 'Growth'", [emp("hod")]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("hod"), emp("staff")]);
    await grantsCache.bumpTeamVersion();
    for (const [i, [code, label, meaning]] of STAGES.entries())
      await q(
        `INSERT INTO reference_value (domain, code, label, display_order, metadata) VALUES ('partnership_stage', $1, $2, $3, $4::jsonb)
         ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, metadata = EXCLUDED.metadata, active = true`,
        [code, label, (i + 1) * 10, JSON.stringify({ meaning })],
      );
    await q("UPDATE reference_value SET active = false WHERE domain = 'partnership_stage' AND metadata = '{}'::jsonb");
    // MyCity's document kinds, as Categories' Pipeline Settings enters them.
    await q("INSERT INTO reference_value (domain, code, label, display_order) VALUES ('partner_document_kind', 'mou', 'MOU', 10), ('partner_document_kind', 'service_agreement', 'Service Agreement', 20) ON CONFLICT (domain, code) DO NOTHING");
    await drain();
    category = ok(await h.as("ops").post("/partnerships/categories").send({ name: "Event", default_commission_pct: "8", default_validity_days: 30 }), 201).partner_category_id;
    ok(await h.as("ops").post(`/partnerships/categories/${category}/templates`).send({ kind: "mou", label: "Events MOU", body_html: WORDING, asks: [], is_default: true }), 201);

    // Lagoon Youth Fest, a lead of the Growth officer's, its MoU approved and sent for signature.
    const lead = ok(
      await h
        .as("staff")
        .post("/partnerships/leads")
        .send({
          name: "Lagoon Youth Fest",
          partner_category_id: category,
          region: { scope: "national" },
          owner_id: emp("staff"),
          contact: { first_name: "Ngozi", last_name: "Adebayo", job_title: "Founder", email: "ngozi@lagoon.example.test", signatory: true },
          deal: { title: "Lagoon Youth Fest Partnership", owner_id: emp("staff"), estimated_value: "2500000.00" },
        }),
      201,
    );
    const draft = ok(await h.as("staff").post("/partnerships/agreements").send({ deal_id: lead.deal.deal_id, kind: "mou" }), 201);
    const id = draft.partnership_agreement_id;
    ok(await h.as("staff").patch(`/partnerships/agreements/${id}`).send({ starts_on: "2026-12-01", ends_on: "2027-11-30" }));
    const review = ok(await h.as("staff").post(`/partnerships/agreements/${id}/submit`).send({}));
    ok(await h.as("hod").post(`/workflow/instances/${review.workflow_instance_id}/approve`).send({}));
    await drain();
    ok(await h.as("ceo").post(`/workflow/instances/${review.workflow_instance_id}/approve`).send({}));
    await drain();
    const approved = ok(await h.as("staff").get(`/partnerships/agreements/${id}`));
    const sent = ok(await h.as("staff").post(`/partnerships/agreements/${id}/send`).send({ signers: approved.suggested_signers, confirm: true }));
    expect(sent.status).toBe("sent");
    await renderAll();
    made.lead = lead.lead.lead_id;
    made.agreement = sent;
    registry.load();
    fresh();
  }, 180_000);

  afterAll(async () => {
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  beforeEach(() => {
    jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
  });
  afterEach(() => jest.restoreAllMocks());

  test("the Contract or MoU tile is offered to Partnerships view", async () => {
    const kinds = ok(await h.as("staff").get("/ai/attachment-kinds"));
    expect(kinds.kinds).toContainEqual({ kind: "contract", label: "Contract or MoU", question: "Summarise this contract and file it" });
  });

  test("agreements.record_signed_copy: a signed MoU naming the lead whose agreement waits is read as file.contract, drawn as Record Signed Copy, and sealed after Confirm It's You", async () => {
    reads(reading("Lagoon Youth Fest Limited"));
    const sent = script(say({ text: "An MoU between MyCity App Ltd and Lagoon Youth Fest Limited, signed today, running from 01/12/2026 to 30/11/2027.", action: null }));
    const staged = await stage("staff", "lagoon-mou-signed.pdf");
    const asked = ok(await attach("staff", staged));
    expect(asked.question).toBe("Summarise this contract and file it");
    expect(asked.reads[0]).toMatchObject({ n: 1, key: "file.contract", outcome: "read", module_key: "partnerships" });
    // The model got the reading as data with the question, never the file.
    const user = sent[0].messages.filter((m) => m.role === "user").pop();
    expect(user.content).toContain("Lagoon Youth Fest Limited");
    // The terms for the pane's Record tab, in words a person reads.
    expect(asked.attachment).toMatchObject({ kind: "contract", document: expect.objectContaining({ document_id: staged.document_id }), record: { title: "Memorandum of Understanding" } });
    const items = Object.fromEntries(asked.attachment.record.items.map((i) => [i.label, i.value]));
    expect(items).toMatchObject({ Kind: "MOU", "Starts On": "01/12/2026", "Ends On": "30/11/2027", Notice: "30 days", Value: "₦2,500,000.00", "Signed By": "Ngozi Adebayo, Founder; Ada Okafor, Chief Executive Officer" });
    expect(items["Lagoon Youth Fest Limited"]).toBe("List every ticketed event on MyCityApp.");
    // The file read is never replayed.
    expect((await h.as("staff").get(`/ai/answers/${asked.ai_message_id}/reads/1`)).status).toBe(404);

    const card = asked.card;
    expect(card).toMatchObject({ action_key: "agreements.record_signed_copy", label: "Record Signed Copy", risk: "approval", confirm: "fresh_sign_in", suggested: false, problems: {} });
    expect(card.values).toMatchObject({
      partnership_agreement_id: made.agreement.partnership_agreement_id,
      document_id: staged.document_id,
      signed_on: lagos.today(),
      signed_by_name: "Ngozi Adebayo",
      signed_by_title: "Founder",
    });
    expect(card.records).toEqual([expect.objectContaining({ type: "agreement", id: made.agreement.partnership_agreement_id, label: `${made.agreement.number} ${made.agreement.title}` })]);
    expect(card.names).toEqual([expect.objectContaining({ type: "document", id: staged.document_id, label: "lagoon-mou-signed.pdf" })]);

    await h.stale("staff");
    expect((await h.press("staff", card.ai_action_draft_id)).body.error.code).toBe("REAUTH_REQUIRED");
    await h.confirmPassword("staff");
    const pressed = ok(await h.press("staff", card.ai_action_draft_id));
    expect(pressed.status).toBe("done");
    await drain();
    const a = await one("SELECT status, signed_outside, signed_document_id, partner_id, lead_id FROM partnership_agreement WHERE partnership_agreement_id = $1", [made.agreement.partnership_agreement_id]);
    expect(a).toMatchObject({ status: "signed", signed_outside: true, signed_document_id: staged.document_id });
    expect((await one("SELECT status FROM lead WHERE lead_id = $1", [made.lead])).status).toBe("converted");
    expect(await one("SELECT origin, partner_id FROM partner_document WHERE document_id = $1", [staged.document_id])).toEqual({ origin: "signed_copy", partner_id: a.partner_id });
    made.partner = a.partner_id;
  });

  test("partner_documents.attach: an MoU naming a partner with nothing waiting is filed among its documents, its kind by name", async () => {
    reads(reading("Lagoon Youth Fest"));
    script(say({ text: "Another MoU with Lagoon Youth Fest.", action: null }));
    const staged = await stage("staff", "lagoon-mou-2027.pdf");
    const asked = ok(await attach("staff", staged));
    const card = asked.card;
    expect(card).toMatchObject({ action_key: "partner_documents.attach", label: "Add Partner Document", risk: "standard", problems: {} });
    expect(card.values).toMatchObject({ document_id: staged.document_id, kind: "MOU", partner_id: made.partner });
    expect(card.names).toEqual(expect.arrayContaining([expect.objectContaining({ type: "partner", id: made.partner }), expect.objectContaining({ type: "document", label: "lagoon-mou-2027.pdf" })]));

    const pressed = ok(await h.press("staff", card.ai_action_draft_id));
    expect(pressed.status).toBe("done");
    await drain();
    expect(await one("SELECT kind, origin, partner_id FROM partner_document WHERE document_id = $1", [staged.document_id])).toEqual({ kind: "mou", origin: "upload", partner_id: made.partner });
    expect((await one("SELECT doc_type FROM document WHERE document_id = $1", [staged.document_id])).doc_type).toBe("partner_document");
    const docs = ok(await h.as("staff").get(`/partnerships/documents?partner_id=${made.partner}`));
    expect(docs.data.map((d) => d.document.document_id)).toContain(staged.document_id);
  });

  test("a party nobody may edit asks whose document it is; a reader with Partnerships view alone gets the terms and no card", async () => {
    reads(reading("Unheard Of Ventures Limited"));
    script(say({ text: "An MoU with Unheard Of Ventures Limited.", action: null }));
    const unknown = ok(await attach("staff", await stage("staff")));
    expect([unknown.card, unknown.content]).toEqual([null, expect.stringContaining("Whose document is it?")]);

    const role = await one("SELECT role_id FROM role WHERE code = 'employee'");
    await q("UPDATE permission SET can_edit = false WHERE role_id = $1 AND module_key = 'partnerships'", [role.role_id]);
    await grantsCache.invalidateGrants();
    await grantsCache.invalidateUser(h.people.staff.user_id);
    try {
      const kinds = ok(await h.as("staff").get("/ai/attachment-kinds"));
      expect(kinds.kinds.map((k) => k.kind)).toContain("contract");
      reads(reading("Lagoon Youth Fest"));
      script(say({ text: "Another MoU with Lagoon Youth Fest.", action: null }));
      const viewOnly = ok(await attach("staff", await stage("staff")));
      expect(viewOnly.card).toBeNull();
      expect(viewOnly.attachment.record.items.length).toBeGreaterThan(3);
    } finally {
      await q("UPDATE permission SET can_edit = true WHERE role_id = $1 AND module_key = 'partnerships'", [role.role_id]);
      await grantsCache.invalidateGrants();
      await grantsCache.invalidateUser(h.people.staff.user_id);
    }
  });
});
