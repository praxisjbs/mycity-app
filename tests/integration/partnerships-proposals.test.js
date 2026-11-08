"use strict";
/**
 * Partnerships · the Proposal Studio end to end (docs/guides/partnerships.md §6.10, §6.11, Appendix A
 * PR 7): the real migrations on a throwaway database, the whole app through HTTP, every response parsed
 * with its contract (APP_ENV=test). Claude is a stand-in that answers what each test gives it.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/partnerships-proposals
 *
 * Every organisation, person and figure is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const ai = require("../../src/services/ai/llm.service");
const drafts = require("../../src/services/ai/drafts");
const queues = require("../../src/jobs/queues");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0] || null;
const PASSWORD = "Proposals-Sent7Studio";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
// Claude's stand-in keeps no run in the ledger (ai_run), so none is named.
const RUN = null;

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

/** Cards as Claude would ask them: two required, the rest not. */
const CARDS = {
  cards: [
    { group_key: "partner", question: "What would make this season a success for them?", why: "The opening names their goal", answer_kind: "long_text", options: null, suggested: null, suggested_from: null, required: true },
    { group_key: "audience", question: "How many guests do they expect each night?", why: "Sizes the promotion", answer_kind: "number", options: null, suggested: 1500, suggested_from: "From the transcript, 00:21:51", required: true },
    { group_key: "money", question: "What is the early bird price?", why: "Sets the packages page", answer_kind: "money", options: null, suggested: null, suggested_from: null, required: false },
    { group_key: "timing", question: "When do tickets go on sale?", why: "Starts the timeline", answer_kind: "date", options: null, suggested: null, suggested_from: null, required: false },
    { group_key: "offer", question: "Which packages should go on sale?", why: "The packages page", answer_kind: "multi_pick", options: ["Regular", "VIP", "VVIP"], suggested: ["Regular"], suggested_from: "From the deal", required: false },
  ],
};

/** A draft as Claude would write it; `guests` is the figure under test. */
const draftOf = (guests, sourced) => ({
  title: "Three Full Nights by the Lake",
  tone_notes: "Warm and direct.",
  content: {
    sections: [
      { key: "cover", layout: "cover", title: "Three Full Nights by the Lake", prepared_for: "Lakeside Jazz Ltd", date: "2026-11-07", reference: "X", image_asset_id: null, partner_logo_asset_id: null },
      {
        key: "opportunity",
        layout: "opportunity",
        heading: "A Season Abuja Plans Around",
        paragraphs: [`The goal is ${guests} guests a night, with tickets people trust.`],
        pull_quote: null,
        sources: sourced ? [{ figure: `${guests} guests`, source: "answer", ref: "q2" }] : [],
      },
      { key: "why_mycity", layout: "why_mycity", heading: "Why MyCity", points: [1, 2, 3].map((n) => ({ proof_point_id: null, value: `${n}0,000+`, label: "People reached" })), sources: [1, 2, 3].map((n) => ({ figure: `${n}0,000+`, source: "proof_point", ref: "pp" })) },
      { key: "closing", layout: "closing", message: "Here's to full nights by the lake.", image_asset_id: null },
    ],
  },
});

