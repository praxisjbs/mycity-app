"use strict";
/**
 * M10 Knowledge Hub's schema and reference data (migrations 10400, 10410 and 10440,
 * seeds/reference/10490_seed_knowledge.sql; docs/guides/knowledge.md §4) on the real migrations: the
 * shape every table must have (a trigger, an index and an ON DELETE on each foreign key, a CHECK equal
 * to the contract's enum), the rows the constraints refuse, the numbers an SOP, a course and a
 * certificate are given, the seed both ways, and the files undone and applied again.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/knowledge-schema
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema
 * from the real migrations (helpers/schema.js). A test that changes rows does it in a transaction it
 * rolls back.
 */
const { config } = require("../../src/config/env");
const schema = require("./helpers/schema");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const migrate = require("../../scripts/db/migrate");
const numbering = require("../../src/shared/numbering/numbering");
const catalog = require("../../src/shared/access/access.catalog");
const c = require("@mycity/contract");

const FILES = Object.fromEntries(migrate.listMigrations().map((f) => [f.name, f]));
const M10 = ["10400_sops", "10410_training", "10440_training_notes", "10490_seed_knowledge"].map((n) => FILES[n]);

const MUTABLE = ["sop", "sop_version", "training_course", "training_item", "training_assignment", "training_enrolment", "training_note"];
const WRITTEN_WHOLE = ["sop_step", "training_assignment_audience", "training_item_progress"];
const TABLES = [...MUTABLE, ...WRITTEN_WHOLE];
const CAPABILITIES = ["sops.manage", "training.manage"];
const SCHEMES = ["sop", "training_course", "training_certificate"];

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

