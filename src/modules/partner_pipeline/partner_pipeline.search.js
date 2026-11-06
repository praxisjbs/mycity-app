"use strict";
/**
 * ⌘K for partnership categories: found by name or description, for holders of `partnerships` view. A
 * category is MyCity's own list, not a record about a person, so no scope narrows it. A result opens
 * Partnerships · Categories on it (shared/route-map.js partner_category). Deals join with M7 PR 3.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "partner_category",
  module: "partnerships",
  label: "Categories",
  words: ["category", "categories", "partnership type", "partner type", "agreement template"],
  from: "partner_category c",
  key: "c.partner_category_id",
  columns: ["c.name", "c.description"],
  select:
    "c.partner_category_id AS id, c.name::text AS title, NULLIF(c.description, '') AS sub, CASE WHEN c.active THEN 'active' ELSE 'retired' END AS status",
  order: "c.display_order, c.name",
});
