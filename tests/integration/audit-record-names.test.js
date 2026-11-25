"use strict";
/**
 * Settings · Audit Log names each record a person would recognise (docs/guides/foundation.md §8):
 * a partner, a lead, a deal and a proposal whose entry recorded only the field that changed (a
 * status, a deal's health) are named from their own rows, never by the id's first characters. The
 * records are invented.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/audit-record-names
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema.
 */
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { emit } = require("../../src/shared/events/emit");
const { rebuild, sql } = require("./helpers/schema");
const repo = require("../../src/modules/audit/audit.repo");

// The event modules declare the keys emitted below.
require("../../src/modules/partners/partners.events");
require("../../src/modules/leads/leads.events");
require("../../src/modules/partner_pipeline/partner_pipeline.events");
require("../../src/modules/proposals/proposals.events");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const one = async (text, params) => (await pool.query(text, params)).rows[0];

/** Each change recorded as a service records it: in a transaction of its own. */
async function recorded(write) {
  const client = await pool.connect();
  try {
    await atomically(client, () => write(client));
  } finally {
    client.release();
  }
}

describeDb("Audit Log record names", () => {
  const ids = {};

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    const { employee_id: author } = await one(sql.employee, ["Ada", "Obi", null]);
    ({ user_id: ids.author } = await one(sql.user, [author, "ada.obi@mycity.test", false]));
    ({ partner_id: ids.partner } = await one("INSERT INTO partner (number, name) VALUES ('PTN-0001', 'Harbour Lights') RETURNING partner_id"));
    ({ lead_id: ids.lead } = await one("INSERT INTO lead (number, name) VALUES ('LED-0001', 'Lekki Food Fair') RETURNING lead_id"));
    ({ partnership_opportunity_id: ids.deal } = await one(
      `INSERT INTO partnership_opportunity (number, title, stage, partner_id)
       VALUES ('DEAL-0007', 'Festival Sponsorship', 'lead', $1) RETURNING partnership_opportunity_id`,
      [ids.partner],
    ));
    ({ partnership_proposal_id: ids.proposal } = await one(
      `INSERT INTO partnership_proposal (partnership_opportunity_id, number, created_by)
       VALUES ($1, 'PRP-0003', $2) RETURNING partnership_proposal_id`,
      [ids.deal, ids.author],
    ));
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  test("a partner, a lead, a deal and a proposal are named from their own rows when the entry carries only a status", async () => {
    await recorded(async (client) => {
      await emit(client, { key: "partner.status_changed", entity: { type: "partner", id: ids.partner }, actor: null, before: { status: "active" }, after: { status: "dormant" } });
      await emit(client, { key: "lead.updated", entity: { type: "lead", id: ids.lead }, actor: null, before: { status: "open" }, after: { status: "qualified" } });
      await emit(client, { key: "deal.health_changed", entity: { type: "partner_deal", id: ids.deal }, actor: null, before: { health: "on_track" }, after: { health: "overdue" } });
      await emit(client, { key: "proposal.declined", entity: { type: "partnership_proposal", id: ids.proposal }, actor: null, before: { status: "sent" }, after: { status: "declined" } });
    });

    const { data } = await repo.page(pool, { page: 1 });
    const named = Object.fromEntries(data.map((e) => [e.entity_type, e.record_name]));
    expect(named.partner).toBe("Harbour Lights");
    expect(named.lead).toBe("Lekki Food Fair");
    expect(named.partner_deal).toBe("DEAL-0007 Festival Sponsorship");
    expect(named.partnership_proposal).toBe("PRP-0003");
  });

  test("a record that is gone falls back to the name its own entry recorded", async () => {
    const gone = "00000000-0000-4000-8000-000000000001";
    await recorded(async (client) => {
      await emit(client, { key: "partner.status_changed", entity: { type: "partner", id: gone }, actor: null, before: { status: "active" }, after: { status: "dormant", name: "Old Partner" } });
    });
    const { data } = await repo.page(pool, { page: 1, entity_id: gone });
    expect(data.map((e) => e.record_name)).toEqual(["Old Partner"]);
  });
});
