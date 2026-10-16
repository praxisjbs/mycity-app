"use strict";
/**
 * Access: roles and what they grant (module → action → record scope → field).
 *
 * First cut: the role list the Users screen picks from. Editing a role's grants
 * (Settings · Roles & Permissions) joins this file in M9.
 */
const { z } = require("zod");
const { uuid, listQuery, Paged } = require("./common");

/** One role, as a picker or a list shows it. */
const RoleOption = z
  .object({
    role_id: uuid,
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    users: z.number().int().min(0),
  })
  .strict();

/** GET /access/roles: active roles, most senior first. */
const RoleListQuery = listQuery({}, ["rank", "name"]);
const RolePage = Paged(RoleOption);

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  RoleOption: { table: "role", virtual: { users: "how many active logins hold the role, counted from user_role" } },
  RoleListQuery: { table: null, reason: "list controls for the roles picker" },
  RolePage: { table: null, reason: "a page of roles" },
};

module.exports = { TABLES, RoleOption, RoleListQuery, RolePage };
