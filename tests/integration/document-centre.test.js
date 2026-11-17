"use strict";
/**
 * The Document Centre's company documents on the real migrations (docs/guides/document-centre.md
 * §6.4 to §6.9, §9; PR 2 of its Appendix A): categories with an audience, Upload Document from a
 * staged file, the same file refused twice, Edit Details, Upload New Version, Archive and Restore,
 * each by the people §8 names and nobody else; the text of a PDF, a Word file and a picture, and a
 * search that finds a word inside a file for its readers only; the letterhead in both formats; the
 * expiry reminder's four days, once each; Home's alert opening the Library; and Praxis AI's cards.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/document-centre
 *
 * Every organisation, person and paper here is invented.
 */
process.env.GEMINI_API_KEY = "test-key";
const sharp = require("sharp");
const JSZip = require("jszip");
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
const registry = require("../../src/shared/ai/registry");
const lagos = require("../../src/shared/time/lagos");
const documents = require("../../src/shared/documents/generate");
const storage = require("../../src/services/storage/storage.service");
const { buildDocx } = require("../../src/shared/documents/docx");
const { q, one, drain, fresh, script, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

/** A one-page PDF whose page says `words`, with a correct cross-reference table. */
function textPdf(words) {
  const content = `BT /F1 14 Tf 72 720 Td (${words.replace(/[()\\]/g, "")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describeDb("Document Centre: company documents, their text, the letterhead and their expiry", () => {
  let app;
  let h;
  const made = {};

  const ok = (res, status = 200) => {
    expect([res.status, res.body && res.body.error]).toEqual([status, undefined]);
    return res.body;
  };
  /** A file staged through the upload engine, as UploadField sends it. */
  const stage = async (who, buffer, name, type = "application/pdf") =>
    ok(await h.as(who).post("/documents").field("purpose", "document").attach("file", buffer, { filename: name, contentType: type }), 201).document_id;
  const upload = async (who, body) => h.as(who).post("/library/documents").send(body);

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26", department: "Management" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "mgmt", first: "Hauwa", last: "Sule", email: "mgmt@mycity.test", job: "General Manager", role: "management", password: "General#Mgr2026", department: "Management" },
      { who: "hod", first: "Chidi", last: "Eze", email: "hod@mycity.test", job: "Head of Growth", role: "head_of_department", password: "Head#Growth2026", department: "Growth" },
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Growth Officer", role: "employee", password: "Field#Officer2026", department: "Growth" },
    ]);
    registry.load();
    fresh();
  }, 120_000);

  afterAll(async () => {
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => jest.restoreAllMocks());

  test("categories: documents.manage keeps them; a roles audience names a role; a name is used once, whatever its case", async () => {
    const hod = await h.as("hod").post("/library/categories").send({ name: "Licences", audience: "everyone" });
    expect([hod.status, hod.body.error.code]).toEqual([403, "CAPABILITY_REQUIRED"]);
    made.open = ok(await h.as("ops").post("/library/categories").send({ name: "Registration & Statutory", audience: "everyone" }), 201);
    expect(made.open).toMatchObject({ name: "Registration & Statutory", audience: "everyone", roles: [], documents: 0, archived_at: null });
    const noRole = await h.as("ops").post("/library/categories").send({ name: "Finance Records", audience: "roles", role_ids: [] });
    expect([noRole.status, noRole.body.error.fields]).toEqual([422, { role_ids: ["Pick a role"] }]);
    const management = (await one("SELECT role_id FROM role WHERE code = 'management'")).role_id;
    made.finance = ok(await h.as("ops").post("/library/categories").send({ name: "Finance Records", audience: "roles", role_ids: [management] }), 201);
    expect(made.finance.roles).toEqual([{ role_id: management, name: expect.any(String) }]);
    const twice = await h.as("ops").post("/library/categories").send({ name: "finance records" });
    expect([twice.status, twice.body.error.fields]).toEqual([422, { name: ["Name already used"] }]);
    made.old = ok(await h.as("ops").post("/library/categories").send({ name: "Old Templates" }), 201);
    ok(await h.as("ops").post(`/library/categories/${made.old.document_category_id}/archive`).send({}));

    // Staff see the everyone category and not the one for Management; archived ones are the keepers'.
    const staffSees = ok(await h.as("staff").get("/library/categories")).data.map((c) => c.name);
    expect(staffSees).toEqual(["Registration & Statutory"]);
    const mgmtSees = ok(await h.as("mgmt").get("/library/categories")).data.map((c) => c.name);
    expect(mgmtSees).toEqual(["Finance Records", "Registration & Statutory"]);
    expect(ok(await h.as("ops").get("/library/categories?archived=true")).data.map((c) => c.name)).toEqual(["Old Templates"]);
    expect(ok(await h.as("staff").get("/library/categories?archived=true")).data).toEqual([]);
  });

  test("Upload Document: a staged file claimed as DOC-0001 in a category the uploader sees; the same file twice is refused", async () => {
    const file = await stage("hod", textPdf("Certificate of Incorporation for Lagoon Logistics Limited"), "cac.pdf");
    const forbidden = await upload("staff", { document_id: file, title: "CAC", document_category_id: made.open.document_category_id });
    expect(forbidden.status).toBe(403);
    const hidden = await upload("hod", { document_id: file, title: "CAC", document_category_id: made.finance.document_category_id });
    expect([hidden.status, hidden.body.error.fields]).toEqual([422, { document_category_id: ["Pick another category"] }]);
    const archived = await upload("hod", { document_id: file, title: "CAC", document_category_id: made.old.document_category_id });
    expect([archived.status, archived.body.error.fields]).toEqual([422, { document_category_id: ["Pick another category"] }]);

    const expires = lagos.addDays(lagos.today(), 30);
    made.cac = ok(
      await upload("hod", { document_id: file, title: "Certificate of Incorporation", document_category_id: made.open.document_category_id, tags: ["CAC", "Registration"], expires_on: expires }),
      201,
    );
    expect(made.cac).toMatchObject({
      document_id: file,
      title: "Certificate of Incorporation",
      doc_type: "company_document",
      type_label: "Company Document",
      area: "documents",
      area_label: "Company",
      number: "DOC-0001",
      expires_on: expires,
      status: "expiring",
      record: { type: "document_category", label: "Registration & Statutory", link: null },
      company: { category: { name: "Registration & Statutory" }, tags: ["cac", "registration"], may_edit: true, may_archive: false },
    });
    // The vault's row is now the company document's, about nobody.
    expect(await one("SELECT doc_type, entity_type, subject_employee_id, title FROM document WHERE document_id = $1", [file])).toEqual({
      doc_type: "company_document",
      entity_type: "company_document",
      subject_employee_id: null,
      title: "Certificate of Incorporation",
    });

    const again = await stage("ops", textPdf("Certificate of Incorporation for Lagoon Logistics Limited"), "cac-copy.pdf");
    const twice = await upload("ops", { document_id: again, title: "CAC again", document_category_id: made.open.document_category_id });
    expect([twice.status, twice.body.error.fields]).toEqual([422, { document_id: ["Already in library"] }]);

    // Everyone sees an everyone category's document; ops keep it, so its category opens for them.
    expect(ok(await h.as("staff").get(`/library/documents/${file}`)).company).toMatchObject({ may_edit: false, may_archive: false });
    expect(ok(await h.as("ops").get(`/library/documents/${file}`)).record.link).toBe(`/documents?tab=categories&id=${made.open.document_category_id}`);
    expect(ok(await h.as("staff").get("/library/tags")).data).toEqual([
      { tag: "cac", documents: 1 },
      { tag: "registration", documents: 1 },
    ]);
    expect(ok(await h.as("staff").get("/library/documents?tag=cac")).data.map((d) => d.document_id)).toEqual([file]);
    expect(ok(await h.as("staff").get(`/library/documents?category_id=${made.open.document_category_id}`)).data.map((d) => d.document_id)).toEqual([file]);
  });

  test("Edit Details: the uploader or documents.manage; another module's document is changed where it was made", async () => {
    const id = made.cac.document_id;
    const staff = await h.as("staff").patch(`/library/documents/${id}`).send({ title: "Mine now" });
    expect(staff.status).toBe(403);
    const edited = ok(await h.as("hod").patch(`/library/documents/${id}`).send({ title: "CAC Certificate", tags: ["cac"], expires_on: null, description: "Registered 2019." }));
    expect(edited).toMatchObject({ title: "CAC Certificate", expires_on: null, status: null, company: { tags: ["cac"], description: "Registered 2019." } });
    ok(await h.as("ops").patch(`/library/documents/${id}`).send({ document_category_id: made.finance.document_category_id }));
    // Narrowed to Management at once: staff can no longer open it, and the vault agrees.
    expect((await h.as("staff").get(`/library/documents/${id}`)).status).toBe(404);
    expect((await h.as("staff").get(`/documents/${id}/content`)).status).toBe(404);
    expect((await h.as("mgmt").get(`/documents/${id}/content`)).status).toBe(200);
    ok(await h.as("ops").patch(`/library/documents/${id}`).send({ document_category_id: made.open.document_category_id }));

    const own = await stage("staff", textPdf("A note of mine"), "note.pdf");
    await q(
      "UPDATE document SET doc_type = 'employee_document', entity_type = 'employee', entity_id = $2, subject_employee_id = $3 WHERE document_id = $1",
      [own, h.people.staff.employee_id, h.people.staff.employee_id],
    );
    const theirs = await h.as("ops").patch(`/library/documents/${own}`).send({ title: "Renamed" });
    expect([theirs.status, theirs.body.error.code]).toEqual([409, "DOCUMENT_NOT_YOURS"]);
  });

  test("Upload New Version: the next version of the same document; the old file is kept and its id opens the new one", async () => {
    const old = made.cac.document_id;
    const next = await stage("hod", textPdf("Certificate of Incorporation, certified true copy, Lagoon Logistics"), "cac-v2.pdf");
    const v2 = ok(await h.as("hod").post(`/library/documents/${old}/versions`).send({ document_id: next }), 201);
    expect(v2).toMatchObject({ document_id: next, version: 2, number: "DOC-0001", title: "CAC Certificate" });
    expect(ok(await h.as("staff").get(`/library/documents/${old}`)).document_id).toBe(next);
    expect(ok(await h.as("staff").get(`/documents/${next}/versions`)).data.map((d) => d.version)).toEqual([2, 1]);
    made.cac = v2;
  });

  test("Archive and Restore: those with delete who uploaded it or keep the library; archived, it leaves the list and the figures", async () => {
    const id = made.cac.document_id;
    expect((await h.as("hod").post(`/library/documents/${id}/archive`).send({})).status).toBe(403);
    const before = ok(await h.as("ops").get("/library/documents/summary")).documents;
    expect(ok(await h.as("ops").post(`/library/documents/${id}/archive`).send({}))).toMatchObject({ status: "archived" });
    expect(ok(await h.as("ops").get("/library/documents/summary")).documents).toBe(before - 1);
    expect(ok(await h.as("ops").get("/library/documents?archived=true")).data.map((d) => d.document_id)).toEqual([id]);
    expect((await h.as("staff").get(`/library/documents/${id}`)).status).toBe(404);
    // A download of an archived document still works for those who may list it.
    expect((await h.as("ops").get(`/documents/${id}/content`)).status).toBe(200);
    expect(ok(await h.as("ops").post(`/library/documents/${id}/restore`).send({})).status).toBeNull();
    expect((await h.as("staff").get(`/library/documents/${id}`)).status).toBe(200);
  });

  test("the files' text: a PDF and a Word file are read, a picture is found by name; a word inside finds the file for its readers only", async () => {
    const text = require("../../src/modules/library/library.text");
    const word = await stage("ops", await buildDocx({ title: "Premises Permit", body: "Issued to Lagoon Logistics for the Ikoyi warehouse." }), "permit.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const permit = ok(await upload("ops", { document_id: word, title: "Business Premises Permit", document_category_id: made.finance.document_category_id }), 201);
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const scan = ok(await upload("ops", { document_id: await stage("ops", png, "scan.png", "image/png"), title: "Scanned Tax Card", document_category_id: made.open.document_category_id }), 201);

    // Claiming a library type queues its text; the job reads it.
    const queued = queues.enqueue.mock.calls.filter(([queue]) => queue === "document-text").map(([, , data]) => data.document_id);
    await drain();
    const after = queues.enqueue.mock.calls.filter(([queue]) => queue === "document-text").map(([, , data]) => data.document_id);
    expect(after).toEqual(expect.arrayContaining([word, scan.document_id, made.cac.document_id].filter((x) => !queued.includes(x) || true)));
    for (const id of [made.cac.document_id, word, scan.document_id]) await text.read(id);
    expect(await one("SELECT status, pages FROM document_text WHERE document_id = $1", [made.cac.document_id])).toEqual({ status: "done", pages: 1 });
    expect((await one("SELECT status, text FROM document_text WHERE document_id = $1", [word])).text).toContain("Ikoyi warehouse");
    expect((await one("SELECT status FROM document_text WHERE document_id = $1", [scan.document_id])).status).toBe("empty");
    // Read once: a second run changes nothing.
    expect(await text.read(word)).toEqual({ status: "done" });

    const found = ok(await h.as("mgmt").get("/library/documents?q=ikoyi%20warehouse"));
    expect(found.data.map((d) => [d.document_id, d.matched_text])).toEqual([[permit.document_id, expect.stringContaining("Ikoyi warehouse")]]);
    // Every word is held to the row: one in the title, one in the text.
    expect(ok(await h.as("mgmt").get("/library/documents?q=permit%20ikoyi")).data.map((d) => d.document_id)).toEqual([permit.document_id]);
    // Staff do not see Finance Records, so a word inside its file finds nothing for them.
    expect(ok(await h.as("staff").get("/library/documents?q=ikoyi")).data).toEqual([]);
    expect(ok(await h.as("staff").get("/library/documents?q=certified%20true")).data.map((d) => d.document_id)).toEqual([made.cac.document_id]);
    // ⌘K finds it by a word inside, for the same readers.
    const search = async (who, term) => ok(await h.as(who).get(`/search?q=${encodeURIComponent(term)}`));
    const ids = (body) => JSON.stringify(body);
    expect(ids(await search("mgmt", "Ikoyi warehouse"))).toContain(permit.document_id);
    expect(ids(await search("staff", "Ikoyi warehouse"))).not.toContain(permit.document_id);

    // The nightly sweep queues what has no text yet, and nothing it has read.
    queues.enqueue.mockClear();
    await q("DELETE FROM document_text WHERE document_id = $1", [scan.document_id]);
    await text.sweep();
    const swept = queues.enqueue.mock.calls.map(([, , data]) => data.document_id);
    expect(swept).toContain(scan.document_id);
    expect(swept).not.toContain(word);
  });

  test("the letterhead: PDF through the worker's render, Word with its header, picture rule and footer; each the asker's alone", async () => {
    const pdf = await h.as("staff").post("/library/letterhead").send({ format: "pdf" });
    expect([pdf.status, pdf.body.status]).toEqual([202, "pending"]);
    const html = [];
    const done = await documents.renderPending(pdf.body.document_id, { db: pool, renderPdf: async (page) => (html.push(page), textPdf("Letterhead")) });
    expect(done.render_status).toBe("done");
    expect(html[0]).toContain("lh-head");
    expect(html[0]).not.toContain('class="lh-title"');
    expect((await h.as("staff").get(`/documents/${pdf.body.document_id}/content`)).status).toBe(200);
    expect((await h.as("ops").get(`/documents/${pdf.body.document_id}/content`)).status).toBe(404);

    const word = await h.as("staff").post("/library/letterhead").send({ format: "docx" });
    expect([word.status, word.body.status]).toEqual([202, "pending"]);
    await drain();
    expect(ok(await h.as("staff").get(`/exports/${word.body.document_id}`)).status).toBe("done");
    const row = await one("SELECT storage_key, doc_type FROM document WHERE document_id = $1", [word.body.document_id]);
    expect(row.doc_type).toBe("letterhead_export");
    const zip = await JSZip.loadAsync(await storage.get(row.storage_key));
    expect(await zip.file("word/header1.xml").async("string")).toContain('w:color="FFDF55"');
    expect(await zip.file("word/footer1.xml").async("string")).toContain("MyCity");
  });

  test("expiry: the reminder tells 60, 30 and 7 days ahead and on the day, once each, to the uploader and documents.manage; Home's alert opens the Library", async () => {
    const service = require("../../src/modules/library/library.service");
    const today = lagos.today();
    const ends = lagos.addDays(today, 60);
    const file = await stage("hod", textPdf("Operating licence of Lagoon Logistics"), "licence.pdf");
    const licence = ok(await upload("hod", { document_id: file, title: "Operating Licence", document_category_id: made.open.document_category_id, expires_on: ends }), 201);
    const at = (days) => lagos.instant(lagos.addDays(ends, -days), "10:00");
    for (const days of [60, 30, 7, 0]) {
      const due = await service.remindersDue(pool, { now: at(days) });
      expect([days, due.filter((d) => d.entity_id === licence.company.company_document_id).map((d) => d.occurrence)]).toEqual([days, [`${ends}:${days}`]]);
    }
    for (const days of [59, 31, 8, 1]) {
      const due = await service.remindersDue(pool, { now: at(days) });
      expect([days, due.filter((d) => d.entity_id === licence.company.company_document_id)]).toEqual([days, []]);
    }
    const check = await service.reminderCheck(pool, { entity_id: licence.company.company_document_id, occurrence: `${ends}:30` }, { now: at(30) });
    expect(check.payload).toMatchObject({ title: "Operating Licence", expires_on: ends, days_left: 30 });
    // A changed expiry ends the old occurrence.
    expect(await service.reminderCheck(pool, { entity_id: licence.company.company_document_id, occurrence: `${today}:0` }, { now: at(30) })).toBeNull();
    const told = await require("../../src/modules/library/library.repo").expiryAudience(pool, licence.company.company_document_id);
    expect(told).toEqual(expect.arrayContaining([h.people.hod.user_id, h.people.ops.user_id]));
    expect(told).not.toContain(h.people.staff.user_id);

    // Home's document_expiry alert: a company document's subject is library_item, so it opens the Library.
    const { METRICS } = require("../../src/modules/alerts/alerts.metrics");
    const batch = await METRICS.document_expiry.evaluate(pool, { threshold: 90, unit: "days" }, { today });
    const mine = batch.readings.find((b) => b.subject && b.subject.id === file);
    expect(mine && mine.subject.type).toBe("library_item");

    // Archived, it raises nothing.
    ok(await h.as("ops").post(`/library/documents/${file}/archive`).send({}));
    expect((await service.remindersDue(pool, { now: at(30) })).filter((d) => d.entity_id === licence.company.company_document_id)).toEqual([]);
    expect(await service.reminderCheck(pool, { entity_id: licence.company.company_document_id, occurrence: `${ends}:30` }, { now: at(30) })).toBeNull();
  });

  test("Praxis AI: documents.find reads by the asker's rights and never a file's words; the cards run the screen's own functions", async () => {
    const card = async (who, key, values) => {
      script(say({ text: "Here it is.", action: { key, values, suggested: false } }));
      const asked = await h.ask(who, { question: "Draft it.", shows: ["cards"] });
      expect([key, asked.status, asked.body.error]).toEqual([key, 200, undefined]);
      return asked.body.card;
    };
    // The read finds a word inside a file by the asker's own rights, and never returns the words found.
    const manifest = require("../../src/modules/library/library.ai");
    const find = manifest.reads.find((r) => r.key === "documents.find");
    const staffUser = await require("../../src/shared/rbac/grants-cache").getAuthUser(pool, h.people.staff.user_id);
    const read = await find.run(pool, { page: 1, q: "certified" }, staffUser);
    expect(read.data.map((d) => [d.document_id, d.matched_text])).toEqual([[made.cac.document_id, null]]);

    const add = await card("ops", "documents.category_create", { name: "Templates", description: "Blank forms." });
    expect((await h.press("ops", add.ai_action_draft_id)).status).toBe(200);
    const templates = await one("SELECT document_category_id, audience FROM document_category WHERE name = 'Templates'");
    expect(templates.audience).toBe("everyone");

    const rename = await card("ops", "documents.category_edit", { document_category_id: "Templates", name: "Forms & Templates" });
    expect(rename).toMatchObject({ values: { document_category_id: templates.document_category_id }, problems: {} });
    expect((await h.press("ops", rename.ai_action_draft_id)).status).toBe(200);
    expect((await one("SELECT name::text FROM document_category WHERE document_category_id = $1", [templates.document_category_id])).name).toBe("Forms & Templates");

    const edit = await card("hod", "documents.edit_details", { document_id: made.cac.document_id, title: "CAC Certificate (Certified)" });
    expect(edit.problems).toEqual({});
    expect((await h.press("hod", edit.ai_action_draft_id)).status).toBe(200);
    expect((await one("SELECT title FROM company_document WHERE document_id = $1", [made.cac.document_id])).title).toBe("CAC Certificate (Certified)");

    // Staff are never offered the category cards.
    script(say({ text: "Here it is.", action: { key: "documents.category_create", values: { name: "Snacks" }, suggested: false } }));
    expect((await h.ask("staff", { question: "Add a category called Snacks.", shows: ["cards"] })).body.card).toBeNull();
  });
});
