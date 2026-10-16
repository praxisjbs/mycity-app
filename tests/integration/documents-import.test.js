"use strict";
/**
 * Documents, generated PDFs, system mail and the import engine against a real Postgres,
 * with the real tools: sharp, Chromium, ffmpeg.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration
 *
 * A test that needs Chromium or ffmpeg is skipped, saying so, when the machine has none.
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const express = require("express");
const request = require("supertest");
const sharp = require("sharp");
const ExcelJS = require("exceljs");
const { z } = require("zod");
const { config } = require("../../src/config/env");
const schema = require("./helpers/schema");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { defineEvents } = require("../../src/shared/events/catalogue");
const { emit } = require("../../src/shared/events/emit");
const vault = require("../../src/shared/documents/vault");
const { defineDocumentType } = require("../../src/shared/documents/types");
const documents = require("../../src/shared/documents/generate");
const templates = require("../../src/shared/templates/template-store");
const variables = require("../../src/shared/templates/variables");
const storage = require("../../src/services/storage/storage.service");
const av = require("../../src/services/media/av-pipeline");
const chromium = require("../../src/services/pdf/chromium");
const reconcile = require("../../src/services/media/reconcile");
const mail = require("../../src/services/mail/system-mail.service");
const { sha256 } = require("../../src/shared/files/hash");
const registry = require("../../src/shared/import/registry");
const engine = require("../../src/shared/import/engine");
const { revert } = require("../../src/shared/import/revert");
const report = require("../../src/shared/import/report");

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const hasChromium = (() => {
  try {
    return Boolean(chromium.resolvePath());
  } catch {
    return false;
  }
})();
const hasFfmpeg = (() => {
  try {
    execFileSync(config.FFMPEG_PATH, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const EV = defineEvents("people", {
  "test_person.created": { summary: "A test person was created" },
  "test_person.updated": { summary: "A test person was changed" },
  "test_person.archived": { summary: "A test person was archived" },
  "test_department.created": { summary: "A test department was created" },
});

const people = {};

async function seed() {
  const emp = async (first, last, manager = null) =>
    (
      await one(
        schema.sql.employee,
        [first, last, manager],
      )
    ).employee_id;
  const user = async (key, employeeId, isCeo = false) => {
    const u = await one(
      schema.sql.user,
      [employeeId, `${key}@mycity.test`, isCeo],
    );
    people[key] = {
      user_id: u.user_id,
      employee_id: employeeId,
      is_ceo: isCeo,
      role_ids: [],
      display_name: key,
      email: `${key}@mycity.test`,
    };
  };
  const role = async (code, perms) => {
    const r = await one(
      schema.sql.role,
      [code],
    );
    for (const [module, scope, actions] of perms) {
      await q(
        `INSERT INTO permission (role_id, module_key, scope, can_view, can_create, can_edit, can_delete, can_approve, can_export)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          r.role_id,
          module,
          scope,
          ...["view", "create", "edit", "delete", "approve", "export"].map(
            (a) => actions.includes(a),
          ),
        ],
      );
    }
    return r.role_id;
  };
  const grant = async (key, roleId) => {
    await q("INSERT INTO user_role (user_id, role_id) VALUES ($1, $2)", [
      people[key].user_id,
      roleId,
    ]);
    people[key].role_ids.push(roleId);
  };
  const ada = await emp("Ada", "Obi");
  const dayo = await emp("Dayo", "Ola", ada);
  const eze = await emp("Eze", "Uche", ada);
  const chidi = await emp("Chidi", "Eze", dayo);
  const bola = await emp("Bola", "Ade", ada);
  await user("ada", ada, true);
  await user("dayo", dayo);
  await user("eze", eze);
  await user("chidi", chidi);
  await user("bola", bola);
  const hr = await role("hr", [
    ["people", "all", ["view", "create", "edit", "approve"]],
  ]);
  const clerk = await role("clerk", [["people", "all", ["view"]]]);
  const staff = await role("staff", [["people", "own", ["view"]]]);
  await q(
    "INSERT INTO field_visibility (role_id, field_key, visibility) VALUES ($1, 'employee.salary', 'masked')",
    [clerk],
  );
  await grant("dayo", hr);
  await grant("eze", clerk);
  await grant("chidi", staff);
  await grant("bola", staff);
  await q(
    `INSERT INTO numbering_scheme (doc_type, prefix, padding) VALUES ('import_batch', 'IMP', 4), ('letter', 'LTR', 4)
     ON CONFLICT (doc_type) DO UPDATE SET prefix = EXCLUDED.prefix, padding = EXCLUDED.padding`,
  );
  await q(
    `INSERT INTO setting (key, value) VALUES ('organisation.profile', '{"name": "MyCity App Ltd", "email": "hello@mycityapp.io"}')`,
  );
  await q("INSERT INTO test_department (name) VALUES ('Operations')");
}

/* A small "service" for test_person, the way a module's importer would call its own. */
const COLS = { staff_number: "staff_number", work_email: "work_email" };
const personValues = (r) => ({
  staff_number: r.staff_number,
  first_name: r.first_name,
  last_name: r.last_name,
  work_email: r.work_email,
  gross_monthly: r.gross_monthly,
  start_date: r.start_date,
  department: r.department_id,
  line_manager: r.manager_id,
});
async function personRow(client, id) {
  return (
    await client.query("SELECT * FROM test_person WHERE test_person_id = $1", [
      id,
    ])
  ).rows[0];
}
const IMPORTER = {
  key: "test_people",
  label: "Test People",
  permission: ["people", "create"],
  entity: "test_person",
  schema: z.object({
    staff_number: z.string().optional(),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    work_email: z.string().email().optional(),
    gross_monthly: z.string().optional(),
    start_date: z.string().optional(),
    department: z.string().optional(),
    line_manager: z.string().optional(),
  }),
  matchKeys: ["staff_number", "work_email"],
  fields: [
    { key: "staff_number", label: "Staff ID", aliases: ["staff no"] },
    { key: "first_name", label: "First Name", required: true },
    { key: "last_name", label: "Last Name", required: true },
    { key: "work_email", label: "Work Email", type: "email" },
    {
      key: "gross_monthly",
      label: "Gross Monthly",
      type: "money",
      mask: "employee.salary",
    },
    { key: "start_date", label: "Start Date", type: "date" },
    {
      key: "department",
      label: "Department",
      type: "reference",
      ref: "test_department",
      createMissing: "confirm",
    },
    {
      key: "line_manager",
      label: "Line Manager",
      type: "reference",
      ref: "test_person",
      pass: 2,
    },
  ],
  async find(client, { key, value }) {
    const r = (
      await client.query(
        `SELECT * FROM test_person WHERE ${COLS[key]} = $1 AND archived_at IS NULL`,
        [value],
      )
    ).rows[0];
    return r ? { id: r.test_person_id, values: personValues(r) } : null;
  },
  async resolve(client, field, value) {
    if (field.ref === "test_department") {
      const r = (
        await client.query(
          "SELECT test_department_id AS id FROM test_department WHERE lower(name) = lower($1)",
          [value],
        )
      ).rows[0];
      return r ? r.id : null;
    }
    const r = (
      await client.query(
        "SELECT test_person_id AS id FROM test_person WHERE (staff_number = $1 OR work_email = lower($1)) AND archived_at IS NULL",
        [value],
      )
    ).rows[0];
    return r ? r.id : null;
  },
  async create(client, field, value, ctx) {
    const r = (
      await client.query(
        "INSERT INTO test_department (name) VALUES ($1) RETURNING test_department_id AS id",
        [value],
      )
    ).rows[0];
    await emit(client, {
      key: EV.TEST_DEPARTMENT_CREATED,
      entity: { type: "test_department", id: r.id },
      actor: ctx.actor,
    });
    return r.id;
  },
  async write(client, v, ctx) {
    const cols = {
      staff_number: v.staff_number,
      first_name: v.first_name,
      last_name: v.last_name,
      work_email: v.work_email,
      gross_monthly: v.gross_monthly,
      start_date: v.start_date,
      department_id: v.department,
    };
    const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
    if (ctx.existing) {
      const before = await personRow(client, ctx.existing.id);
      const set = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
      const after = (
        await client.query(
          `UPDATE test_person SET ${set} WHERE test_person_id = $1 RETURNING *`,
          [ctx.existing.id, ...keys.map((k) => cols[k])],
        )
      ).rows[0];
      await emit(client, {
        key: EV.TEST_PERSON_UPDATED,
        entity: { type: "test_person", id: after.test_person_id },
        actor: ctx.actor,
        before,
        after,
      });
      return { id: after.test_person_id };
    }
    const row = (
      await client.query(
        `INSERT INTO test_person (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
        keys.map((k) => cols[k]),
      )
    ).rows[0];
    await emit(client, {
      key: EV.TEST_PERSON_CREATED,
      entity: { type: "test_person", id: row.test_person_id },
      actor: ctx.actor,
      after: row,
    });
    return { id: row.test_person_id };
  },
  async link(client, id, refs, ctx) {
    const after = (
      await client.query(
        "UPDATE test_person SET manager_id = $2 WHERE test_person_id = $1 RETURNING *",
        [id, refs.line_manager],
      )
    ).rows[0];
    await emit(client, {
      key: EV.TEST_PERSON_UPDATED,
      entity: { type: "test_person", id },
      actor: ctx.actor,
      after,
    });
  },
  async archive(client, id, ctx) {
    await client.query(
      "UPDATE test_person SET archived_at = now(), staff_number = NULL, work_email = NULL WHERE test_person_id = $1",
      [id],
    );
    await emit(client, {
      key: EV.TEST_PERSON_ARCHIVED,
      entity: { type: "test_person", id },
      actor: ctx.actor,
    });
  },
  async restore(client, id, before, ctx) {
    await client.query(
      "UPDATE test_person SET first_name = $2, last_name = $3, gross_monthly = $4, start_date = $5, department_id = $6, manager_id = $7 WHERE test_person_id = $1",
      [
        id,
        before.first_name,
        before.last_name,
        before.gross_monthly,
        before.start_date,
        before.department,
        before.line_manager,
      ],
    );
    await emit(client, {
      key: EV.TEST_PERSON_UPDATED,
      entity: { type: "test_person", id },
      actor: ctx.actor,
    });
  },
};

async function sheet(rows, { title = true } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Staff");
  if (title) {
    ws.addRow(["MyCity Staff List"]);
    ws.addRow(["October 2026"]);
  }
  ws.addRow([
    "Staff No.",
    "First Name",
    "Last Name",
    "Work Email",
    "Gross Monthly",
    "Start Date",
    "Department",
    "Line Manager",
  ]);
  for (const r of rows) ws.addRow(r);
  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    originalname: "Staff list.xlsx",
  };
}

const describeDb = String(config.DB_NAME || "").endsWith("_test")
  ? describe
  : describe.skip;

describeDb("documents, PDFs, mail and imports against Postgres", () => {
  beforeAll(async () => {
    await schema.rebuild(pool, config.DB_NAME);
    await seed();
    registry.defineImporter(IMPORTER);
    defineDocumentType("employee_photo", {
      label: "Employee photo",
      module: "people",
      sensitivity: "personal",
    });
    defineDocumentType("contract_scan", {
      label: "Signed contract scan",
      module: "people",
      sensitivity: "personal",
    });
    defineDocumentType("cv", { label: "CV", sensitivity: "personal" });
    defineDocumentType("voice_note", { label: "Voice note" });
  });

  afterAll(async () => {
    await chromium.close();
    await pool.end();
  });

  describe("the vault", () => {
    let photo;

    test("a photo is processed, stored, hashed as stored, with variants", async () => {
      const src = await sharp({
        create: {
          width: 3000,
          height: 2000,
          channels: 3,
          background: "#014339",
        },
      })
        .jpeg()
        .toBuffer();
      photo = await tx((c) =>
        vault.store(c, {
          file: { buffer: src, originalname: "Team day.jpeg" },
          purpose: "photo",
          doc_type: "employee_photo",
          entity: { type: "employee", id: people.chidi.employee_id },
          subject_employee_id: people.chidi.employee_id,
          sensitivity: "personal",
          actor: people.dayo,
        }),
      );
      expect(photo.storage_key).toMatch(
        /^vault\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/,
      );
      expect(photo.original_name).toBe("Team day.jpg");
      expect([photo.width, photo.height]).toEqual([2400, 1600]);
      expect(photo.content_hash).toBe(
        sha256(await storage.get(photo.storage_key)),
      );
      expect(
        (
          await one(
            "SELECT count(*)::int AS n FROM document_variant WHERE document_id = $1",
            [photo.document_id],
          )
        ).n,
      ).toBe(8);
      const ev = await one(
        "SELECT module_key, payload FROM event_log WHERE event_key = 'document.stored' AND entity_id = $1",
        [photo.document_id],
      );
      expect(ev).toEqual({
        module_key: "people",
        payload: expect.objectContaining({ needs: [], kind: "image" }),
      });
    });

    test("a doc type nobody registered is refused before anything is stored", async () => {
      const pdf = Buffer.from("%PDF-1.4\n%%EOF");
      await expect(
        tx((c) =>
          vault.store(c, {
            file: { buffer: pdf, originalname: "x.pdf" },
            purpose: "document",
            doc_type: "employe_photo",
            entity: { type: "employee", id: people.chidi.employee_id },
            actor: people.dayo,
          }),
        ),
      ).rejects.toMatchObject({ code: "UNKNOWN_DOC_TYPE", status: 422 });
    });

    test("who may read: the subject, the module grant within scope; restricted needs edit", async () => {
      expect(await vault.canRead(pool, people.chidi, photo)).toBe(true);
      expect(await vault.canRead(pool, people.dayo, photo)).toBe(true);
      expect(await vault.canRead(pool, people.eze, photo)).toBe(true);
      expect(await vault.canRead(pool, people.bola, photo)).toBe(false);
      const restricted = {
        ...photo,
        sensitivity: "restricted",
        uploaded_by: null,
      };
      expect(await vault.canRead(pool, people.eze, restricted)).toBe(false);
      expect(await vault.canRead(pool, people.dayo, restricted)).toBe(true);
      await expect(
        vault.getReadable(pool, people.bola, photo.document_id),
      ).rejects.toMatchObject({ status: 404 });
    });

    test("serving honours ranges and sets safe headers", async () => {
      const app = express();
      app.get("/d/:id", async (req, res, next) => {
        try {
          const doc = await vault.getReadable(pool, people.dayo, req.params.id);
          await vault.serve(req, res, doc);
        } catch (err) {
          next(err);
        }
      });
      const full = await request(app).get(`/d/${photo.document_id}`);
      expect(full.status).toBe(200);
      expect(full.headers["content-type"]).toBe("image/jpeg");
      expect(full.headers["x-content-type-options"]).toBe("nosniff");
      expect(full.headers["content-disposition"]).toMatch(
        /^attachment; filename="Team day.jpg"/,
      );
      const part = await request(app)
        .get(`/d/${photo.document_id}`)
        .set("Range", "bytes=0-9");
      expect(part.status).toBe(206);
      expect(part.headers["content-range"]).toMatch(/^bytes 0-9\/\d+$/);
    });

    test("versions, not overwrites; a locked document cannot be replaced", async () => {
      const pdf = Buffer.from(
        "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF",
      );
      const v1 = await tx((c) =>
        vault.store(c, {
          file: { buffer: pdf, originalname: "contract.pdf" },
          purpose: "document",
          doc_type: "contract_scan",
          entity: { type: "employee", id: people.chidi.employee_id },
          actor: people.dayo,
        }),
      );
      const v2 = await tx((c) =>
        vault.supersede(c, {
          document_id: v1.document_id,
          file: { buffer: pdf, originalname: "contract v2.pdf" },
          purpose: "document",
          actor: people.dayo,
        }),
      );
      expect([v2.version, v2.supersedes_id]).toEqual([2, v1.document_id]);
      expect((await vault.get(pool, v1.document_id)).is_current).toBe(false);
      await expect(
        tx((c) =>
          vault.supersede(c, {
            document_id: v1.document_id,
            file: { buffer: pdf, originalname: "x.pdf" },
            purpose: "document",
            actor: people.dayo,
          }),
        ),
      ).rejects.toMatchObject({ code: "DOCUMENT_SUPERSEDED" });
      await tx((c) => vault.lock(c, v2.document_id, people.dayo));
      await tx((c) => vault.lock(c, v2.document_id, people.dayo));
      await expect(
        tx((c) =>
          vault.supersede(c, {
            document_id: v2.document_id,
            file: { buffer: pdf, originalname: "x.pdf" },
            purpose: "document",
            actor: people.dayo,
          }),
        ),
      ).rejects.toMatchObject({ code: "DOCUMENT_LOCKED" });
      expect(
        (
          await one(
            "SELECT count(*)::int AS n FROM event_log WHERE event_key = 'document.locked' AND entity_id = $1",
            [v2.document_id],
          )
        ).n,
      ).toBe(1);
    });

    test("a stranger's file waits in quarantine until a clean scan moves it", async () => {
      const pdf = Buffer.from("%PDF-1.4\n%%EOF");
      const cv = await tx((c) =>
        vault.store(c, {
          file: { buffer: pdf, originalname: "cv.pdf" },
          purpose: "document",
          doc_type: "cv",
          entity: { type: "candidate", id: "cand-1" },
          stranger: true,
          actor: null,
        }),
      );
      expect([
        cv.scan_status,
        cv.storage_key.startsWith("quarantine/"),
      ]).toEqual(["pending", true]);
      await expect(vault.serve({ headers: {} }, {}, cv)).rejects.toMatchObject({
        code: "DOCUMENT_SCANNING",
      });
      const clean = await tx((c) =>
        vault.completeScan(c, cv.document_id, { clean: true }),
      );
      expect([
        clean.scan_status,
        clean.storage_key.startsWith("vault/"),
      ]).toEqual(["clean", true]);
      const bad = await tx((c) =>
        vault.store(c, {
          file: { buffer: pdf, originalname: "bad.pdf" },
          purpose: "document",
          doc_type: "cv",
          entity: { type: "candidate", id: "cand-2" },
          stranger: true,
          actor: null,
        }),
      );
      expect(
        (
          await tx((c) =>
            vault.completeScan(c, bad.document_id, {
              clean: false,
              signature: "Eicar",
            }),
          )
        ).scan_status,
      ).toBe("infected");
    });

    (hasFfmpeg ? test : test.skip)(
      "a voice note gets a playable Opus variant and its duration",
      async () => {
        const { dir, cleanup } = await storage.scratch();
        const wav = path.join(dir, "note.wav");
        execFileSync(config.FFMPEG_PATH, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=2",
          wav,
        ]);
        const buffer = await fsp.readFile(wav);
        const note = await tx((c) =>
          vault.store(c, {
            file: { buffer, originalname: "note.wav" },
            purpose: "voice_note",
            doc_type: "voice_note",
            entity: { type: "direct_message", id: "dm-1" },
            actor: people.chidi,
          }),
        );
        await cleanup();
        expect(
          (
            await one(
              "SELECT payload FROM event_log WHERE event_key = 'document.stored' AND entity_id = $1",
              [note.document_id],
            )
          ).payload.needs,
        ).toEqual(["av"]);
        const derived = await av.derive({
          document_id: note.document_id,
          storage_key: note.storage_key,
          kind: "audio",
        });
        await tx((c) => vault.completeAv(c, note.document_id, derived));
        const v = await vault.variantOf(pool, note.document_id, "opus");
        expect(v.mime).toBe("audio/ogg");
        expect(
          (await vault.get(pool, note.document_id)).duration_ms,
        ).toBeGreaterThan(1500);
      },
    );
  });

  describe("generated documents", () => {
    beforeAll(async () => {
      variables.defineVariables(
        "document",
        "test-letter",
        z.object({
          employee_name: z.string(),
          amount: z.string(),
          effective: z.string(),
        }),
      );
      documents.defineDocType("test_letter", {
        template: "test-letter",
        numbering: "letter",
        sensitivity: "personal",
        title: (d) => `Letter to ${d.employee_name}`,
      });
      await tx((c) =>
        templates.saveVersion(c, {
          kind: "document",
          key: "test-letter",
          body: "Dear {{ employee_name }},\n\nFrom **{{ longdate effective }}** your allowance is {{ money amount }}.",
          format: "markdown",
        }),
      );
    });

    test("data is checked before a number is taken, and a rollback keeps the number", async () => {
      await expect(
        tx((c) =>
          documents.generate(c, {
            doc_type: "test_letter",
            entity: { type: "employee", id: people.chidi.employee_id },
            data: { employee_name: "Chidi" },
            actor: people.dayo,
          }),
        ),
      ).rejects.toMatchObject({ code: "TEMPLATE_DATA_INVALID" });
      await expect(
        tx(async (c) => {
          await documents.generate(c, {
            doc_type: "test_letter",
            entity: { type: "employee", id: people.chidi.employee_id },
            data: {
              employee_name: "Chidi",
              amount: "25000.00",
              effective: "2026-11-01",
            },
            actor: people.dayo,
          });
          throw new Error("roll back");
        }),
      ).rejects.toThrow("roll back");
      expect(
        await one(
          "SELECT last_value FROM numbering_counter WHERE doc_type = 'letter'",
        ),
      ).toBeUndefined();
      expect(
        (
          await one(
            "SELECT count(*)::int AS n FROM document WHERE doc_type = 'test_letter'",
          )
        ).n,
      ).toBe(0);
    });

    (hasChromium ? test : test.skip)(
      "generate queues; the worker renders, stores, hashes and locks",
      async () => {
        const doc = await tx((c) =>
          documents.generate(c, {
            doc_type: "test_letter",
            entity: { type: "employee", id: people.chidi.employee_id },
            subject_employee_id: people.chidi.employee_id,
            data: {
              employee_name: "Chidi <Eze>",
              amount: "25000.00",
              effective: "2026-11-01",
            },
            actor: people.dayo,
          }),
        );
        expect([doc.number, doc.render_status, doc.template_version]).toEqual([
          "LTR-0001",
          "pending",
          1,
        ]);
        const html = (
          await one("SELECT render_html FROM document WHERE document_id = $1", [
            doc.document_id,
          ])
        ).render_html;
        expect(html).toContain("Chidi &lt;Eze&gt;");
        expect(html).toContain("<strong>1 November 2026</strong>");
        expect(html).toContain("₦25,000.00");
        const done = await documents.renderPending(doc.document_id, {
          db: pool,
        });
        expect(done.render_status).toBe("done");
        expect(done.locked_at).toBeTruthy();
        const bytes = await storage.get(done.storage_key);
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
        expect(done.content_hash).toBe(sha256(bytes));
        expect(
          await documents.renderPending(doc.document_id, { db: pool }),
        ).toBeNull();
        expect(
          (
            await one(
              "SELECT count(*)::int AS n FROM event_log WHERE event_key = 'document.generated' AND entity_id = $1",
              [doc.document_id],
            )
          ).n,
        ).toBe(1);

        variables.defineVariables(
          "email",
          "test-ready",
          z.object({ number: z.string() }),
        );
        await tx((c) =>
          templates.saveVersion(c, {
            kind: "email",
            key: "test-ready",
            subject: "Letter {{ number }} is ready",
            body: "Hello {{ recipient.name }}, your letter **{{ number }}** is attached.",
            format: "markdown",
          }),
        );
        mail.__reset();
        await mail.send({
          to: { name: "Chidi Eze", email: "chidi@mycity.test" },
          template: "test-ready",
          data: { number: done.number },
          attachments: [{ document_id: done.document_id }],
          db: pool,
        });
        const [sent] = mail.capturedMail();
        expect(sent.subject).toBe("Letter LTR-0001 is ready");
        expect(sent.html).toContain("Hello Chidi Eze");
        expect(sent.text).toContain("your letter LTR-0001 is attached");
      },
    );
  });

  describe("imports", () => {
    let first;

    test("upload finds the header under a title and maps the columns", async () => {
      const file = await sheet([
        [
          "S1",
          "Ada",
          "Obi",
          "ada@x.io",
          450000,
          "03/11/2026",
          "Operations",
          null,
        ],
        [
          "S2",
          "Bola",
          "Ade",
          "BOLA@x.io",
          "₦300,000",
          "2026-11-03",
          "operations",
          "S1",
        ],
        ["S3", "Chidi", "Eze", "chidi@x.io", null, null, "Marketting", "S2"],
        ["S2", "Bola", "Again", "b2@x.io", null, null, null, null],
        ["S4", "Dan", "Bad", "dan@x.io", null, "13/31/2026", null, null],
      ]);
      first = await tx((c) =>
        engine.createBatch(c, {
          importer_key: "test_people",
          file,
          actor: people.dayo,
        }),
      );
      expect([first.number, first.status, first.header_row]).toEqual([
        "IMP-0001",
        "mapped",
        2,
      ]);
      expect(first.mapping.columns.map((c) => c.field)).toEqual([
        "staff_number",
        "first_name",
        "last_name",
        "work_email",
        "gross_monthly",
        "start_date",
        "department",
        "line_manager",
      ]);
      await expect(
        tx((c) =>
          engine.createBatch(c, {
            importer_key: "test_people",
            file,
            actor: people.eze,
          }),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    test("preview is the real result, rolled back", async () => {
      const { stats } = await engine.preview(first.import_batch_id, {
        actor: people.dayo,
      });
      expect(stats).toMatchObject({
        rows: 5,
        create: 3,
        error: 1,
        duplicate: 1,
        missing: { department: ["Marketting"] },
      });
      expect((await one("SELECT count(*)::int AS n FROM test_person")).n).toBe(
        0,
      );
      expect(
        (await one("SELECT count(*)::int AS n FROM test_department")).n,
      ).toBe(1);
      expect(
        await one(
          "SELECT last_value::int AS last_value FROM numbering_counter WHERE doc_type = 'import_batch'",
        ),
      ).toEqual({ last_value: 1 });
      const errors = await engine.rowsOf(pool, first.import_batch_id, {
        status: "error",
      });
      expect(errors.data.map((r) => r.row_number)).toEqual([8]);
      const chidi = (
        await engine.rowsOf(pool, first.import_batch_id, {})
      ).data.find((r) => r.row_number === 6);
      expect(chidi.problems[0].message).toBe(
        'Department "Marketting" will be created if you tick it',
      );
    });

    test("commit is all-or-nothing unless valid rows only is chosen", async () => {
      await expect(
        engine.commit(first.import_batch_id, { actor: people.dayo }),
      ).rejects.toMatchObject({ code: "IMPORT_HAS_ERRORS" });
      expect((await one("SELECT count(*)::int AS n FROM test_person")).n).toBe(
        0,
      );
      const { batch, stats } = await engine.commit(first.import_batch_id, {
        actor: people.dayo,
        valid_only: true,
        create_missing: { department: ["Marketting"] },
      });
      expect(batch.status).toBe("committed");
      expect(stats).toMatchObject({ create: 3, error: 1, duplicate: 1 });
      const rows = (
        await q(
          "SELECT p.staff_number, p.gross_monthly, p.start_date, d.name AS dept, m.staff_number AS manager FROM test_person p LEFT JOIN test_department d ON d.test_department_id = p.department_id LEFT JOIN test_person m ON m.test_person_id = p.manager_id ORDER BY p.staff_number",
        )
      ).rows;
      expect(rows).toEqual([
        {
          staff_number: "S1",
          gross_monthly: "450000.00",
          start_date: "2026-11-03",
          dept: "Operations",
          manager: null,
        },
        {
          staff_number: "S2",
          gross_monthly: "300000.00",
          start_date: "2026-11-03",
          dept: "Operations",
          manager: "S1",
        },
        {
          staff_number: "S3",
          gross_monthly: null,
          start_date: null,
          dept: "Marketting",
          manager: "S2",
        },
      ]);
      const audit = await one(
        "SELECT count(*)::int AS n FROM audit_ledger WHERE entity_type = 'test_person' AND import_batch_id = $1",
        [first.import_batch_id],
      );
      expect(audit.n).toBeGreaterThanOrEqual(5);
    });

    test("a second sheet updates what changed, leaves the rest, and refuses loops", async () => {
      const file = await sheet(
        [
          [
            "S1",
            "Ada",
            "Obi",
            "ada@x.io",
            500000,
            "03/11/2026",
            "Operations",
            null,
          ],
          [
            "S2",
            "Bola",
            "Ade",
            "bola@x.io",
            300000,
            "03/11/2026",
            "Operations",
            "S1",
          ],
          ["X1", "Xavier", "One", "x1@x.io", null, null, null, "X2"],
          ["X2", "Xena", "Two", "x2@x.io", null, null, null, "X1"],
        ],
        { title: false },
      );
      const b = await tx((c) =>
        engine.createBatch(c, {
          importer_key: "test_people",
          file,
          actor: people.dayo,
        }),
      );
      await engine.preview(b.import_batch_id, { actor: people.dayo });
      const rows = (await engine.rowsOf(pool, b.import_batch_id, {})).data;
      const byRow = Object.fromEntries(rows.map((r) => [r.row_number, r]));
      expect([byRow[2].action, byRow[2].diff]).toEqual([
        "update",
        { gross_monthly: ["450000.00", "500000.00"] },
      ]);
      expect(byRow[3].status).toBe("unchanged");
      expect([byRow[4].status, byRow[5].status]).toEqual(["error", "error"]);
      expect(byRow[4].problems[0].message).toMatch(/loop/);
    });

    test("mapping is remembered by header signature", async () => {
      const file = await sheet(
        [["S9", "Ife", "Nine", "ife@x.io", null, null, null, null]],
        { title: false },
      );
      const b = await tx((c) =>
        engine.createBatch(c, {
          importer_key: "test_people",
          file,
          actor: people.dayo,
        }),
      );
      const fields = Object.fromEntries(
        b.mapping.columns.map((c) => [c.index, c.field]),
      );
      fields[4] = null; // ignore Gross Monthly this time
      await tx((c) =>
        engine.setMapping(
          c,
          b.import_batch_id,
          { fields, save_profile: true, profile_name: "HR sheet" },
          people.dayo,
        ),
      );
      const again = await tx((c) =>
        engine.createBatch(c, {
          importer_key: "test_people",
          file,
          actor: people.dayo,
        }),
      );
      expect(again.stats.profile_applied).toBe(true);
      expect(again.mapping.columns[4].field).toBeNull();
    });

    test("revert undoes a clean batch, and refuses one changed since", async () => {
      const file = await sheet(
        [["R1", "Rita", "One", "r1@x.io", 100000, null, "Operations", null]],
        { title: false },
      );
      const b = await tx((c) =>
        engine.createBatch(c, {
          importer_key: "test_people",
          file,
          actor: people.dayo,
        }),
      );
      await engine.preview(b.import_batch_id, { actor: people.dayo });
      await engine.commit(b.import_batch_id, { actor: people.dayo });
      const undone = await revert(b.import_batch_id, { actor: people.dayo });
      expect(undone).toMatchObject({ archived: 1, restored: 0 });
      expect(
        (
          await one(
            "SELECT archived_at FROM test_person WHERE first_name = 'Rita'",
          )
        ).archived_at,
      ).toBeTruthy();

      const later = await tx(async (c) => {
        const p = (
          await c.query(
            "SELECT test_person_id FROM test_person WHERE staff_number = 'S3'",
          )
        ).rows[0];
        await emit(c, {
          key: EV.TEST_PERSON_UPDATED,
          entity: { type: "test_person", id: p.test_person_id },
          actor: people.dayo,
        });
        return p;
      });
      expect(later).toBeTruthy();
      await expect(
        revert(first.import_batch_id, { actor: people.dayo }),
      ).rejects.toMatchObject({ code: "IMPORT_REVERT_BLOCKED" });
    });

    test("the error file is the person's own rows, restricted columns hidden from the masked", async () => {
      const read = async (buffer) => {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const ws = wb.worksheets[0];
        return [ws.getRow(1).values.slice(1), ws.getRow(2).values.slice(1)];
      };
      const forHr = await report.errorFile(
        pool,
        first.import_batch_id,
        people.dayo,
      );
      const [header, row] = await read(forHr.buffer);
      expect(header).toEqual([
        "Staff No.",
        "First Name",
        "Last Name",
        "Work Email",
        "Gross Monthly",
        "Start Date",
        "Department",
        "Line Manager",
        "Status",
        "Problem",
      ]);
      expect(row[4]).toBe(450000);
      const forClerk = await report.errorFile(
        pool,
        first.import_batch_id,
        people.eze,
      );
      expect((await read(forClerk.buffer))[1][4]).toBeUndefined();
      const tpl = await report.template(registry.get("test_people"));
      expect(tpl.filename).toMatch(
        /^test_people-import-template-\d{4}-\d{2}-\d{2}\.xlsx$/,
      );
    });

    describe("the command line (scripts/import/run.js)", () => {
      const cli = require("../../scripts/import/run");
      const dir = fs.mkdtempSync(
        path.join(require("node:os").tmpdir(), "mycity-cli-"),
      );
      let said = [];
      const run = (argv, deps = {}) => {
        said = [];
        return cli.execute(cli.parseArgs(argv), {
          db: pool,
          env: "test",
          log: (s) => said.push(s),
          ask: null,
          ...deps,
        });
      };
      const out = () => said.join("\n");

      test("arguments", () => {
        expect(() =>
          cli.parseArgs(["upload", "test_people", "f.xlsx"]),
        ).toThrow(/--as=/);
        expect(() => cli.parseArgs(["frobnicate"])).toThrow(/Unknown command/);
        expect(() => cli.parseArgs(["list", "--force"])).toThrow(
          /Unknown option --force/,
        );
        expect(
          cli.createMissingOf([
            "department:Logistics, Sales",
            "department:Legal",
          ]),
        ).toEqual({ department: ["Logistics", "Sales", "Legal"] });
        expect(cli.columnsOf(["3:work_email", "7:"])).toEqual({
          3: "work_email",
          7: null,
        });
        expect(() => cli.columnsOf(["x"])).toThrow(/column number/);
        expect(cli.loadImporters(path.join(dir, "no-modules"))).toEqual([]);
      });

      test("upload, map, preview, commit, status, history, errors and revert, as the person named", async () => {
        expect(await run(["list"])).toBe(0);
        expect(out()).toMatch(
          /test_people\s+Test People\s+needs people\.create/,
        );
        expect(
          await run([
            "template",
            "test_people",
            `--out=${path.join(dir, "t.xlsx")}`,
          ]),
        ).toBe(0);
        expect(fs.existsSync(path.join(dir, "t.xlsx"))).toBe(true);

        const file = path.join(dir, "Staff.xlsx");
        fs.writeFileSync(
          file,
          (
            await sheet(
              [
                [
                  "C1",
                  "Kemi",
                  "Cli",
                  "kemi@x.io",
                  210000,
                  "04/11/2026",
                  "Logistics",
                  null,
                ],
              ],
              { title: false },
            )
          ).buffer,
        );
        await expect(
          run(["upload", "test_people", file, "--as=eze@mycity.test"]),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          run(["upload", "test_people", file, "--as=nobody@mycity.test"]),
        ).rejects.toThrow(/not an active user/);

        expect(
          await run(["upload", "test_people", file, "--as=DAYO@mycity.test"]),
        ).toBe(0);
        const number = /^(IMP-\d+) uploaded \(mapped\)/.exec(said[0])[1];
        // The "HR sheet" profile saved above matches these headers, so Gross Monthly starts ignored.
        expect(out()).toMatch(/Gross Monthly\s+→ ignored/);

        expect(
          await run([
            "map",
            number,
            "--as=dayo@mycity.test",
            "--column=4:gross_monthly",
          ]),
        ).toBe(0);
        expect(out()).toMatch(
          /Gross Monthly\s+→ Gross Monthly \(gross_monthly\)/,
        );

        expect(await run(["preview", number, "--as=dayo@mycity.test"])).toBe(0);
        expect(out()).toMatch(/previewed: 1 create/);
        expect(out()).toMatch(
          /will be created if you accept them, department: Logistics/,
        );

        await expect(
          run(["commit", number, "--as=dayo@mycity.test"], { env: "staging" }),
        ).rejects.toThrow(/run this in a terminal to confirm, or pass --yes/);
        expect(
          await run(["commit", number, "--as=dayo@mycity.test"], {
            env: "staging",
            ask: async () => "production",
          }),
        ).toBe(1);
        expect(out()).toMatch(/Cancelled\. Nothing was written/);
        expect(
          await run(
            [
              "commit",
              number,
              "--as=dayo@mycity.test",
              "--create=department:Logistics",
              "--yes",
            ],
            { env: "staging" },
          ),
        ).toBe(0);
        expect(out()).toMatch(/committed: 1 create/);
        const kemi = await one(
          "SELECT p.gross_monthly, d.name AS dept FROM test_person p JOIN test_department d ON d.test_department_id = p.department_id WHERE p.staff_number = 'C1'",
        );
        expect(kemi).toEqual({ gross_monthly: "210000.00", dept: "Logistics" });
        const audit = await one(
          "SELECT count(*)::int AS n FROM audit_ledger a JOIN import_batch b ON b.import_batch_id = a.import_batch_id WHERE b.number = $1 AND a.actor_user_id = $2",
          [number, people.dayo.user_id],
        );
        expect(audit.n).toBeGreaterThanOrEqual(2);

        expect(await run(["status", number])).toBe(0);
        expect(out()).toMatch(
          new RegExp(`${number}\\s+test_people\\s+committed`),
        );
        expect(await run(["history"])).toBe(0);
        expect(out()).toMatch(new RegExp(number));
        expect(
          await run([
            "errors",
            number,
            "--as=dayo@mycity.test",
            `--out=${path.join(dir, "r.xlsx")}`,
          ]),
        ).toBe(0);
        expect(fs.existsSync(path.join(dir, "r.xlsx"))).toBe(true);

        expect(await run(["revert", number, "--as=dayo@mycity.test"])).toBe(0);
        expect(out()).toMatch(
          /reverted: 1 created records archived, 0 updated records restored/,
        );
        await expect(run(["status", "IMP-9999"])).rejects.toThrow(
          /There is no import IMP-9999/,
        );
      });
    });
  });

  test("reconcile moves an old orphan aside and reports missing files", async () => {
    const key = "vault/2020/01/00000000-0000-4000-8000-000000000000.pdf";
    await storage.put(key, Buffer.from("%PDF-orphan"), { overwrite: true });
    const old = new Date(Date.now() - 3 * 86_400_000);
    await fsp.utimes(storage.absPath(key), old, old);
    await q(
      `INSERT INTO document (doc_type, original_name, storage_key, mime, bytes, entity_type, entity_id, sensitivity, scan_status, source)
       VALUES ('lost', 'lost.pdf', 'vault/2020/01/11111111-1111-4111-8111-111111111111.pdf', 'application/pdf', 1, 'employee', 'x', 'normal', 'skipped', 'upload')`,
    );
    const out = await reconcile.run({ db: pool });
    expect(out.moved).toContain(key);
    expect(await storage.exists(key)).toBe(false);
    expect(out.missing).toBe(1);
  });
});
