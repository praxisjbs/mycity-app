"use strict";
/**
 * M7's schema and reference data (migrations 7010 to 7050, seeds/reference/7190_seed_partnerships.sql;
 * docs/guides/partnerships.md §4) on the real migrations: the constraints that refuse a bad row, the
 * rows 7020 converts on a database that already holds partners, and 7190 both ways.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/partnerships-schema
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
const definitions = require("../../src/shared/workflow/definitions");
const catalog = require("../../src/shared/access/access.catalog");

const FILES = Object.fromEntries(migrate.listMigrations().map((f) => [f.name, f]));
const RECORDS = FILES["7020_partnership_records_and_deals"];
const SEED = FILES["7190_seed_partnerships"];
const DOCUMENTS = FILES["7050_partnership_documents"];

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

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("M7 partnerships schema and reference data against the real migrations", () => {
  let owner;
  let seq = 0;
  const next = (prefix) => {
    seq += 1;
    return `${prefix}-T${seq}`;
  };
  /** A partner; `columns` sets any of its columns beside its number and name. */
  const partner = async (c, columns = {}) => {
    const names = ["number", "name", ...Object.keys(columns)];
    const values = [next("PAR"), "Eko Arts", ...Object.values(columns)];
    const marks = names.map((_, i) => `$${i + 1}`).join(", ");
    return (await c.query(`INSERT INTO partner (${names.join(", ")}) VALUES (${marks}) RETURNING partner_id`, values)).rows[0].partner_id;
  };
  const lead = async (c) => (await c.query("INSERT INTO lead (number, name) VALUES ($1, 'Kano Fair') RETURNING lead_id", [next("LED")])).rows[0].lead_id;
  const deal = async (c, { partnerId = null, leadId = null } = {}) =>
    (
      await c.query(
        `INSERT INTO partnership_opportunity (number, partner_id, lead_id, title, stage)
         VALUES ($1, $2, $3, 'Festival', 'prospect_identified') RETURNING partnership_opportunity_id`,
        [next("DEAL"), partnerId, leadId],
      )
    ).rows[0].partnership_opportunity_id;

  beforeAll(async () => {
    await schema.rebuild(pool, config.DB_NAME);
    owner = (await one(schema.sql.employee, ["Ada", "Obi", null])).employee_id;
  });

  afterAll(() => pool.end());

  describe("the records", () => {
    test("a partner is active, dormant or closed, dormant to start, and has no type (dropped by 7050, M7 PR 3)", async () => {
      await rolledBack(async (c) => {
        const id = await partner(c);
        expect((await c.query("SELECT status FROM partner WHERE partner_id = $1", [id])).rows[0]).toEqual({ status: "dormant" });
        expect((await c.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'partner' AND column_name = 'partner_type'")).rows[0].n).toBe(0);
        await refused(c.query("UPDATE partner SET status = 'prospect' WHERE partner_id = $1", [id]), "23514", "partner_status_check");
      });
    });

    test("a lost lead has its reason and a converted one its partner", async () => {
      await rolledBack(async (c) => {
        const id = await lead(c);
        expect((await c.query("SELECT status FROM lead WHERE lead_id = $1", [id])).rows[0].status).toBe("new");
        await c.query("SAVEPOINT s");
        await refused(c.query("UPDATE lead SET status = 'lost' WHERE lead_id = $1", [id]), "23514", "lead_lost_reason");
        await c.query("ROLLBACK TO SAVEPOINT s");
        await refused(c.query("UPDATE lead SET status = 'converted' WHERE lead_id = $1", [id]), "23514", "lead_converted_partner");
      });
    });

    test("a deal is on a lead or a partner, Stalled has its blockers, and its event ends after it starts", async () => {
      await rolledBack(async (c) => {
        const leadId = await lead(c);
        const id = await deal(c, { leadId });
        expect((await c.query("SELECT status, health FROM partnership_opportunity WHERE partnership_opportunity_id = $1", [id])).rows[0]).toEqual({ status: "open", health: "on_track" });
        await c.query("SAVEPOINT s");
        await refused(deal(c), "23514", "partnership_opportunity_on_a_record");
        await c.query("ROLLBACK TO SAVEPOINT s");
        await refused(c.query("UPDATE partnership_opportunity SET health = 'stalled' WHERE partnership_opportunity_id = $1", [id]), "23514", "partnership_opportunity_stalled_blockers");
        await c.query("ROLLBACK TO SAVEPOINT s");
        await refused(
          c.query("UPDATE partnership_opportunity SET event_starts_on = '2026-12-05', event_ends_on = '2026-12-04' WHERE partnership_opportunity_id = $1", [id]),
          "23514",
          "partnership_opportunity_event_dates",
        );
        await c.query("ROLLBACK TO SAVEPOINT s");
        await refused(c.query("UPDATE partnership_opportunity SET status = 'won' WHERE partnership_opportunity_id = $1", [id]), "23514", "partnership_opportunity_status_check");
      });
    });

    test("a contact, an interaction and an agreement belong to one record, never both", async () => {
      await rolledBack(async (c) => {
        const partnerId = await partner(c);
        const leadId = await lead(c);
        await c.query("INSERT INTO partner_contact (lead_id, first_name, last_name, phones) VALUES ($1, 'Bola', 'Ade', '{+2348031234567,+2348091234567}')", [leadId]);
        await c.query("SAVEPOINT s");
        await refused(
          c.query("INSERT INTO partner_contact (partner_id, lead_id, first_name, last_name) VALUES ($1, $2, 'Two', 'Homes')", [partnerId, leadId]),
          "23514",
          "partner_contact_one_record",
        );
        await c.query("ROLLBACK TO SAVEPOINT s");
        await refused(
          c.query("INSERT INTO partner_interaction (interaction_type, subject, occurred_at) VALUES ('call', 'No one', now())"),
          "23514",
          "partner_interaction_one_record",
        );
        await c.query("ROLLBACK TO SAVEPOINT s");
        await refused(
          c.query("INSERT INTO partner_interaction (lead_id, interaction_type, subject, occurred_at) VALUES ($1, 'fax', 'Old', now())", [leadId]),
          "23514",
          "partner_interaction_type_check",
        );
        await c.query("ROLLBACK TO SAVEPOINT s");
        // An agreement on a lead waits for its signing to have a start.
        await c.query("INSERT INTO partnership_agreement (lead_id, number, title, kind) VALUES ($1, $2, 'MOU', 'mou')", [leadId, next("AGR")]);
        await refused(
          c.query("INSERT INTO partnership_agreement (partner_id, lead_id, number, title) VALUES ($1, $2, $3, 'Both')", [partnerId, leadId, next("AGR")]),
          "23514",
          "partnership_agreement_one_record",
        );
      });
    });

    test("a deal has at most five options, one a position, and a month of returns once", async () => {
      await rolledBack(async (c) => {
        const id = await deal(c, { partnerId: await partner(c) });
        await c.query("INSERT INTO deal_option (deal_id, position, label, deal_price, commission_amount) VALUES ($1, 1, 'Regular', 5000.00, 400.00)", [id]);
        await c.query("SAVEPOINT s");
        await refused(c.query("INSERT INTO deal_option (deal_id, position, label) VALUES ($1, 1, 'Again')", [id]), "23505", "deal_option_position_uq");
        await c.query("ROLLBACK TO SAVEPOINT s");
        await refused(c.query("INSERT INTO deal_option (deal_id, position, label) VALUES ($1, 6, 'Sixth')", [id]), "23514", "deal_option_position_check");
        await c.query("ROLLBACK TO SAVEPOINT s");
        await c.query("INSERT INTO deal_return (deal_id, month, units_sold, mycity_commission) VALUES ($1, '2026-11-01', 40, 16000.00)", [id]);
        await c.query("SAVEPOINT t");
        await refused(c.query("INSERT INTO deal_return (deal_id, month) VALUES ($1, '2026-11-01')", [id]), "23505", "deal_return_month_uq");
        await c.query("ROLLBACK TO SAVEPOINT t");
        await refused(c.query("INSERT INTO deal_return (deal_id, month) VALUES ($1, '2026-12-15')", [id]), "23514", "deal_return_month_check");
      });
    });

    test("a project, task or event is connected to a partner or a lead, never both", async () => {
      await rolledBack(async (c) => {
        const partnerId = await partner(c);
        const leadId = await lead(c);
        const user = (await c.query(schema.sql.userPlain, [owner, "ada@mycity.test"])).rows[0].user_id;
        await c.query("SAVEPOINT s");
        await refused(
          c.query("INSERT INTO task (title, status, created_by, partner_id, lead_id) VALUES ('Two', 'todo', $1, $2, $3)", [user, partnerId, leadId]),
          "23514",
          "task_partner_or_lead",
        );
        await c.query("ROLLBACK TO SAVEPOINT s");
        const id = await deal(c, { leadId });
        await c.query("INSERT INTO task (title, status, created_by, lead_id, deal_id) VALUES ('Send the deck', 'todo', $1, $2, $3)", [user, leadId, id]);
      });
    });

    test("agreement_obligation is gone; deal_deliverable replaces it", async () => {
      expect((await one("SELECT to_regclass('public.agreement_obligation') AS t")).t).toBeNull();
      expect((await one("SELECT to_regclass('public.deal_deliverable') AS t")).t).toBe("deal_deliverable");
    });
  });

  describe("7020 on a database that already holds partners", () => {
    test("a partner type becomes a category of 7099's label, a prospect is dormant, an unknown interaction a note", async () => {
      await rolledBack(async (c) => {
        // The rows as Home's staging seed wrote them before 7020: a type, a prospect, an odd interaction.
        // The type column is back as it was before 7050 dropped it, for these rows to hold one.
        await c.query(DOCUMENTS.down);
        await c.query("ALTER TABLE partner DROP CONSTRAINT partner_status_check");
        await c.query("ALTER TABLE partner_interaction DROP CONSTRAINT partner_interaction_type_check");
        const gov = await partner(c, { partner_type: "government", status: "prospect" });
        const odd = await partner(c, { partner_type: "film_board", status: "active" });
        await c.query("INSERT INTO partner_interaction (partner_id, interaction_type, subject, occurred_at) VALUES ($1, 'fax', 'Old', now())", [gov]);
        await c.query(RECORDS.up);
        const rows = (
          await c.query(
            `SELECT p.partner_id, p.status, p.partner_type, pc.name::text AS category
               FROM partner p LEFT JOIN partner_category pc USING (partner_category_id)
              WHERE p.partner_id = ANY($1::uuid[]) ORDER BY p.partner_type`,
            [[gov, odd]],
          )
        ).rows.map(({ partner_id: _, ...r }) => r);
        expect(rows).toEqual([
          { status: "active", partner_type: "film_board", category: "Film Board" },
          { status: "dormant", partner_type: "government", category: "Government" },
        ]);
        expect((await c.query("SELECT interaction_type FROM partner_interaction WHERE partner_id = $1", [gov])).rows[0].interaction_type).toBe("note");
        // Run again, nothing changes and nothing is made twice.
        const before = (await c.query("SELECT count(*)::int AS n FROM partner_category")).rows[0].n;
        await c.query(RECORDS.up);
        expect((await c.query("SELECT count(*)::int AS n FROM partner_category")).rows[0].n).toBe(before);
      });
    });
  });

  describe("7190, the reference data", () => {
    test("numbers a partner, lead, deal, proposal and agreement as §4.3 has them, and nothing as an MOU", async () => {
      const schemes = (await q("SELECT doc_type FROM numbering_scheme WHERE doc_type IN ('partner','lead','deal','proposal','agreement','mou','partnership_opportunity','partnership_agreement') ORDER BY 1")).rows;
      expect(schemes.map((r) => r.doc_type)).toEqual(["agreement", "deal", "lead", "partner", "proposal"]);
      // A number commits with its record, so each is allocated in a transaction of its own.
      const numberOf = async (type) => {
        const client = await pool.connect();
        try {
          return (await atomically(client, () => numbering.allocate(client, type))).number;
        } finally {
          client.release();
        }
      };
      const year = new Date().getFullYear();
      expect(await numberOf("partner")).toMatch(/^PAR-\d{4}$/);
      expect(await numberOf("lead")).toBe("LED-0001");
      expect(await numberOf("deal")).toMatch(new RegExp(`^DEAL-(${year}|${year + 1})-0001$`));
      expect(await numberOf("proposal")).toMatch(/^PRO-\d{4}$/);
      expect(await numberOf("agreement")).toMatch(new RegExp(`^AGR-(${year}|${year + 1})-0001$`));
    });

    test("seeds the partnership.agreement approval as DEFAULTS declares it, and it validates", async () => {
      const row = await one("SELECT module_key, name, context_types, stages, active FROM workflow_definition WHERE key = 'partnership.agreement' AND version = 1");
      const def = definitions.DEFAULTS["partnership.agreement"];
      expect(row).toEqual({ module_key: def.module, name: def.name, context_types: def.context, stages: def.stages, active: true });
      expect(definitions.problemsOf(def)).toEqual([]);
    });

    test("seeds the code lists the service switches on, and switches 7099's business choices off", async () => {
      const codes = async (domain, active) =>
        (await q("SELECT code::text AS code FROM reference_value WHERE domain = $1 AND active = $2 ORDER BY display_order", [domain, active])).rows.map((r) => r.code);
      expect(await codes("deal_health", true)).toEqual(["on_track", "follow_up_required", "stalled"]);
      expect(await codes("interaction_type", true)).toEqual(["call", "meeting", "email", "visit", "note"]);
      expect(await codes("partner_type", true)).toEqual([]);
      expect(await codes("partnership_stage", true)).toEqual([]);
      expect((await codes("partnership_stage", false)).length).toBe(7);
    });

    test("gives each capability, named as the catalogue names it, to the roles §8 names", async () => {
      const held = (await q(
        `SELECT c.code::text AS code, c.name, c.description, array_agg(r.code::text ORDER BY r.code::text) AS roles
           FROM capability c JOIN role_capability rc USING (capability_id) JOIN role r USING (role_id)
          WHERE c.code::text LIKE 'partnerships.%' GROUP BY 1, 2, 3 ORDER BY 1`,
      )).rows;
      const declared = (code) => catalog.CAPABILITY_CATALOG.find((x) => x.code === code);
      expect(held).toEqual([
        { code: "partnerships.configure", name: declared("partnerships.configure").label, description: declared("partnerships.configure").description, roles: ["implementation", "operations_people"] },
        { code: "partnerships.money", name: declared("partnerships.money").label, description: declared("partnerships.money").description, roles: ["implementation", "management", "operations_people"] },
      ]);
      expect(catalog.GENERAL_MANAGEMENT_CAPABILITIES).toContain("partnerships.money");
    });

    test("undone, it takes back only what it gave, and keeps a capability someone gave since", async () => {
      await rolledBack(async (c) => {
        const studio = (await c.query(schema.sql.role, ["studio_lead"])).rows[0].role_id;
        await c.query("INSERT INTO role_capability (role_id, capability_id) SELECT $1, capability_id FROM capability WHERE code = 'partnerships.money'", [studio]);
        await c.query(SEED.down);
        const codes = (await c.query("SELECT code::text AS code FROM capability WHERE code::text LIKE 'partnerships.%' ORDER BY 1")).rows.map((r) => r.code);
        expect(codes).toEqual(["partnerships.money"]);
        const holders = (await c.query(
          "SELECT r.code::text AS code FROM role_capability rc JOIN role r USING (role_id) JOIN capability c USING (capability_id) WHERE c.code = 'partnerships.money'",
        )).rows.map((r) => r.code);
        expect(holders).toEqual(["studio_lead"]);
        expect((await c.query("SELECT count(*)::int AS n FROM workflow_definition WHERE key = 'partnership.agreement'")).rows[0].n).toBe(0);
        expect((await c.query("SELECT count(*)::int AS n FROM reference_value WHERE domain = 'partnership_stage' AND active")).rows[0].n).toBe(7);
        // Run again, it gives them back.
        await c.query(SEED.up);
        expect((await c.query("SELECT count(*)::int AS n FROM capability WHERE code::text LIKE 'partnerships.%'")).rows[0].n).toBe(2);
      });
    });
  });
});