/** Run `fn` on one connection inside a transaction that is always rolled back. */
async function rolledBack(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/** The statement fails with this SQLSTATE, naming this constraint. */
const refused = (promise, code, constraint) => expect(promise).rejects.toMatchObject({ code, constraint });

/** A refusal aborts its transaction; a savepoint taken first keeps it usable for the next. */
async function refusedHere(client, statement, code, constraint) {
  await client.query("SAVEPOINT refusal");
  await refused(statement(), code, constraint);
  await client.query("ROLLBACK TO SAVEPOINT refusal");
}

/** INSERT a row of `columns` into `table`, returning its id column. */
const insert = async (cl, table, columns) => {
  const names = Object.keys(columns);
  const marks = names.map((_, i) => `$${i + 1}`).join(", ");
  return (await cl.query(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${marks}) RETURNING ${table}_id AS id`, Object.values(columns))).rows[0].id;
};

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("M10 Knowledge Hub schema and reference data against the real migrations", () => {
  let ada;
  let adaUser;
  let department;
  let doc;
  let seq = 0;
  const next = (prefix) => {
    seq += 1;
    return `${prefix}-T${seq}`;
  };

  beforeAll(async () => {
    await schema.rebuild(pool, config.DB_NAME);
    ada = (await one(schema.sql.employee, ["Ada", "Obi", null])).employee_id;
    adaUser = (await one(schema.sql.userPlain, [ada, "ada.obi@staff.mycity.test"])).user_id;
    department = (await one("SELECT department_id FROM department WHERE code = 'TEST'")).department_id;
    doc = (
      await one(
        `INSERT INTO document (doc_type, original_name, storage_key, mime, bytes, entity_type, entity_id, sensitivity, scan_status, source)
         VALUES ('training_material', 'handbook.pdf', 'training/2026/11/handbook.pdf', 'application/pdf', 10, 'training_course', 't1', 'normal', 'skipped', 'upload')
         RETURNING document_id`,
      )
    ).document_id;
  });

  afterAll(() => pool.end());

  const sop = (cl, columns = {}) => insert(cl, "sop", { number: next("SOP"), department_id: department, title: "Launch a campaign", ...columns });
  const course = (cl, columns = {}) => insert(cl, "training_course", { number: next("TRN"), title: "Data protection", ...columns });
  const enrolment = (cl, courseId, columns = {}) => insert(cl, "training_enrolment", { training_course_id: courseId, employee_id: ada, ...columns });

  describe("the shape of every table", () => {
    test("each table people change has its own updated_at trigger; the rows written whole have none", async () => {
      const rows = (
        await q(
          `SELECT c.relname AS tbl, array_agg(t.tgname::text ORDER BY t.tgname::text) AS triggers
             FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            WHERE NOT t.tgisinternal AND c.relname = ANY($1) GROUP BY c.relname`,
          [TABLES],
        )
      ).rows;
      const triggers = Object.fromEntries(rows.map((r) => [r.tbl, r.triggers]));
      for (const t of MUTABLE) expect({ table: t, triggers: triggers[t] }).toEqual({ table: t, triggers: expect.arrayContaining([`${t}_set_updated_at`]) });
      for (const t of WRITTEN_WHOLE) expect({ table: t, triggers: (triggers[t] || []).filter((n) => n === `${t}_set_updated_at`) }).toEqual({ table: t, triggers: [] });
    });

    test("every foreign key says ON DELETE and is the first column of an index", async () => {
      const keys = (
        await q(
          `SELECT c.conrelid::regclass::text AS tbl, c.conname, c.confdeltype AS on_delete,
                  EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]) AS indexed
             FROM pg_constraint c
            WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY($1)`,
          [TABLES],
        )
      ).rows;
      // sop 4, sop_version 4, sop_step 2, course 5, item 2, assignment 3, audience 4, enrolment 6, progress 2, note 2.
      expect(keys).toHaveLength(34);
      // 'a' is NO ACTION, what Postgres does when no ON DELETE is written.
      expect(keys.filter((k) => k.on_delete === "a").map((k) => k.conname)).toEqual([]);
      expect(keys.filter((k) => !k.indexed).map((k) => k.conname)).toEqual([]);
    });

    test("a status or kind CHECK holds exactly the contract's values", async () => {
      const checks = [
        ["sop", "status", ["active", "archived"]],
        ["sop_version", "status", ["draft", "published"]],
        ["training_course", "status", c.training.CourseState.options],
        ["training_item", "kind", c.training.ItemKind.options],
      ];
      for (const [table, column, values] of checks) {
        const defs = (await q("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c'", [table])).rows.map((r) => r.def);
        const def = defs.find((d) => d.startsWith(`CHECK ((${column} = ANY`) || d.startsWith(`CHECK (${column} = ANY`));
        expect({ table, column, found: Boolean(def) }).toEqual({ table, column, found: true });
        const listed = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
        expect({ table, column, values: listed.sort() }).toEqual({ table, column, values: [...values].sort() });
      }
    });
  });

  describe("SOPs", () => {
    test("one draft an SOP; a version needs its number, purpose, hash and publication, and a number is used once", async () => {
      await rolledBack(async (cl) => {
        const s = await sop(cl);
        const version = (columns) => insert(cl, "sop_version", { sop_id: s, title: "Launch a campaign", ...columns });
        await version({});
        await refusedHere(cl, () => version({}), "23505", "sop_version_one_draft_uq");
        const published = { status: "published", purpose: "So launches go the same way", content_hash: "h", published_at: new Date() };
        await version({ ...published, version: 1 });
        await refusedHere(cl, () => version({ ...published, version: 1 }), "23505", "sop_version_number_uq");
        await refusedHere(cl, () => version({ ...published, version: 2, purpose: null }), "23514", "sop_version_state_check");
        await refusedHere(cl, () => version({ ...published, version: null }), "23514", "sop_version_state_check");
        await refusedHere(cl, () => version({ ...published, version: 3, roles: Array.from({ length: 11 }, (_, i) => `Role ${i}`) }), "23514", "sop_version_roles_check");
        await refusedHere(cl, () => cl.query("UPDATE sop SET status = 'archived' WHERE sop_id = $1", [s]), "23514", "sop_archived_check");
      });
    });

    test("a step is 1 to 50 and once a version, names a screen as module/tab, and goes with its version", async () => {
      await rolledBack(async (cl) => {
        const s = await sop(cl);
        const v = await insert(cl, "sop_version", { sop_id: s, title: "Launch a campaign" });
        const step = (columns) => insert(cl, "sop_step", { sop_version_id: v, position: 1, text: "Brief the designer", ...columns });
        await step({ screen_key: "workspace/tasks", document_id: doc, who: "Brand Lead" });
        await refusedHere(cl, () => step({}), "23505", "sop_step_position_uq");
        await refusedHere(cl, () => step({ position: 51 }), "23514", "sop_step_position_check");
        await refusedHere(cl, () => step({ position: 2, screen_key: "Workspace Tasks" }), "23514", "sop_step_screen_key_check");
        await cl.query("DELETE FROM sop_version WHERE sop_version_id = $1", [v]);
        expect((await cl.query("SELECT count(*)::int AS n FROM sop_step WHERE sop_version_id = $1", [v])).rows[0].n).toBe(0);
      });
    });
  });

  describe("training", () => {
    test("a course is published once, with its signature, and an archived one says when", async () => {
      await rolledBack(async (cl) => {
        await refusedHere(cl, () => course(cl, { status: "published" }), "23514", "training_course_published_state_check");
        await refusedHere(cl, () => course(cl, { published_at: new Date(), published_by: adaUser, signer_name: "Ada Obi" }), "23514", "training_course_published_check");
        await course(cl, { status: "published", published_at: new Date(), published_by: adaUser, signer_name: "Ada Obi", signature_document_id: doc });
        await refusedHere(cl, () => course(cl, { status: "archived" }), "23514", "training_course_archived_check");
      });
    });

    test("an item holds exactly its kind's content, links are https, and two positions can swap within a transaction", async () => {
      await rolledBack(async (cl) => {
        const t = await course(cl);
        const item = (columns) => insert(cl, "training_item", { training_course_id: t, title: "Watch", ...columns });
        const a = await item({ position: 1, kind: "video", url: "https://youtu.be/abc" });
        const b = await item({ position: 2, kind: "file", document_id: doc });
        await item({ position: 3, kind: "lesson", lesson_markdown: "## What the NDPA asks" });
        await refusedHere(cl, () => item({ position: 4, kind: "video", url: "https://youtu.be/x", document_id: doc }), "23514", "training_item_content_check");
        await refusedHere(cl, () => item({ position: 4, kind: "lesson" }), "23514", "training_item_content_check");
        await refusedHere(cl, () => item({ position: 4, kind: "link", url: "http://example.com" }), "23514", "training_item_url_check");
        await refusedHere(cl, () => item({ position: 41, kind: "link", url: "https://example.com" }), "23514", "training_item_position_check");
        // Deferred until commit, so a reorder writes one position over another and then the other.
        await cl.query("SAVEPOINT swap");
        await cl.query("UPDATE training_item SET position = 2 WHERE training_item_id = $1", [a]);
        await cl.query("UPDATE training_item SET position = 1 WHERE training_item_id = $1", [b]);
        await cl.query("SET CONSTRAINTS training_item_position_uq IMMEDIATE");
        await cl.query("RELEASE SAVEPOINT swap");
        await refusedHere(cl, () => cl.query("UPDATE training_item SET position = 1 WHERE training_item_id = $1", [a]), "23505", "training_item_position_uq");
      });
    });

    test("an audience row names one of a department, a role or a person, once an assignment", async () => {
      await rolledBack(async (cl) => {
        const t = await course(cl);
        const assignment = await insert(cl, "training_assignment", { training_course_id: t, due_within_days: 14, created_by: adaUser });
        const role = (await cl.query("SELECT role_id FROM role WHERE code = 'employee'")).rows[0].role_id;
        const audience = (columns) => insert(cl, "training_assignment_audience", { training_assignment_id: assignment, ...columns });
        await audience({ department_id: department });
        await audience({ role_id: role });
        await audience({ employee_id: ada });
        await refusedHere(cl, () => audience({ department_id: department }), "23505", "training_assignment_audience_once_uq");
        await refusedHere(cl, () => audience({ department_id: department, employee_id: ada }), "23514", "training_assignment_audience_one_check");
        await refusedHere(cl, () => insert(cl, "training_assignment", { training_course_id: t, due_within_days: 366 }), "23514", "training_assignment_due_within_days_check");
        await refusedHere(cl, () => insert(cl, "training_assignment", { training_course_id: t, withdrawn_at: new Date() }), "23514", "training_assignment_withdrawn_check");
      });
    });

    test("one enrolment a person and course; proof is a link or a file; a certificate needs a completion and the facts it states", async () => {
      await rolledBack(async (cl) => {
        const t = await course(cl);
        const e = await enrolment(cl, t);
        await refusedHere(cl, () => enrolment(cl, t), "23505", "training_enrolment_once_uq");
        const set = (columns) => {
          const names = Object.keys(columns);
          return cl.query(`UPDATE training_enrolment SET ${names.map((n, i) => `${n} = $${i + 2}`).join(", ")} WHERE training_enrolment_id = $1`, [e, ...Object.values(columns)]);
        };
        await refusedHere(cl, () => set({ proof_url: "https://certs.example/1", proof_document_id: doc }), "23514", "training_enrolment_proof_check");
        await refusedHere(cl, () => set({ proof_url: "http://certs.example/1" }), "23514", "training_enrolment_proof_url_check");
        await refusedHere(cl, () => set({ certificate_number: "CERT-2026-0001", certificate_hash: "h" }), "23514", "training_enrolment_certificate_check");
        await refusedHere(cl, () => set({ certificate_document_id: doc }), "23514", "training_enrolment_certificate_pdf_check");
        // The name and course title it states come with the number (10430).
        const issued = { completed_at: new Date(), certificate_number: "CERT-2026-0001", certificate_hash: "h", certificate_document_id: doc };
        await refusedHere(cl, () => set(issued), "23514", "training_enrolment_certificate_facts_check");
        await refusedHere(cl, () => set({ ...issued, certificate_holder_name: "Ada Obi" }), "23514", "training_enrolment_certificate_facts_check");
        await set({ ...issued, certificate_holder_name: "Ada Obi", certificate_course_title: "Fire Safety" });
      });
    });

    test("progress is once an item; it goes with its item, and with its enrolment", async () => {
      await rolledBack(async (cl) => {
        const t = await course(cl);
        const i = await insert(cl, "training_item", { training_course_id: t, position: 1, kind: "link", title: "Course", url: "https://learn.example/ndpa" });
        const e = await enrolment(cl, t);
        await insert(cl, "training_item_progress", { training_enrolment_id: e, training_item_id: i });
        await refusedHere(cl, () => insert(cl, "training_item_progress", { training_enrolment_id: e, training_item_id: i }), "23505", "training_item_progress_once_uq");
        await cl.query("DELETE FROM training_item WHERE training_item_id = $1", [i]);
        expect((await cl.query("SELECT count(*)::int AS n FROM training_item_progress WHERE training_enrolment_id = $1", [e])).rows[0].n).toBe(0);
      });
    });
  });

  describe("numbers", () => {
    test("an SOP, a course and a certificate are numbered as the guide says, a certificate by its year", async () => {
      const client = await pool.connect();
      try {
        const issued = [];
        await atomically(client, async () => {
          for (const [type, date] of [["sop", "2026-11-11"], ["sop", "2026-11-11"], ["training_course", "2026-11-11"], ["training_certificate", "2026-11-30"], ["training_certificate", "2027-01-04"]]) {
            issued.push((await numbering.allocate(client, type, { date })).number);
          }
          throw new Error("rolled back");
        }).catch((err) => {
          if (err.message !== "rolled back") throw err;
        });
        expect(issued).toEqual(["SOP-0001", "SOP-0002", "TRN-0001", "CERT-2026-0001", "CERT-2027-0001"]);
      } finally {
        client.release();
      }
    });
  });

  describe("10490", () => {
    test("gives sops.manage and training.manage, named as the catalogue names them, to Operations & People and the Implementation Team", async () => {
      const held = (
        await q(
          `SELECT c.code::text AS code, c.name, c.description, array_agg(r.code::text ORDER BY r.code::text) AS roles
             FROM capability c JOIN role_capability rc USING (capability_id) JOIN role r USING (role_id)
            WHERE c.code::text = ANY($1) GROUP BY 1, 2, 3 ORDER BY 1`,
          [CAPABILITIES],
        )
      ).rows;
      expect(held).toEqual(
        CAPABILITIES.map((code) => {
          const declared = catalog.CAPABILITY_CATALOG.find((x) => x.code === code);
          expect(declared.module).toBe("knowledge");
          return { code, name: declared.label, description: declared.description, roles: ["implementation", "operations_people"] };
        }),
      );
    });

    test("seeds the three numbering schemes and no SOP, course, assignment or enrolment (A26)", async () => {
      const schemes = (await q("SELECT doc_type::text AS doc_type, prefix, padding, separator, reset, include_period FROM numbering_scheme WHERE doc_type = ANY($1) ORDER BY doc_type", [SCHEMES])).rows;
      expect(schemes).toEqual([
        { doc_type: "sop", prefix: "SOP", padding: 4, separator: "-", reset: "never", include_period: false },
        { doc_type: "training_certificate", prefix: "CERT", padding: 4, separator: "-", reset: "yearly", include_period: true },
        { doc_type: "training_course", prefix: "TRN", padding: 4, separator: "-", reset: "never", include_period: false },
      ]);
      for (const table of TABLES) {
        expect({ table, rows: (await one(`SELECT count(*)::int AS n FROM ${table}`)).n }).toEqual({ table, rows: 0 });
      }
    });

    test("undoes only what it gave, and runs again without changing anything", async () => {
      await rolledBack(async (cl) => {
        const seed = FILES["10490_seed_knowledge"];
        const state = async () => ({
          capabilities: (await cl.query("SELECT count(*)::int AS n FROM capability WHERE code = ANY($1)", [CAPABILITIES])).rows[0].n,
          grants: (await cl.query("SELECT count(*)::int AS n FROM role_capability rc JOIN capability c USING (capability_id) WHERE c.code = ANY($1)", [CAPABILITIES])).rows[0].n,
          schemes: (await cl.query("SELECT count(*)::int AS n FROM numbering_scheme WHERE doc_type = ANY($1)", [SCHEMES])).rows[0].n,
        });
        const seeded = await state();
        expect(seeded).toEqual({ capabilities: 2, grants: 4, schemes: 3 });
        await cl.query(seed.up);
        expect(await state()).toEqual(seeded);
        await cl.query(seed.down);
        expect(await state()).toEqual({ capabilities: 0, grants: 0, schemes: 0 });
        await cl.query(seed.up);
        expect(await state()).toEqual(seeded);
      });
    });

    test("keeps a capability someone has since given to a person when it is undone", async () => {
      await rolledBack(async (cl) => {
        await cl.query("INSERT INTO user_capability (user_id, capability_id) SELECT $1, capability_id FROM capability WHERE code = 'training.manage'", [adaUser]);
        await cl.query(FILES["10490_seed_knowledge"].down);
        expect((await cl.query("SELECT code::text AS code FROM capability WHERE code = ANY($1)", [CAPABILITIES])).rows).toEqual([{ code: "training.manage" }]);
      });
    });
  });

  describe("undone and applied again", () => {
    test("10490, 10440, 10410 and 10400 come off in that order and go back, leaving the database as it was", async () => {
      await rolledBack(async (cl) => {
        const shape = async () => ({
          tables: (await cl.query("SELECT relname FROM pg_class WHERE relname = ANY($1) AND relkind = 'r' ORDER BY relname", [TABLES])).rows.map((r) => r.relname),
          indexes: (await cl.query("SELECT indexname FROM pg_indexes WHERE tablename = ANY($1) ORDER BY indexname", [TABLES])).rows.map((r) => r.indexname),
          triggers: (await cl.query("SELECT tgname::text AS t FROM pg_trigger WHERE NOT tgisinternal AND tgname::text LIKE ANY($1) ORDER BY 1", [TABLES.map((t) => `${t}_set_updated_at`)])).rows.map((r) => r.t),
        });
        const before = await shape();
        expect(before.tables).toEqual([...TABLES].sort());
        expect(before.triggers).toHaveLength(MUTABLE.length);

        for (const file of [...M10].reverse()) await cl.query(file.down);
        expect(await shape()).toEqual({ tables: [], indexes: [], triggers: [] });

        for (const file of M10) await cl.query(file.up);
        expect(await shape()).toEqual(before);
      });
    });
  });
});
