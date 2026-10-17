"use strict";
/**
 * The documents and imports APIs through HTTP, on the real migrations, with the
 * real tools (sharp, ffmpeg, Chromium). This is where M0's definition of done is
 * proved for track B (BACKEND_STRUCTURE §13):
 *
 *   a photo, a scanned document and a voice note upload, process and download
 *   through gated routes; a direct /media/vault/... request is refused;
 *   a letter template generates a numbered, hashed, locked PDF, and only the
 *   people who may read it can fetch it.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test \
 *     npx jest tests/integration/documents-api
 *
 * Refuses to run unless the database name ends in "_test": it rebuilds the schema.
 * The people in it are invented; no member of MyCity's staff appears in a test.
 */
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const request = require("supertest");
const sharp = require("sharp");
const ExcelJS = require("exceljs");
const { z } = require("zod");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const storage = require("../../src/services/storage/storage.service");
const av = require("../../src/services/media/av-pipeline");
const chromium = require("../../src/services/pdf/chromium");
const documents = require("../../src/shared/documents/generate");
const templates = require("../../src/shared/templates/template-store");
const variables = require("../../src/shared/templates/variables");
const registry = require("../../src/shared/import/registry");
const { sha256 } = require("../../src/shared/files/hash");

const describeDb = String(config.DB_NAME || "").endsWith("_test")
  ? describe
  : describe.skip;

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

const PASSWORD = {
  ops: "Harmattan#26Rain",
  staff: "Lagoon-tide9Blue",
  other: "Iroko-shade7Green",
  boss: "Marina-bridge4Sky",
};

/* ------------------------------------------------------------------ *
 * A test importer: two columns, writing to a table of its own, so the
 * imports API is proved over an importer that is not track A's.
 * ------------------------------------------------------------------ */

const PetRow = z
  .object({ name: z.string().trim().min(1).max(60), colour: z.string().trim().max(30).optional() })
  .strict();

function petImporter() {
  return {
    key: "test_pets",
    label: "Pets",
    permission: ["people", "create"],
    entity: "test_pet",
    schema: PetRow,
    matchKeys: ["name"],
    fields: [
      { key: "name", label: "Name", required: true, aliases: ["pet name"] },
      { key: "colour", label: "Colour" },
    ],
    find: async (client, { key, value }) => {
      const { rows } = await client.query(
        `SELECT pet_id AS id, name, colour FROM test_pet WHERE ${key} = $1 AND archived_at IS NULL`,
        [value],
      );
      return rows[0] ? { id: rows[0].id, values: { name: rows[0].name, colour: rows[0].colour } } : null;
    },
    write: async (client, values, ctx) => {
      if (ctx.existing) {
        const { rows } = await client.query(
          "UPDATE test_pet SET colour = $2 WHERE pet_id = $1 RETURNING pet_id AS id",
          [ctx.existing.id, values.colour || null],
        );
        return rows[0];
      }
      const { rows } = await client.query(
        "INSERT INTO test_pet (name, colour) VALUES ($1, $2) RETURNING pet_id AS id",
        [values.name, values.colour || null],
      );
      return rows[0];
    },
    archive: (client, id) =>
      client.query("UPDATE test_pet SET archived_at = now() WHERE pet_id = $1", [id]),
    restore: (client, id, before) =>
      client.query("UPDATE test_pet SET colour = $2, archived_at = NULL WHERE pet_id = $1", [
        id,
        before ? before.colour || null : null,
      ]),
  };
}

/** A one-sheet workbook, header first. */
async function sheet(rows) {
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet("Pets");
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await book.xlsx.writeBuffer());
}

