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

module.exports = { RoleOption, RoleListQuery, RolePage };
