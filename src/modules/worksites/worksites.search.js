"use strict";
/**
 * ⌘K for worksites: found by name or code, for holders of `people` view. A worksite
 * is a place, not a record about a person, so no scope narrows it. A result opens
 * People · Worksites on it (shared/route-map.js worksite).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "worksite",
  module: "people",
  label: "Worksites",
  words: ["worksite", "worksites", "office", "site"],
  from: "worksite w",
  key: "w.worksite_id",
  columns: ["w.name", "w.code"],
  select:
    "w.worksite_id AS id, w.code::text AS ref, w.name AS title, NULLIF(w.address ->> 'text', '') AS sub, CASE WHEN w.active THEN 'active' ELSE 'retired' END AS status",
  order: "w.name",
});
