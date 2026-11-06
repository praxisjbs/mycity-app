"use strict";
/**
 * Interactions without a database (docs/guides/partnerships.md §5, §6.12): the two routes and their
 * permissions, and the contract's own rules for Log Interaction.
 */
const c = require("@mycity/contract");
const { routesOf } = require("../../http/route");
const routes = require("./interactions.routes");

test("listing needs view, logging needs create", () => {
  expect(routesOf(routes.router).map((r) => `${r.method.toUpperCase()} ${r.path} ${r.permission.action}`)).toEqual([
    "GET /interactions view",
    "POST /interactions create",
  ]);
});

test("Log Interaction names the lead or the partner, never both, with a summary of 10 characters", () => {
  const base = { interaction_type: "call", occurred_at: "2026-11-06T09:00:00.000Z", subject: "Kick-off", summary: "Agreed the dates." };
  const id = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
  expect(c.interactions.InteractionCreate.safeParse({ ...base, partner_id: id }).success).toBe(true);
  expect(c.interactions.InteractionCreate.safeParse(base).success).toBe(false);
  expect(c.interactions.InteractionCreate.safeParse({ ...base, partner_id: id, lead_id: id }).success).toBe(false);
  expect(c.interactions.InteractionCreate.safeParse({ ...base, partner_id: id, summary: "Short" }).success).toBe(false);
});
