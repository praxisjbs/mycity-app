"use strict";
/**
 * The Document Centre's one rule, proved (docs/guides/document-centre.md §6.3): the Library never
 * lists a document vault.canRead() would refuse, and lists every document of a library type that
 * canRead() allows. Both directions, for every system role, the CEO and three made-up roles that
 * hold the scopes the system roles do not, over documents of every library type: with and without
 * a subject, uploaded by the reader or not, normal and restricted.
 *
 * A source whose SQL drifts from its vault rule fails here, whichever way it drifts.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/library-access
 *
 * The real migrations on a throwaway database, the whole app through HTTP for the routes. Every
 * organisation and person is invented.
 */
const crypto = require("node:crypto");
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const vault = require("../../src/shared/documents/vault");
const docTypes = require("../../src/shared/documents/types");
const library = require("../../src/shared/documents/library");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0] || null;
const PASSWORD = "Library-Shelf7Read";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

describeDb("document centre: the library lists what the vault lets a reader open, and nothing else", () => {
  let app;
  const people = {};
  const tokens = {};
  const readers = {};
  const docs = [];
  const emp = (who) => people[who].employee.employee_id;
  const user = (who) => people[who].user.user_id;
  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
  });

  /** A row of the vault, filled by hand: every column the schema requires, and what the test is about. */
  async function doc(over) {
    const row = {
      doc_type: "employee_document",
      title: null,
      original_name: "file.pdf",
      entity_type: "employee",
      entity_id: crypto.randomUUID(),
      subject_employee_id: null,
      uploaded_by: null,
      sensitivity: "normal",
      is_current: true,
      scan_status: "skipped",
      render_status: null,
      locked_at: null,
      expires_on: null,
      number: null,
      ...over,
    };
    const made = await one(
      `INSERT INTO document (doc_type, title, original_name, storage_key, mime, bytes, entity_type, entity_id, subject_employee_id,
                             uploaded_by, sensitivity, is_current, scan_status, render_status, locked_at, expires_on, number, source)
       VALUES ($1, $2, $3, $4, 'application/pdf', 1200, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'upload')
       RETURNING document_id, doc_type, entity_type, entity_id, subject_employee_id, uploaded_by, sensitivity, is_current, scan_status, render_status`,
      [row.doc_type, row.title, row.original_name, `vault/test/${crypto.randomUUID()}.pdf`, row.entity_type, String(row.entity_id), row.subject_employee_id,
        row.uploaded_by, row.sensitivity, row.is_current, row.scan_status, row.render_status, row.locked_at, row.expires_on, row.number],
    );
    docs.push(made);
    return made;
  }

  /** The ids the library's condition lets this reader see, the read rule alone (no `listed` narrowing). */
  async function readableIds(who) {
    const params = [];
    const { sql } = library.readable(await library.reach(pool, readers[who]), params, { listed: false });
    const { rows } = await q(`SELECT d.document_id FROM document d WHERE ${sql}`, params);
    return rows.map((r) => r.document_id).sort();
  }

  /** Every page of GET /library/documents for this reader. */
  async function listed(who, query = "") {
    const ids = [];
    for (let page = 1; page < 100; page += 1) {
      const res = await as(who).get(`/library/documents?page=${page}${query}`);
      expect([res.status, res.body.error]).toEqual([200, undefined]);
      ids.push(...res.body.data.map((d) => d.document_id));
      if (!res.body.page.has_next) return ids;
    }
    throw new Error("the library never ended");
  }

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
    await make("impl", "Ife", "Adewale", "implementation", "Build Lead", "Technology");
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("mgmt", "Hauwa", "Sule", "management", "General Manager", "Management");
    await make("hod", "Chidi", "Eze", "head_of_department", "Head of Growth");
    await make("admin", "Rita", "Okon", "administrator", "System Administrator", "Technology");
    await make("ceo", "Ada", "Okafor", "management", "Chief Executive Officer", "Management", true);
    await make("manager", "Kemi", "Alade", "manager", "Growth Lead");
    await make("staff", "Musa", "Danjuma", "employee", "Growth Officer");
    await make("peer", "Bola", "Ige", "employee", "Growth Officer");
    await make("other", "Zainab", "Lawal", "employee", "Brand Officer", "Marketing");
    // Three readers who hold what no system role does: a module seen without its `edit` (restricted
    // files stay shut), a module seen over a team, and Partnerships over their own records only.
    await make("viewer", "Femi", "Ojo", "employee", "Auditor", "Finance");
    await make("lead", "Sade", "Bello", "employee", "Team Lead", "Finance");
    await make("seller", "Emeka", "Nwosu", "employee", "Partnerships Officer");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("manager"), [emp("staff"), emp("peer")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("lead"), emp("other")]);
    const role = async (code, grants) => {
      const r = await one("INSERT INTO role (code, name) VALUES ($1, $2) RETURNING role_id", [code, code]);
      for (const [module, scope, edit] of grants)
        await q("INSERT INTO permission (role_id, module_key, scope, can_view, can_edit) VALUES ($1, $2, $3, true, $4)", [r.role_id, module, scope, edit]);
      return r.role_id;
    };
    const give = (who, roleId) => q("INSERT INTO user_role (user_id, role_id) VALUES ($1, $2)", [user(who), roleId]);
    const everything = ["people", "queries", "recruitment", "payroll", "partnerships", "expenses", "knowledge"];
    await give("viewer", await role("library_viewer", [...everything.map((m) => [m, "all", false]), ["documents", "all", false]]));
    await give("lead", await role("library_team", [...everything.map((m) => [m, "team", true]), ["documents", "all", false]]));
    await give("seller", await role("library_seller", [["partnerships", "own", false], ["documents", "all", false]]));
    await grantsCache.invalidateGrants();
    await grantsCache.bumpTeamVersion();

    for (const key of Object.keys(people)) {
      await grantsCache.invalidateUser(user(key));
      readers[key] = await grantsCache.getAuthUser(pool, user(key));
    }

    // Every default-rule type: about nobody, about three different people, uploaded by three more.
    const defaults = library.sources().filter((s) => s.default);
    for (const s of defaults) {
      for (const docType of s.doc_types) {
        const sensitivity = docTypes.typeOf(docType).sensitivity;
        for (const subject of [null, "staff", "other", "hod"]) {
          for (const uploader of [null, "ops", "peer"]) {
            for (const level of new Set([sensitivity, "restricted"])) {
              await doc({ doc_type: docType, entity_type: s.entities[0], subject_employee_id: subject && emp(subject), uploaded_by: uploader && user(uploader), sensitivity: level });
            }
          }
        }
      }
    }

    // Partnerships: a partner the seller owns, one the seller only works a deal of, one that is another's, and a lead.
    const partner = async (number, name, owner) => (await one("INSERT INTO partner (number, name, owner_id) VALUES ($1, $2, $3) RETURNING partner_id", [number, name, owner && emp(owner)])).partner_id;
    const deal = async (number, { partner_id = null, lead_id = null, owner = null, members = [] }) => {
      const d = await one(
        "INSERT INTO partnership_opportunity (number, title, stage, partner_id, lead_id, owner_id) VALUES ($1, $2, 'prospect_identified', $3, $4, $5) RETURNING partnership_opportunity_id",
        [number, `Deal ${number}`, partner_id, lead_id, owner && emp(owner)],
      );
      for (const m of members) await q("INSERT INTO deal_member (deal_id, employee_id) VALUES ($1, $2)", [d.partnership_opportunity_id, emp(m)]);
      return d.partnership_opportunity_id;
    };
    const owned = await partner("PAR-9101", "Chowline Foods", "seller");
    const worked = await partner("PAR-9102", "Lekki Arena", "other");
    const theirs = await partner("PAR-9103", "Yaba Studios", "other");
    const lead = (await one("INSERT INTO lead (number, name, owner_id) VALUES ('LED-9101', 'Ikoyi Events', $1) RETURNING lead_id", [emp("seller")])).lead_id;
    const ownedDeal = await deal("DEAL-9101", { partner_id: owned, owner: "seller" });
    const workedDeal = await deal("DEAL-9102", { partner_id: worked, owner: "other", members: ["seller"] });
    const theirDeal = await deal("DEAL-9103", { partner_id: theirs, owner: "other" });
    const partnerFile = async (on) => {
      const d = await doc({ doc_type: "partner_document", entity_type: "partner_document", uploaded_by: user("other") });
      const pd = await one(
        "INSERT INTO partner_document (document_id, partner_id, lead_id, kind) VALUES ($1, $2, $3, 'mou') RETURNING partner_document_id",
        [d.document_id, on.partner_id || null, on.lead_id || null],
      );
      await q("UPDATE document SET entity_id = $2 WHERE document_id = $1", [d.document_id, pd.partner_document_id]);
      d.entity_id = pd.partner_document_id;
      return d;
    };
    for (const on of [{ partner_id: owned }, { partner_id: worked }, { partner_id: theirs }, { lead_id: lead }]) await partnerFile(on);

    // Agreements: on each deal, and one with no deal at all (seen under `all` only).
    let n = 0;
    const agreement = async ({ partner_id = null, deal_id = null }) => {
      n += 1;
      const a = await one(
        "INSERT INTO partnership_agreement (number, title, partner_id, partnership_opportunity_id, kind, status) VALUES ($1, $2, $3, $4, 'service_agreement', 'signed') RETURNING partnership_agreement_id",
        [`AGR-9${n}`, `Service Agreement ${n}`, partner_id, deal_id],
      );
      const d = await doc({ doc_type: "partnership_agreement", entity_type: "agreement", entity_id: a.partnership_agreement_id, title: `Service Agreement ${n}`, uploaded_by: user("seller") });
      await q("UPDATE partnership_agreement SET document_id = $2 WHERE partnership_agreement_id = $1", [a.partnership_agreement_id, d.document_id]);
      return { ...a, document: d };
    };
    people.agreements = {
      owned: await agreement({ partner_id: owned, deal_id: ownedDeal }),
      worked: await agreement({ partner_id: worked, deal_id: workedDeal }),
      theirs: await agreement({ partner_id: theirs, deal_id: theirDeal }),
      loose: await agreement({ partner_id: theirs }),
    };

    // Training certificates and SOP files: their own rules.
    for (const subject of ["staff", "other"])
      await doc({ doc_type: "training_certificate", entity_type: "training_enrolment", subject_employee_id: emp(subject), sensitivity: "personal" });
    await doc({ doc_type: "sop_file", entity_type: "sop", uploaded_by: user("ops") });

    // Company documents (§6.4): a category seen by everyone, one by Management alone, and one by roles
    // that are all gone; in each a document Head of Department uploaded, one archived in the first,
    // and a version replaced. Their rule is the category's audience, the uploader, or documents.manage.
    const category = async (name, audience, roleCodes = []) => {
      const c = await one("INSERT INTO document_category (name, audience) VALUES ($1, $2) RETURNING document_category_id", [name, audience]);
      for (const code of roleCodes)
        await q("INSERT INTO document_category_role (document_category_id, role_id) SELECT $1, role_id FROM role WHERE code = $2", [c.document_category_id, code]);
      return c.document_category_id;
    };
    let companyNo = 0;
    const companyDoc = async (categoryId, { by = "hod", archived = false, current = true } = {}) => {
      companyNo += 1;
      const d = await doc({ doc_type: "company_document", entity_type: "company_document", uploaded_by: user(by), title: `Company Paper ${companyNo}`, is_current: current });
      const cd = await one(
        `INSERT INTO company_document (number, document_id, document_category_id, title, created_by, archived_at, archived_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING company_document_id`,
        [`DOC-9${companyNo}`, d.document_id, categoryId, `Company Paper ${companyNo}`, user(by), archived ? new Date() : null, archived ? user("ops") : null],
      );
      await q("UPDATE document SET entity_id = $2 WHERE document_id = $1", [d.document_id, cd.company_document_id]);
      d.entity_id = cd.company_document_id;
      return d;
    };
    const open = await category("Registration", "everyone");
    const managers = await category("Finance Records", "roles", ["management"]);
    const nobody = await category("Board Papers", "roles");
    people.company = {
      open: await companyDoc(open),
      managers: await companyDoc(managers),
      nobody: await companyDoc(nobody),
      staffOwn: await companyDoc(nobody, { by: "staff" }),
      archived: await companyDoc(open, { archived: true }),
      replaced: await companyDoc(open, { current: false }),
    };

    // What is never a library row, whoever asks: not a library type, or a file that cannot be opened.
    await doc({ doc_type: "payslip", entity_type: "payslip", subject_employee_id: emp("staff"), sensitivity: "restricted" });
    await doc({ doc_type: "community_media", entity_type: "community_channel", uploaded_by: user("staff") });
    await doc({ doc_type: "brand_image", entity_type: "brand", entity_id: "logo" });
    await doc({ doc_type: "staged_upload", entity_type: "app_user", entity_id: user("staff"), subject_employee_id: emp("staff"), uploaded_by: user("staff"), sensitivity: "personal" });
    await doc({ subject_employee_id: emp("staff"), is_current: false });
    await doc({ subject_employee_id: emp("staff"), scan_status: "pending" });
    await doc({ subject_employee_id: emp("staff"), scan_status: "infected" });
    await doc({ doc_type: "offer_letter", entity_type: "offer", subject_employee_id: emp("staff"), render_status: "pending" });
    // A library type stored against an entity its source does not name is not that source's to list.
    await doc({ doc_type: "employee_document", entity_type: "brand", entity_id: "logo", subject_employee_id: emp("staff") });

    let ip = 0;
    for (const key of Object.keys(people)) {
      if (!people[key].user) continue;
      ip += 1;
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.72.0.${ip}`).send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  }, 240000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  const everyone = ["impl", "ops", "mgmt", "hod", "admin", "ceo", "manager", "staff", "peer", "other", "viewer", "lead", "seller"];
  const libraryTypes = () => new Set(library.sources().flatMap((s) => s.doc_types));
  const entitiesOf = (docType) => library.sources().find((s) => s.doc_types.includes(docType)).entities;
  /** A file that can be opened: what a library row must be, whoever asks. */
  const openable = (d) => d.is_current && ["clean", "skipped"].includes(d.scan_status) && (d.render_status || "done") === "done";

  test("every registered document type is given to the library by a source, or named as left out", () => {
    expect(library.unaccounted()).toEqual([]);
    expect(library.sources().flatMap((s) => s.doc_types).sort()).toEqual([
      "company_document", "disbursement_receipt", "employee_certificate", "employee_document", "employee_identification", "employment_contract",
      "expense_invoice", "leaving_certificate", "offer_letter", "partner_document", "partnership_agreement", "proposal",
      "query_letter", "rent_evidence", "sanction_letter", "sop_file", "statutory_source", "training_certificate",
    ]);
  });

  test.each(everyone)("%s: the library's condition and vault.canRead agree on every document, both ways", async (who) => {
    const types = libraryTypes();
    const expected = [];
    for (const d of docs) {
      const ofLibrary = types.has(d.doc_type) && entitiesOf(d.doc_type).includes(d.entity_type);
      if (ofLibrary && openable(d) && (await vault.canRead(pool, readers[who], d))) expected.push(d.document_id);
    }
    const got = await readableIds(who);
    // Never more than the vault allows (the security rule), and never less (completeness).
    expect(got.filter((id) => !expected.includes(id))).toEqual([]);
    expect(expected.filter((id) => !got.includes(id))).toEqual([]);
    expect(got.length).toBe(expected.length);
  });

  test("the readers differ as their grants do: the proof is not an empty set on both sides", async () => {
    const count = async (who) => (await readableIds(who)).length;
    const all = await count("ceo");
    expect(all).toBeGreaterThan(250);
    expect(await count("ops")).toBeLessThanOrEqual(all);
    // Staff see their own and what they uploaded; a module seen without `edit` shuts its restricted files.
    expect(await count("staff")).toBeLessThan(all);
    expect(await count("staff")).toBeGreaterThan(0);
    expect(await count("viewer")).toBeLessThan(await count("ops"));
  });

  test("a company document follows its category's audience, its uploader and documents.manage; an archived one is the keepers' alone", async () => {
    const c = people.company;
    const sees = async (who) => new Set(await readableIds(who));
    const has = (set, d) => set.has(d.document_id);
    for (const who of ["ceo", "ops", "admin", "impl"]) {
      const s = await sees(who);
      expect([who, has(s, c.open), has(s, c.managers), has(s, c.nobody), has(s, c.archived)]).toEqual([who, true, true, true, true]);
    }
    const mgmt = await sees("mgmt");
    expect([has(mgmt, c.open), has(mgmt, c.managers), has(mgmt, c.nobody), has(mgmt, c.archived)]).toEqual([true, true, false, false]);
    const hod = await sees("hod");
    // Head of Department uploaded all three: their own, but never once archived.
    expect([has(hod, c.open), has(hod, c.managers), has(hod, c.nobody), has(hod, c.archived)]).toEqual([true, true, true, false]);
    const staff = await sees("staff");
    expect([has(staff, c.open), has(staff, c.managers), has(staff, c.nobody), has(staff, c.staffOwn)]).toEqual([true, false, false, true]);
    // A replaced version is never a row, whoever asks.
    expect(has(await sees("ceo"), c.replaced)).toBe(false);
    // The list hides an archived one unless its keeper asks for the Archived filter; nobody else ever gets it.
    expect(await listed("ops")).not.toContain(c.archived.document_id);
    expect(await listed("ops", "&archived=true")).toEqual([c.archived.document_id]);
    expect(await listed("mgmt", "&archived=true")).toEqual([]);
    expect((await as("staff").get(`/library/documents/${c.managers.document_id}`)).status).toBe(404);
  });

  test("Partnerships follows the record: an owner, a deal's member, and nobody else", async () => {
    const seen = await readableIds("seller");
    const a = people.agreements;
    expect(seen).toEqual(expect.arrayContaining([a.owned.document.document_id, a.worked.document.document_id]));
    expect(seen).not.toContain(a.theirs.document.document_id);
    // An agreement with no deal is seen only by a reader whose scope is `all`.
    expect(seen).not.toContain(a.loose.document.document_id);
    expect(await readableIds("ops")).toContain(a.loose.document.document_id);
    // A reader with no Partnerships grant finds none of them, in the list or by its id.
    expect(await readableIds("staff")).not.toContain(a.owned.document.document_id);
    expect((await as("staff").get(`/library/documents/${a.owned.document.document_id}`)).status).toBe(404);
  });

  test("the list answers in the contract's shape, by the same rule, 25 a page, and names what a file belongs to", async () => {
    const ids = await listed("seller", "&area=partnerships");
    const a = people.agreements;
    expect(ids).toEqual(expect.arrayContaining([a.owned.document.document_id, a.worked.document.document_id]));
    expect(ids).not.toContain(a.theirs.document.document_id);
    const res = await as("seller").get(`/library/documents/${a.owned.document.document_id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: "Service Agreement 1",
      doc_type: "partnership_agreement",
      type_label: "Service Agreement",
      area: "partnerships",
      area_label: "Partnerships",
      record: { type: "agreement", label: "Chowline Foods", ref: "AGR-91", link: `/partnerships?tab=contracts-and-mous&id=${a.owned.partnership_agreement_id}` },
      mime: "application/pdf",
      status: null,
    });
    const first = await as("ops").get("/library/documents");
    expect(first.body.page).toMatchObject({ number: 1, size: 25 });
    expect(first.body.data).toHaveLength(25);
    expect(first.body.page.total).toBe((await listed("ops")).length);
  });

  test("an agreement lists the file it holds now: a draft drawn again leaves the one before it behind", async () => {
    const a = people.agreements.owned;
    const sealed = await doc({ doc_type: "partnership_agreement", entity_type: "agreement", entity_id: a.partnership_agreement_id, title: "Service Agreement 1, Signed", locked_at: new Date() });
    await q("UPDATE partnership_agreement SET signed_document_id = $2, ends_on = CURRENT_DATE + 20 WHERE partnership_agreement_id = $1", [a.partnership_agreement_id, sealed.document_id]);
    const ids = await listed("seller", "&doc_type=partnership_agreement");
    expect(ids).toContain(sealed.document_id);
    expect(ids).not.toContain(a.document.document_id);
    // Both are the seller's to open: only what the agreement holds is a row.
    expect(await vault.canRead(pool, readers.seller, a.document)).toBe(true);
    expect((await as("seller").get(`/library/documents/${a.document.document_id}`)).status).toBe(404);
    // Its term makes it Expiring, and it is Signed: the nearer fact shows, both filters find it.
    const row = (await as("seller").get(`/library/documents/${sealed.document_id}`)).body;
    expect(row).toMatchObject({ status: "expiring", locked_at: expect.any(String), expires_on: expect.any(String) });
    expect(await listed("seller", "&status=expiring")).toContain(sealed.document_id);
    expect(await listed("seller", "&status=signed")).toContain(sealed.document_id);
  });

  test("search, filters and sort are the server's, over the whole library", async () => {
    const mine = await doc({ title: "Passport Data Page", entity_id: emp("staff"), subject_employee_id: emp("staff"), uploaded_by: user("staff"), doc_type: "employee_identification", sensitivity: "restricted", expires_on: "2020-01-01" });
    // Every word is held to the row, in any order, across its title, its type and whom it belongs to.
    expect(await listed("staff", "&q=passport")).toEqual([mine.document_id]);
    expect(await listed("staff", `&q=${encodeURIComponent("danjuma identification")}`)).toContain(mine.document_id);
    expect(await listed("staff", "&q=zebra")).toEqual([]);
    expect(await listed("staff", "&doc_type=employee_identification&status=expiring")).toEqual([mine.document_id]);
    expect(await listed("staff", "&added=this_month")).toContain(mine.document_id);
    const byTitle = await as("staff").get("/library/documents?sort=title");
    const titles = byTitle.body.data.map((d) => d.title.toLowerCase());
    expect(titles).toEqual([...titles].sort((x, y) => x.localeCompare(y)));
    const newest = await as("staff").get("/library/documents");
    expect(newest.body.data[0].document_id).toBe(mine.document_id);
    // An unknown filter, a page size and a sort the list does not allow are refused, not ignored.
    expect((await as("staff").get("/library/documents?limit=500")).status).toBe(422);
    expect((await as("staff").get("/library/documents?sort=bytes")).status).toBe(422);
    // Their own record opens on Self-Service; People's screen is not theirs to open.
    const row = (await as("staff").get(`/library/documents/${mine.document_id}`)).body;
    expect(row.record).toMatchObject({ type: "employee", label: "Musa Danjuma", link: `/ess?tab=my-profile&id=${emp("staff")}` });
    const seenByOps = (await as("ops").get(`/library/documents/${mine.document_id}`)).body;
    expect(seenByOps.record.link).toBe(`/people?tab=employees&id=${emp("staff")}`);
  });

  test("the figures count what the reader may see, and the filters offer what they can reach", async () => {
    const s = (await as("staff").get("/library/documents/summary")).body;
    expect(s.documents).toBe((await listed("staff")).length);
    expect(s.expiring).toBe((await listed("staff", "&status=expiring")).length);
    expect(s.signed).toBe((await listed("staff", "&status=signed")).length);
    expect(s.added_this_month).toBe(s.documents);
    const f = (await as("seller").get("/library/filters")).body;
    expect(f.areas.map((a) => a.area)).toContain("partnerships");
    expect(f.types.find((t) => t.doc_type === "partnership_agreement")).toEqual({ doc_type: "partnership_agreement", label: "Agreement", area: "partnerships" });
    // A type the reader holds no document of is not offered: staff have no agreement to find.
    const staffs = (await as("staff").get("/library/filters")).body;
    expect(staffs.types.map((t) => t.doc_type)).not.toContain("partnership_agreement");
    expect(staffs.areas.map((a) => a.area)).not.toContain("partnerships");
    expect(staffs.types.map((t) => t.doc_type)).toContain("employee_document");
  });

  test("an earlier version's id answers the version that replaced it", async () => {
    const old = await doc({ title: "Lease v1", subject_employee_id: emp("peer"), is_current: false });
    const next = await doc({ title: "Lease v2", subject_employee_id: emp("peer") });
    await q("UPDATE document SET supersedes_id = $2, version = 2 WHERE document_id = $1", [next.document_id, old.document_id]);
    const res = await as("peer").get(`/library/documents/${old.document_id}`);
    expect([res.status, res.body.document_id, res.body.title, res.body.version]).toEqual([200, next.document_id, "Lease v2", 2]);
  });

  test("⌘K finds the same documents by the same rule and opens the Library on them", async () => {
    const a = people.agreements;
    const found = async (who, term) => {
      const res = await as(who).get(`/search?q=${encodeURIComponent(term)}`);
      expect(res.status).toBe(200);
      const group = res.body.groups.find((g) => g.type === "library_item");
      return group ? group.items : [];
    };
    // "Lekki Arena" is the partner the second agreement is with: a document is found by what it belongs to.
    const sellers = await found("seller", "lekki arena");
    expect(sellers.map((i) => i.id)).toContain(a.worked.document.document_id);
    expect((await found("seller", "yaba studios")).map((i) => i.id)).not.toContain(a.theirs.document.document_id);
    expect(sellers.find((i) => i.id === a.worked.document.document_id)).toMatchObject({
      title: "Service Agreement 2",
      link: `/documents?tab=library&id=${a.worked.document.document_id}`,
    });
    expect((await found("staff", "lekki arena")).map((i) => i.id)).toEqual([]);
    expect((await found("ops", "chowline")).length).toBeGreaterThan(0);
  });

  test("the grant opens the screen: without it every route answers 403", async () => {
    await q("DELETE FROM permission WHERE module_key = 'documents' AND role_id = (SELECT role_id FROM role WHERE code = 'employee')");
    await grantsCache.invalidateGrants();
    for (const path of ["/library/documents", "/library/documents/summary", "/library/filters"]) expect((await as("peer").get(path)).status).toBe(403);
  });
});
