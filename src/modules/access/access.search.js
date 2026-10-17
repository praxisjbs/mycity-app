"use strict";
/**
 * ⌘K: roles by name or code, for people who can open Settings. A result opens
 * Roles & Permissions on that role.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "role",
  module: "settings",
  label: "Roles",
  words: ["role", "permission", "access"],
  from: "role r",
  key: "r.role_id",
  columns: ["r.name", "r.code"],
  select: "r.role_id AS id, r.code::text AS ref, r.name AS title, r.description AS sub",
  where: "r.active",
});