describeDb("documents and imports through the API", () => {
  let app;
  const people = {};
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.60.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };

  async function tokenOf(email, password) {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", nextIp())
      .send({ email, password });
    expect(res.status).toBe(200);
    return res.body.access_token;
  }

  const as = (token) => ({
    get: (p) => request(app).get(`/api/v1${p}`).set("Authorization", `Bearer ${token}`),
    post: (p) => request(app).post(`/api/v1${p}`).set("Authorization", `Bearer ${token}`),
    put: (p) => request(app).put(`/api/v1${p}`).set("Authorization", `Bearer ${token}`),
  });

  const sample = (first, last, email, job) => ({
    first_name: first,
    last_name: last,
    work_email: email,
    phone: "08031234567",
    job_title: job,
    department_name: "HR & Operations",
    start_date: "2026-01-05",
    employment_type: "full_time",
    work_pattern: "on_site",
  });

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    await q(`CREATE TABLE IF NOT EXISTS test_pet (
               pet_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
               name text NOT NULL, colour text, archived_at timestamptz)`);
    outbox.markReady();
    registry.defineImporter(petImporter());
    ({ app } = buildApp({ strict: true, accessLog: false }));

    await tx(async (client) => {
      people.ops = await createAdmin(
        client,
        {
          employee: sample("Ngozi", "Umeh", "ops@mycity.test", "Operations Lead"),
          role_code: "operations_people",
          is_ceo: false,
        },
        PASSWORD.ops,
      );
      people.boss = await createAdmin(
        client,
        {
          employee: sample("Kunle", "Afolabi", "boss@mycity.test", "Studio Manager"),
          role_code: "manager",
          is_ceo: false,
        },
        PASSWORD.boss,
      );
      people.staff = await createAdmin(
        client,
        {
          employee: sample("Temi", "Balogun", "temi@mycity.test", "Content Associate"),
          role_code: "employee",
          is_ceo: false,
        },
        PASSWORD.staff,
      );
      people.other = await createAdmin(
        client,
        {
          employee: sample("Zainab", "Yakubu", "zainab@mycity.test", "Field Officer"),
          role_code: "employee",
          is_ceo: false,
        },
        PASSWORD.other,
        { allowAdditional: true },
      );
    });
    // Temi reports to Kunle, so a team-scope reader is a real one.
    await q("UPDATE employee SET line_manager_id = $2 WHERE employee_id = $1", [
      people.staff.employee.employee_id,
      people.boss.employee.employee_id,
    ]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
  });

  afterAll(async () => {
    await chromium.close();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /* ---------------------------------------------------------------- */

  describe("the definition of done: upload, process, download", () => {
    let tokens;

    beforeAll(async () => {
      tokens = {
        ops: await tokenOf("ops@mycity.test", PASSWORD.ops),
        staff: await tokenOf("temi@mycity.test", PASSWORD.staff),
        other: await tokenOf("zainab@mycity.test", PASSWORD.other),
      };
    });

    test("a photo: stored through the pipeline, served with its derived sizes", async () => {
      const src = await sharp({
        create: { width: 2400, height: 1600, channels: 3, background: "#014339" },
      })
        .jpeg()
        .toBuffer();
      const up = await as(tokens.staff)
        .post("/documents")
        .field("purpose", "photo")
        .attach("file", src, { filename: "Launch day.jpeg", contentType: "image/jpeg" });
      expect(up.status).toBe(201);
      expect(up.body).toMatchObject({ file_name: "Launch day.jpg", mime_type: "image/jpeg" });

      const row = await one("SELECT storage_key, content_hash, bytes FROM document WHERE document_id = $1", [
        up.body.document_id,
      ]);
      expect(row.content_hash).toBe(sha256(await storage.get(row.storage_key)));

      const file = await as(tokens.staff).get(`/documents/${up.body.document_id}/content`);
      expect(file.status).toBe(200);
      expect(file.headers["content-type"]).toBe("image/jpeg");
      expect(file.headers["x-content-type-options"]).toBe("nosniff");
      expect(file.body.length).toBe(Number(row.bytes));

      const small = await as(tokens.staff).get(`/documents/${up.body.document_id}/variant/webp-320`);
      expect(small.status).toBe(200);
      expect(small.headers["content-type"]).toBe("image/webp");
      expect(small.headers["cache-control"]).toBe("private, max-age=300");

      // Somebody else's upload is not theirs to open, and says so as a 404.
      expect((await as(tokens.other).get(`/documents/${up.body.document_id}/content`)).status).toBe(404);
    });

    test("a scanned document: kept as a document, downloaded not displayed", async () => {
      const scan = await sharp({
        create: { width: 1700, height: 2200, channels: 3, background: "#f2f0e9" },
      })
        .png()
        .toBuffer();
      const up = await as(tokens.staff)
        .post("/documents")
        .field("purpose", "document")
        .field("title", "NDPA certificate")
        .attach("file", scan, { filename: "scan.png", contentType: "image/png" });
      expect(up.status).toBe(201);

      const file = await as(tokens.staff).get(`/documents/${up.body.document_id}/content`);
      expect(file.status).toBe(200);
      expect(file.headers["content-disposition"]).toContain("scan.png");
      expect((await as(tokens.staff).get(`/documents/${up.body.document_id}`)).body).toMatchObject({
        title: "NDPA certificate",
        doc_type: "staged_upload",
        source: "upload",
        version: 1,
      });
    });

    (hasFfmpeg ? test : test.skip)(
      "a voice note: stored, given a playable Opus variant, served by range",
      async () => {
        const { dir, cleanup } = await storage.scratch();
        const wav = path.join(dir, "note.wav");
        execFileSync(config.FFMPEG_PATH, [
          "-hide_banner", "-loglevel", "error",
          "-f", "lavfi", "-i", "sine=frequency=440:duration=2", wav,
        ]);
        const buffer = await fsp.readFile(wav);
        const up = await as(tokens.staff)
          .post("/documents")
          .field("purpose", "voice_note")
          .attach("file", buffer, { filename: "note.wav", contentType: "audio/wav" });
        await cleanup();
        expect(up.status).toBe(201);

        const stored = await one("SELECT storage_key FROM document WHERE document_id = $1", [
          up.body.document_id,
        ]);
        const derived = await av.derive({
          document_id: up.body.document_id,
          storage_key: stored.storage_key,
          kind: "audio",
        });
        await tx((c) =>
          require("../../src/shared/documents/vault").completeAv(c, up.body.document_id, derived),
        );

        const playable = await as(tokens.staff).get(`/documents/${up.body.document_id}/variant/opus`);
        expect(playable.status).toBe(200);
        expect(playable.headers["content-type"]).toBe("audio/ogg");

        const part = await as(tokens.staff)
          .get(`/documents/${up.body.document_id}/content`)
          .set("Range", "bytes=0-99");
        expect(part.status).toBe(206);
        expect(part.headers["content-length"]).toBe("100");
      },
      30_000,
    );

    test("a direct /media/vault request is refused", async () => {
      const row = await one(
        "SELECT storage_key, bytes FROM document WHERE storage_key LIKE 'vault/%' ORDER BY created_at DESC",
      );
      expect(row).toBeDefined();
      for (const p of ["/media/vault/", `/media/${row.storage_key}`, `/media/../${row.storage_key}`]) {
        const res = await request(app).get(p).set("Authorization", `Bearer ${tokens.staff}`);
        expect(res.status).toBe(404);
        expect(res.headers["content-type"]).toContain("application/json");
      }
      // The storage key outside /media is an unknown app path, which the staff
      // app answers with its own page, never with the file.
      const spa = await request(app).get(`/${row.storage_key}`).set("Authorization", `Bearer ${tokens.staff}`);
      expect(spa.headers["content-type"] || "").not.toContain("image/");
      expect(Number(spa.headers["content-length"] || 0)).not.toBe(Number(row.bytes));
    });

    (hasChromium ? test : test.skip)(
      "a letter template generates a numbered, hashed, locked PDF, downloadable only by its readers",
      async () => {
        variables.defineVariables(
          "document",
          "test-letter",
          z.object({ employee_name: z.string(), amount: z.string(), effective: z.string() }),
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
        const doc = await tx((c) =>
          documents.generate(c, {
            doc_type: "test_letter",
            entity: { type: "employee", id: people.staff.employee.employee_id },
            subject_employee_id: people.staff.employee.employee_id,
            data: { employee_name: "Temi", amount: "25000.00", effective: "2026-11-01" },
            actor: people.ops.user,
          }),
        );
        expect([doc.number, doc.render_status]).toEqual(["LTR-0001", "pending"]);

        // Still rendering, so nothing is served yet.
        expect((await as(tokens.staff).get(`/documents/${doc.document_id}/content`)).status).toBe(409);

        const done = await documents.renderPending(doc.document_id, { db: pool });
        expect(done.locked_at).toBeTruthy();
        expect(done.content_hash).toBe(sha256(await storage.get(done.storage_key)));

        const read = await as(tokens.staff).get(`/documents/${doc.document_id}/content`);
        expect(read.status).toBe(200);
        expect(read.headers["content-type"]).toBe("application/pdf");
        expect(read.body.subarray(0, 5).toString()).toBe("%PDF-");

        // It is about Temi, so Zainab cannot open it, and it cannot be replaced.
        expect((await as(tokens.other).get(`/documents/${doc.document_id}/content`)).status).toBe(404);
        const replace = await as(tokens.ops)
          .post(`/documents/${doc.document_id}/versions`)
          .attach("file", Buffer.from("%PDF-1.4\n%fake\n"), {
            filename: "replacement.pdf",
            contentType: "application/pdf",
          });
        expect(replace.status).toBe(409);
        expect(replace.body.error.code).toBe("DOCUMENT_LOCKED");
      },
      90_000,
    );
  });

  /* ---------------------------------------------------------------- */

  describe("an employee's documents, and their own", () => {
    let tokens;
    let temiId;

    beforeAll(async () => {
      tokens = {
        ops: await tokenOf("ops@mycity.test", PASSWORD.ops),
        boss: await tokenOf("boss@mycity.test", PASSWORD.boss),
        staff: await tokenOf("temi@mycity.test", PASSWORD.staff),
        other: await tokenOf("zainab@mycity.test", PASSWORD.other),
      };
      temiId = people.staff.employee.employee_id;
    });

    const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

    test("People file a document, and it shows on the employee and on their own list", async () => {
      const filed = await as(tokens.ops)
        .post(`/employees/${temiId}/documents`)
        .field("title", "Employment contract")
        .attach("file", pdf(), { filename: "contract.pdf", contentType: "application/pdf" });
      expect(filed.status).toBe(201);
      expect(filed.body).toMatchObject({
        name: "Employment contract",
        status: "awaiting_verification",
        document_request_id: null,
      });

      const onRecord = await as(tokens.ops).get(`/employees/${temiId}/documents`);
      expect(onRecord.status).toBe(200);
      expect(onRecord.body.page.size).toBe(25);
      expect(onRecord.body.data.some((r) => r.name === "Employment contract")).toBe(true);

      const mine = await as(tokens.staff).get("/ess/documents");
      expect(mine.status).toBe(200);
      expect(mine.body.data.some((r) => r.name === "Employment contract")).toBe(true);

      // Zainab's own list is her own, and she cannot read Temi's record.
      expect((await as(tokens.other).get("/ess/documents")).body.data).toHaveLength(0);
      expect((await as(tokens.other).get(`/employees/${temiId}/documents`)).status).toBe(403);
    });

    test("a manager sees their team, and nobody else", async () => {
      expect((await as(tokens.boss).get(`/employees/${temiId}/documents`)).status).toBe(200);
      const outside = people.other.employee.employee_id;
      expect((await as(tokens.boss).get(`/employees/${outside}/documents`)).status).toBe(404);
    });

    test("People ask for a document; it is Missing until the employee uploads it", async () => {
      const asked = await as(tokens.ops)
        .post(`/employees/${temiId}/document-requests`)
        .send({ name: "Passport photograph", note: "For the ID card" });
      expect(asked.status).toBe(201);
      expect(asked.body).toMatchObject({ status: "missing", document_id: null, uploaded_at: null });
      const requestId = asked.body.document_request_id;

      const before = await as(tokens.staff).get("/ess/documents/summary");
      expect(before.body.missing).toBe(1);

      const photo = await sharp({
        create: { width: 600, height: 800, channels: 3, background: "#ffffff" },
      })
        .jpeg()
        .toBuffer();
      const given = await as(tokens.staff)
        .post("/ess/documents")
        .field("document_request_id", requestId)
        .attach("file", photo, { filename: "me.jpg", contentType: "image/jpeg" });
      expect(given.status).toBe(201);
      expect(given.body).toMatchObject({ name: "Passport photograph", status: "awaiting_verification" });

      const after = await as(tokens.staff).get("/ess/documents/summary");
      expect(after.body.missing).toBe(0);
      expect(after.body.documents).toBe(before.body.documents + 1);

      // The same request cannot be answered twice.
      const again = await as(tokens.staff)
        .post("/ess/documents")
        .field("document_request_id", requestId)
        .attach("file", photo, { filename: "me.jpg", contentType: "image/jpeg" });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("DOCUMENT_REQUEST_CLOSED");
    });

    test("People accept a document, and the status follows", async () => {
      const list = await as(tokens.ops).get(`/employees/${temiId}/documents?q=Passport`);
      const row = list.body.data[0];
      expect(row.status).toBe("awaiting_verification");

      const accepted = await as(tokens.ops).post(`/documents/${row.document_id}/verify`).send({});
      expect(accepted.status).toBe(200);
      expect(accepted.body.verified_at).toBeTruthy();

      const again = await as(tokens.staff).get("/ess/documents?status=verified");
      expect(again.body.data.map((r) => r.name)).toContain("Passport photograph");
      expect((await as(tokens.staff).get("/ess/documents/summary")).body.verified).toBe(1);
    });

    test("a new version keeps the old bytes and lists both", async () => {
      const list = await as(tokens.ops).get(`/employees/${temiId}/documents?q=Employment`);
      const id = list.body.data[0].document_id;
      const next = await as(tokens.ops)
        .post(`/documents/${id}/versions`)
        .field("title", "Employment contract")
        .attach("file", Buffer.from("%PDF-1.4\n2 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"), {
          filename: "contract-v2.pdf",
          contentType: "application/pdf",
        });
      expect(next.status).toBe(201);
      expect(next.body).toMatchObject({ version: 2, is_current: true });

      const chain = await as(tokens.ops).get(`/documents/${next.body.document_id}/versions`);
      expect(chain.status).toBe(200);
      expect(chain.body.data.map((d) => d.version)).toEqual([2, 1]);
      expect((await as(tokens.ops).get(`/documents/${id}/content`)).status).toBe(200);

      // The employee's list shows one row for the document, at its new version.
      const mine = await as(tokens.staff).get("/ess/documents?q=Employment");
      expect(mine.body.data).toHaveLength(1);
      expect(mine.body.data[0].version).toBe(2);
    });

    test("a restricted document needs the module's edit grant, not just view", async () => {
      const filed = await as(tokens.ops)
        .post(`/employees/${temiId}/documents`)
        .field("doc_type", "employee_identification")
        .field("title", "National ID")
        .attach("file", pdf(), { filename: "id.pdf", contentType: "application/pdf" });
      expect(filed.status).toBe(201);
      const id = filed.body.document_id;

      expect((await as(tokens.staff).get(`/documents/${id}/content`)).status).toBe(200);
      expect((await as(tokens.ops).get(`/documents/${id}/content`)).status).toBe(200);
      // Kunle manages Temi and may view People, but not edit, so a restricted file is not his to open.
      expect((await as(tokens.boss).get(`/documents/${id}/content`)).status).toBe(404);
    });
  });

  /* ---------------------------------------------------------------- */

  describe("the imports API over a registered importer", () => {
    let tokens;
    let batch;

    beforeAll(async () => {
      tokens = {
        ops: await tokenOf("ops@mycity.test", PASSWORD.ops),
        staff: await tokenOf("temi@mycity.test", PASSWORD.staff),
      };
    });

    test("what I can import is my own grants, not everyone's", async () => {
      const mine = await as(tokens.ops).get("/imports/importers");
      expect(mine.status).toBe(200);
      expect(mine.body.importers.map((i) => i.key)).toContain("test_pets");
      const fields = mine.body.importers.find((i) => i.key === "test_pets").fields;
      expect(fields.map((f) => f.key)).toEqual(["name", "colour"]);
      expect(fields[0]).toMatchObject({ label: "Name", required: true, type: "text", pass: 1 });

      // An employee holds no people.create grant, so there is nothing to import.
      expect((await as(tokens.staff).get("/imports/importers")).body.importers).toHaveLength(0);
    });

    test("the blank template comes back as a workbook", async () => {
      const res = await as(tokens.ops)
        .get("/imports/importers/test_pets/template")
        .responseType("blob");
      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toContain(".xlsx");
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(res.body);
      expect(book.getWorksheet("Pets").getRow(1).values).toEqual(
        expect.arrayContaining(["Name", "Colour"]),
      );
    });

    test("upload, map, preview, commit", async () => {
      const file = await sheet([
        ["Pet Name", "Colour"],
        ["Mango", "ginger"],
        ["Pepper", "black"],
      ]);
      const up = await as(tokens.ops)
        .post("/imports")
        .field("importer_key", "test_pets")
        .attach("file", file, {
          filename: "pets.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
      expect(up.status).toBe(201);
      batch = up.body.import_batch_id;
      expect(up.body).toMatchObject({ importer_key: "test_pets", importer_label: "Pets", status: "mapped" });
      expect(up.body.number).toMatch(/^IMP-\d{4}$/);
      expect(up.body.created_by_name).toBe("Ngozi Umeh");
      expect(up.body.header_row).toBe(0);
      expect(up.body.mapping.columns.map((c) => c.field)).toEqual(["name", "colour"]);

      const mapped = await as(tokens.ops)
        .put(`/imports/${batch}/mapping`)
        .send({ fields: { 0: "name", 1: "colour" } });
      expect(mapped.status).toBe(200);

      const preview = await as(tokens.ops).post(`/imports/${batch}/preview`).send({});
      expect(preview.status).toBe(200);
      expect(preview.body.stats).toMatchObject({ rows: 2, create: 2, update: 0, error: 0 });
      // The preview was rolled back: nothing is in the table yet.
      expect((await one("SELECT count(*)::int AS n FROM test_pet")).n).toBe(0);

      const rows = await as(tokens.ops).get(`/imports/${batch}/rows`);
      expect(rows.status).toBe(200);
      expect(rows.body.data.map((r) => r.action)).toEqual(["create", "create"]);

      const committed = await as(tokens.ops).post(`/imports/${batch}/commit`).send({});
      expect(committed.status).toBe(200);
      expect(committed.body.batch.status).toBe("committed");
      expect((await one("SELECT count(*)::int AS n FROM test_pet WHERE archived_at IS NULL")).n).toBe(2);
    });

    test("the error file is the person's own rows, with Status and Problem", async () => {
      const file = await sheet([
        ["Pet Name", "Colour"],
        ["", "grey"],
        ["Mango", "ginger"],
      ]);
      const up = await as(tokens.ops)
        .post("/imports")
        .field("importer_key", "test_pets")
        .attach("file", file, {
          filename: "more-pets.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
      const id = up.body.import_batch_id;
      const preview = await as(tokens.ops).post(`/imports/${id}/preview`).send({});
      expect(preview.body.stats).toMatchObject({ error: 1, unchanged: 1 });

      const refused = await as(tokens.ops).post(`/imports/${id}/commit`).send({});
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe("IMPORT_HAS_ERRORS");

      const errors = await as(tokens.ops).get(`/imports/${id}/rows?status=error`);
      expect(errors.body.data).toHaveLength(1);

      const report = await as(tokens.ops).get(`/imports/${id}/report`).responseType("blob");
      expect(report.status).toBe(200);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(report.body);
      const ws = book.getWorksheet("Pets");
      expect(ws.getRow(1).values).toEqual(expect.arrayContaining(["Pet Name", "Colour", "Status", "Problem"]));
      expect(JSON.stringify(ws.getRow(2).values)).toContain("Not imported");
    });

    test("revert puts the records back, and the history shows every batch", async () => {
      const reverted = await as(tokens.ops).post(`/imports/${batch}/revert`).send({});
      expect(reverted.status).toBe(200);
      expect(reverted.body).toMatchObject({ archived: 2, restored: 0 });
      expect(reverted.body.batch.status).toBe("reverted");
      expect((await one("SELECT count(*)::int AS n FROM test_pet WHERE archived_at IS NULL")).n).toBe(0);

      const history = await as(tokens.ops).get("/imports");
      expect(history.status).toBe(200);
      expect(history.body.page.size).toBe(25);
      expect(history.body.data.map((b) => b.status)).toContain("reverted");
      expect(history.body.data[0]).toHaveProperty("importer_label", "Pets");

      // The history is the settings grant; an employee has neither it nor the importer.
      expect((await as(tokens.staff).get("/imports")).status).toBe(403);
      expect((await as(tokens.staff).get(`/imports/${batch}`)).status).toBe(404);
    });
  });
});