describeDb("partnerships: the Proposal Studio", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;
  let deal;

  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`);
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path, body = {}) => auth(request(app).post(`/api/v1${path}`)).send(body),
      patch: (path, body = {}) => auth(request(app).patch(`/api/v1${path}`)).send(body),
      upload: (name, bytes, type) => auth(request(app).post("/api/v1/documents")).field("purpose", "attachment").attach("file", bytes, { filename: name, contentType: type }),
    };
  };
  const emp = (who) => people[who].employee.employee_id;
  const api = (path) => `/partnerships${path}`;
  const enqueued = (queue) => queues.enqueue.mock.calls.filter((c) => c[0] === queue);

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
    const make = (key, first, last, role, job, department = "Growth") =>
      tx(async (client) => {
        people[key] = await createAdmin(client, { employee: sample(first, last, `${key}@mycity.test`, job, department), role_code: role }, PASSWORD, { allowAdditional: true });
      });
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("staff", "Musa", "Danjuma", "employee", "Growth Officer");
    await make("other", "Zainab", "Lawal", "employee", "Growth Officer", "Marketing");
    await q(
      `INSERT INTO reference_value (domain, code, label, display_order, metadata) VALUES
         ('partnership_stage', 'prospect_identified', 'Prospect Identified', 10, '{"meaning":"prospect"}'::jsonb),
         ('partnership_stage', 'partnership_signed', 'Partnership Signed', 20, '{"meaning":"signed"}'::jsonb),
         ('partnership_stage', 'closed_lost', 'Closed Lost', 30, '{"meaning":"closed_lost"}'::jsonb)
       ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, metadata = EXCLUDED.metadata, active = true`,
    );
    await q("UPDATE reference_value SET active = false WHERE domain = 'partnership_stage' AND metadata = '{}'::jsonb");
    const cat = await one("INSERT INTO partner_category (name, default_commission_pct, display_order) VALUES ('Event', 8, 1) RETURNING partner_category_id");
    await q("INSERT INTO proof_point (kind, label, value, position) VALUES ('stat', 'People reached', '10,000+', 10), ('stat', 'Events ticketed', '340', 20), ('stat', 'Cities', '6', 30)");
    await drain();
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.72.0.${ip}`).send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
    const lead = await as("staff").post(api("/leads"), {
      name: "Lakeside Jazz Ltd",
      partner_category_id: cat.partner_category_id,
      region: { scope: "national" },
      owner_id: emp("staff"),
      contact: { first_name: "Ife", last_name: "Okon", email: "ife@lakeside.example", phones: ["08031230000"] },
      deal: { title: "Lakeside Jazz Weekend 2026", owner_id: emp("staff"), estimated_value: "4500000.00", event_starts_on: "2026-12-18", event_ends_on: "2026-12-20", options: [{ position: 1, label: "Regular", deal_price: "15000.00" }] },
    });
    expect([lead.status, lead.body.error]).toEqual([201, undefined]);
    deal = lead.body.deal;
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  const on = () => jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
  let proposal;

  test("New Proposal keeps the brief and queues Claude's cards; a transcript must be text", async () => {
    on();
    const pdf = await as("staff").upload("notes.pdf", PDF, "application/pdf");
    const refused = await as("staff").post(api("/proposals"), { deal_id: deal.deal_id, transcript_document_id: pdf.body.document_id });
    expect([refused.status, refused.body.error.fields]).toEqual([422, { transcript_document_id: ["Upload Markdown or text"] }]);

    const md = await as("staff").upload("meeting.md", Buffer.from("# Meeting\n\n00:21:51 We expect 1,500 guests a night."), "text/markdown");
    expect([md.status, md.body.error]).toEqual([201, undefined]);
    const res = await as("staff").post(api("/proposals"), { deal_id: deal.deal_id, notes: "They want three sold-out nights.", transcript_document_id: md.body.document_id });
    expect([res.status, res.body.error]).toEqual([201, undefined]);
    proposal = res.body;
    expect(proposal).toMatchObject({ number: "PRO-0001", version: 1, status: "questions", value: "4500000.00", ai: "on", questions: [], content: null });
    expect(proposal.progress).toMatchObject({ job: "questions", failed: false });
    expect(proposal.brief).toMatchObject({ notes: "They want three sold-out nights.", transcript: { file_name: "meeting.md", mime_type: "text/markdown" } });
    await drain();
    expect(enqueued("proposal-questions").map((c) => c[2])).toEqual([{ partnership_proposal_id: proposal.partnership_proposal_id }]);
  });

  test("the cards: asked once, answered by kind, a required card not skipped, reshuffled at most three times", async () => {
    on();
    const complete = jest.spyOn(ai, "complete").mockResolvedValue({ output: CARDS, run_id: RUN });
    const ask = require("../../src/modules/proposals/proposals.questions").ask;
    expect(await ask(proposal.partnership_proposal_id)).toBe(5);
    expect(await ask(proposal.partnership_proposal_id)).toBeNull();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toMatchObject({ purpose: "proposal-questions", module: "partnerships" });
    expect(complete.mock.calls[0][0].input.brief.transcript).toContain("1,500 guests");

    let p = (await as("staff").get(api(`/proposals/${proposal.partnership_proposal_id}`))).body;
    expect(p.questions.map((c) => c.group_key)).toEqual(["partner", "audience", "money", "timing", "offer"]);
    expect(p.progress).toBeNull();
    const [goal, guests, price, sale, packs] = p.questions;
    const answer = (card, value) => as("staff").post(api(`/proposals/${p.partnership_proposal_id}/questions/${card.proposal_question_id}/answer`), { answer: value });
    expect((await answer(price, "fifteen")).body.error.fields).toEqual({ answer: ["Give an amount"] });
    expect((await answer(sale, "2026-02-30")).body.error.fields).toEqual({ answer: ["Not a real date"] });
    expect((await answer(packs, ["Gold"])).body.error.fields).toEqual({ answer: ["Pick the options"] });
    expect((await answer(price, "12000.00")).status).toBe(200);
    const skip = await as("staff").post(api(`/proposals/${p.partnership_proposal_id}/questions/${goal.proposal_question_id}/skip`));
    expect(skip.status).toBe(409);

    // Write Draft waits while a required card is open.
    const early = await as("staff").post(api(`/proposals/${p.partnership_proposal_id}/draft`));
    expect([early.status, early.body.error.fields]).toEqual([409, { questions: ["Answer the required cards"] }]);

    complete.mockClear();
    const swap = complete.mockResolvedValue({ output: { card: { ...CARDS.cards[0], question: "What did last year teach them?" } }, run_id: RUN });
    let card = goal;
    for (let i = 0; i < 3; i += 1) {
      const res = await as("staff").post(api(`/proposals/${p.partnership_proposal_id}/questions/${card.proposal_question_id}/reshuffle`));
      expect(res.status).toBe(200);
      card = res.body.questions.find((c) => c.replaces_id === card.proposal_question_id);
      expect(card).toMatchObject({ group_key: "partner", state: "open", reshuffles: i + 1 });
    }
    expect((await as("staff").post(api(`/proposals/${p.partnership_proposal_id}/questions/${card.proposal_question_id}/reshuffle`))).status).toBe(409);
    expect(swap).toHaveBeenCalledTimes(3);
    p = (await answer(card, "Full lawns and a crowd that returns")).body;
    p = (await answer(guests, 1500)).body;
    expect(p.questions.filter((c) => c.state === "replaced")).toHaveLength(3);
  });

  test("Write Draft: the figure check asks once more, then marks what is still unsourced", async () => {
    on();
    const id = proposal.partnership_proposal_id;
    const res = await as("staff").post(api(`/proposals/${id}/draft`));
    expect([res.status, res.body.status, res.body.progress.job]).toEqual([200, "writing", "draft"]);
    await drain();
    expect(enqueued("proposal-draft").map((c) => c[2])).toEqual([{ partnership_proposal_id: id }]);

    const complete = jest.spyOn(ai, "complete").mockResolvedValue({ output: draftOf("1,800", false), run_id: RUN });
    const written = await require("../../src/modules/proposals/proposals.draft").write(id);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0].input.unsourced_figures).toEqual([{ key: "opportunity", figure: "1,800" }]);
    expect(written.sections.find((s) => s.key === "opportunity").unconfirmed).toEqual(["1,800"]);
    const cover = written.sections.find((s) => s.key === "cover");
    expect([cover.reference, cover.date.length]).toEqual(["PRO-0001", 10]);

    const p = (await as("staff").get(api(`/proposals/${id}`))).body;
    expect(p).toMatchObject({ status: "draft", title: "Three Full Nights by the Lake", can: { edit: true, send: true, decide: false } });
    const preview = await as("staff").get(api(`/proposals/${id}/preview`));
    expect(preview.status).toBe(200);
    expect(preview.body.html).toContain('class="page page--cover tone-deep"');
    expect(preview.body.checks.unconfirmed).toEqual([{ key: "opportunity", figure: "1,800" }]);
    expect(preview.body.checks.stand_ins.map((s) => s.key)).toEqual(["cover", "closing"]);
    expect(preview.body.sections.find((s) => s.key === "why_mycity").fits).toEqual(["why_mycity", "audience", "proof"]);
  });

  test("edits: a page moved, hidden, put in another layout that fits; never a layout that does not", async () => {
    const id = proposal.partnership_proposal_id;
    const edit = (body) => as("staff").patch(api(`/proposals/${id}/content`), body);
    let res = await edit({ op: "move", key: "why_mycity", direction: "up" });
    expect(res.body.content.sections.map((s) => s.key)).toEqual(["cover", "why_mycity", "opportunity", "closing"]);
    res = await edit({ op: "layout", key: "why_mycity", layout: "audience" });
    expect(res.body.content.sections[1]).toMatchObject({ key: "why_mycity", layout: "audience", stats: [{ value: "10,000+", label: "People reached" }, { value: "20,000+", label: "People reached" }, { value: "30,000+", label: "People reached" }] });
    expect((await edit({ op: "layout", key: "opportunity", layout: "packages" })).status).toBe(422);
    res = await edit({ op: "hide", key: "why_mycity", hidden: true });
    expect(res.body.content.sections[1].hidden).toBe(true);
    expect((await edit({ op: "hide", key: "why_mycity", hidden: false })).status).toBe(200);
  });

  test("Rewrite Section and Write With AI draft text and keep none of it", async () => {
    on();
    const id = proposal.partnership_proposal_id;
    const before = (await as("staff").get(api(`/proposals/${id}`))).body.content;
    jest.spyOn(ai, "complete").mockResolvedValue({ output: { section: { ...before.sections[2], heading: "December by the Lake" } }, run_id: RUN });
    const r = await as("staff").post(api(`/proposals/${id}/sections/opportunity/rewrite`), { instruction: "A warmer heading" });
    expect([r.status, r.body.available, r.body.section.heading]).toEqual([200, true, "December by the Lake"]);
    expect((await as("staff").get(api(`/proposals/${id}`))).body.content).toEqual(before);

    const msg = jest.spyOn(ai, "complete").mockResolvedValue({ output: { subject: "Three full nights for Lakeside Jazz", message: "Dear Ife, the proposal is attached." }, run_id: RUN });
    const m = await as("staff").post(api(`/proposals/${id}/message`));
    expect(m.body).toMatchObject({ available: true, subject: "Three full nights for Lakeside Jazz" });
    expect(msg.mock.calls[msg.mock.calls.length - 1][0]).toMatchObject({ purpose: "proposal-message", input: { contact_first_name: "Ife" } });
    jest.spyOn(drafts, "availability").mockResolvedValue({ available: false, reason: "limit" });
    expect((await as("staff").post(api(`/proposals/${id}/message`))).body).toEqual({ available: false, reason: "limit", subject: null, message: null, ai_run_id: null });
  });

  let link;
  test("Send: refused without confirm; confirmed, the link is issued, the PDF queued, then mailed with it", async () => {
    const id = proposal.partnership_proposal_id;
    const body = { to: ["ife@lakeside.example"], cc: ["IFE@lakeside.example", "events@lakeside.example"], subject: "Three full nights", message: "Dear Ife, here it is." };
    expect((await as("staff").post(api(`/proposals/${id}/send`), body)).status).toBe(422);
    const res = await as("staff").post(api(`/proposals/${id}/send`), { ...body, confirm: true });
    expect([res.status, res.body.error]).toEqual([200, undefined]);
    expect(res.body).toMatchObject({ status: "sent", sent_to: ["ife@lakeside.example"], sent_cc: ["events@lakeside.example"], can: { edit: false, decide: true, withdraw: true } });
    link = res.body.link_url;
    expect(link).toMatch(/\/proposal\/[\w-]{20,}$/);
    const row = await one("SELECT document_id, link_secret, valid_until, public_token_id FROM partnership_proposal WHERE partnership_proposal_id = $1", [id]);
    expect(row.link_secret).not.toContain(link.split("/").pop());
    const doc = await one("SELECT doc_type, render_status, render_html FROM document WHERE document_id = $1", [row.document_id]);
    expect([doc.doc_type, doc.render_status]).toEqual(["proposal", "pending"]);
    expect(doc.render_html).toContain("@page { size: 338.67mm 190.5mm");

    await drain();
    expect(enqueued("email-send")).toHaveLength(0);
    await require("../../src/shared/documents/generate").renderPending(row.document_id, { renderPdf: async (html, opts) => (expect(opts.bare).toBe(true), PDF) });
    await drain();
    const [mail] = enqueued("email-send");
    expect(mail[1]).toBe("proposal-sent");
    expect(mail[2]).toMatchObject({
      template: "proposal-sent",
      to: [{ email: "ife@lakeside.example" }],
      cc: [{ email: "events@lakeside.example" }],
      reply_to: "staff@mycity.test",
      attachments: [{ document_id: row.document_id }],
      data: { subject: "Three full nights", reference: "PRO-0001", link },
    });
  });

  test("the public link: the proposal as designed, a view kept without the address, the PDF as sent", async () => {
    const token = link.split("/").pop();
    const res = await request(app).get(`/api/public/v1/proposals/${token}`).set("X-Forwarded-For", "10.72.9.9");
    expect([res.status, res.headers["x-robots-tag"]]).toEqual([200, "noindex, nofollow"]);
    expect(res.body).toMatchObject({ title: "Three Full Nights by the Lake", partner_name: "Lakeside Jazz Ltd", owner_contact: { email: "staff@mycity.test" } });
    expect(res.body.html).toContain('class="kit-web"');
    await request(app).get(`/api/public/v1/proposals/${token}`);
    const views = await q("SELECT ip_hash, user_agent FROM proposal_view WHERE partnership_proposal_id = $1", [proposal.partnership_proposal_id]);
    expect(views.rows).toHaveLength(2);
    expect(views.rows.every((v) => /^[0-9a-f]{64}$/.test(v.ip_hash) && !v.ip_hash.includes("10.72"))).toBe(true);
    const p = (await as("staff").get(api(`/proposals/${proposal.partnership_proposal_id}`))).body;
    expect([p.status, p.view_count]).toEqual(["viewed", 2]);
    const viewed = await q("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'proposal.viewed'");
    expect(viewed.rows[0].n).toBe(1);
    // The first opening tells the deal's owner, once, opening the proposal (§7).
    await drain();
    const told = await q("SELECT user_id, title, entity_type, entity_id FROM notification WHERE event_key = 'proposal.viewed'");
    expect(told.rows).toEqual([{ user_id: people.staff.user.user_id, title: "Proposal Viewed", entity_type: "partnership_proposal", entity_id: proposal.partnership_proposal_id }]);
    const pdf = await request(app).get(`/api/public/v1/proposals/${token}/pdf`);
    expect([pdf.status, pdf.headers["content-type"]]).toEqual([200, "application/pdf"]);
  });

  test("a reader outside the deal's scope cannot open it; Save as Template needs configure", async () => {
    expect((await as("other").get(api(`/proposals/${proposal.partnership_proposal_id}`))).status).toBe(404);
    expect((await as("other").get(api("/proposals"))).body.page.total).toBe(0);
    expect((await as("staff").post(api(`/proposals/${proposal.partnership_proposal_id}/save-as-template`), { name: "Festival" })).status).toBe(403);
    const t = await as("ops").post(api(`/proposals/${proposal.partnership_proposal_id}/save-as-template`), { name: "Festival" });
    expect([t.status, t.body.structure.layouts]).toEqual([201, ["cover", "audience", "opportunity", "closing"]]);
    expect(t.body.structure.tone_notes).toBe("Warm and direct.");
    expect(JSON.stringify(t.body)).not.toContain("Lakeside");
  });

  test("Revise makes the next version; sending it withdraws the first, whose link stops", async () => {
    const res = await as("staff").post(api(`/proposals/${proposal.partnership_proposal_id}/revise`));
    expect([res.status, res.body.number, res.body.version, res.body.status]).toEqual([201, "PRO-0001", 2, "draft"]);
    expect(res.body.versions.map((v) => v.version)).toEqual([2, 1]);
    const list = await as("staff").get(api("/proposals"));
    expect(list.body.data.map((p) => p.version)).toEqual([2]);
    const sent = await as("staff").post(api(`/proposals/${res.body.partnership_proposal_id}/send`), { to: ["ife@lakeside.example"], subject: "Revised", message: "Revised.", confirm: true });
    expect(sent.status).toBe(200);
    expect((await one("SELECT status FROM partnership_proposal WHERE partnership_proposal_id = $1", [proposal.partnership_proposal_id])).status).toBe("withdrawn");
    expect((await request(app).get(`/api/public/v1/proposals/${link.split("/").pop()}`)).status).toBe(404);

    const declined = await as("staff").post(api(`/proposals/${res.body.partnership_proposal_id}/decline`), { reason: "They chose another ticketing partner." });
    expect([declined.body.status, declined.body.link_url]).toEqual(["declined", null]);
    expect((await request(app).get(`/api/public/v1/proposals/${sent.body.link_url.split("/").pop()}`)).status).toBe(404);
  });

  test("AI off: the brief is kept, and Write Draft fills the kit from the record to finish by hand", async () => {
    jest.spyOn(drafts, "availability").mockResolvedValue({ available: false, reason: "off" });
    const complete = jest.spyOn(ai, "complete");
    const res = await as("staff").post(api("/proposals"), { deal_id: deal.deal_id, notes: "By hand." });
    expect(res.body).toMatchObject({ ai: "off", progress: { failed: true, reason: "off" } });
    const draft = await as("staff").post(api(`/proposals/${res.body.partnership_proposal_id}/draft`));
    expect(draft.body.status).toBe("draft");
    expect(draft.body.content.sections.map((s) => s.layout)).toEqual(["cover", "why_mycity", "packages", "timeline", "next_steps", "closing"]);
    expect(complete).not.toHaveBeenCalled();
  });

  test("the daily job expires a proposal past its validity and stops its link", async () => {
    const res = await as("staff").post(api("/proposals"), { deal_id: deal.deal_id });
    jest.spyOn(drafts, "availability").mockResolvedValue({ available: false, reason: "off" });
    await as("staff").post(api(`/proposals/${res.body.partnership_proposal_id}/draft`));
    const sent = await as("staff").post(api(`/proposals/${res.body.partnership_proposal_id}/send`), { to: ["ife@lakeside.example"], subject: "Hello", message: "Hello.", confirm: true });
    await q("UPDATE partnership_proposal SET valid_until = '2026-01-01' WHERE partnership_proposal_id = $1", [res.body.partnership_proposal_id]);
    expect(await require("../../src/modules/proposals/proposals.service").expireDue()).toBe(1);
    expect((await one("SELECT status, link_secret FROM partnership_proposal WHERE partnership_proposal_id = $1", [res.body.partnership_proposal_id]))).toEqual({ status: "expired", link_secret: null });
    expect((await request(app).get(`/api/public/v1/proposals/${sent.body.link_url.split("/").pop()}`)).status).toBe(404);
  });
  test("Praxis AI: proposals.list reads within scope, and the proposals.start card opens the studio with its brief", async () => {
    const registry = require("../../src/shared/ai/registry");
    const authorise = require("../../src/shared/ai/authorise");
    const roles = async (who) => (await one("SELECT COALESCE(array_agg(role_id), '{}') AS ids FROM user_role WHERE user_id = $1", [people[who].user.user_id])).ids;
    const actorOf = async (who, key) => {
      const u = { user_id: people[who].user.user_id, employee_id: emp(who), role_ids: await roles(who), is_ceo: false };
      return { ...u, scope: (await authorise.checkAction(u, key, {}, pool)).scope };
    };
    on();
    const staff = await actorOf("staff", "proposals.start");
    const checked = await authorise.checkAction(staff, "proposals.start", { deal_id: deal.deal_id, notes: "From the chat: they want the VIP tables named after the sponsors." }, pool);
    expect(checked.problems).toEqual({});
    const action = registry.action("proposals.start");
    await action.check(pool, checked.values, staff);
    const made = await action.run(checked.values, staff);
    expect(made).toMatchObject({ status: "questions", brief: { notes: "From the chat: they want the VIP tables named after the sponsors." } });
    expect(action.readback(made)[0]).toMatchObject({ type: "proposal", id: made.partnership_proposal_id, link: expect.stringContaining(made.partnership_proposal_id) });

    // Another reader's card on a deal they cannot see is refused by its check, never run.
    const other = await actorOf("other", "proposals.start");
    await expect(action.check(pool, { deal_id: deal.deal_id }, other)).rejects.toMatchObject({ status: 404 });

    const read = registry.read("proposals.list");
    const mine = await read.run(pool, { page: 1 }, { ...staff, scope: staff.scope });
    expect(mine.data.some((p) => p.partnership_proposal_id === made.partnership_proposal_id)).toBe(true);
    expect((await read.run(pool, { page: 1 }, other)).data).toEqual([]);
  });
});
