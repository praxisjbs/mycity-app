"use strict";
/**
 * What the assistant may read about roles, for people who can open Settings: the
 * roles with their counts, and one role's grants. It never changes a role (A23); it
 * sends the person to Roles & Permissions.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const catalog = require("../../shared/access/access.catalog");
const repo = require("./access.repo");
const service = require("./access.service");

module.exports = defineManifest({
  module: "settings",
  reads: [
    {
      key: "roles.list",
      description: "List the roles, with how many people hold each and the modules each opens",
      params: c.access.RoleRowListQuery,
      permission: ["settings", "view"],
      run: (client, params) => repo.roleRowPage(client, params, [...catalog.OWN_ONLY]),
      cite: (row) => ({ type: "role", id: row.role_id, label: row.name }),
    },
    {
      key: "roles.get",
      description: "One role: what it grants on each module, the fields it sees and its capabilities",
      params: c.common.IdParams,
      permission: ["settings", "view"],
      run: (client, params) =>
        service.roleDetail(params.id, client).catch((err) => {
          if (err && err.status === 404) return null;
          throw err;
        }),
      cite: (row) => ({ type: "role", id: row.role_id, label: row.name }),
    },
  ],
  routes: [
    { intent: "create a role", screen: "settings.roles-and-permissions", params: { new: "1" } },
    { intent: "change what a role can do", screen: "settings.roles-and-permissions" },
  ],
});
