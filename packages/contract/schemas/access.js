"use strict";
/**
 * Access: roles and what they grant, in four layers (MILESTONES §14):
 *
 *   module  →  action (view create edit delete approve export)  →  record scope (all team own)  →  field
 *
 * plus capabilities, authorities a role holds beside its grants (posting an
 * announcement, clearing an alert). There is no entity layer: one company (A2).
 *
 * Settings · Roles & Permissions creates, edits and deletes roles here. A change to
 * what a role grants, masks or holds is a security event: the grants cache is
 * cleared, so the next request sees it, and the access watchers are told.
 */
const { z } = require("zod");
const { uuid, text, listQuery, Paged } = require("./common");
const { ModuleKey, Action, HomeView } = require("./identity");

const RecordScope = z.enum(["all", "team", "own"]);

/**
 * The restricted field groups a role may see or have masked
 * (src/shared/rbac/field-mask.js FIELDS; a test holds the two lists equal).
 */
const FIELD_KEYS = ["employee.salary", "employee.bank", "employee.personal", "employee.statutory"];
const FieldKey = z.enum(FIELD_KEYS);

/** A capability's code, as stored on `capability.code` ("announcements.post"). */
const CapabilityCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z_]*\.[a-z][a-z_]*$/, "Not a capability");

/** The Home a role opens. The CEO's Home is the flag's, never a role's. */
const RoleHomeView = HomeView.exclude(["ceo"]);

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

/* ------------------------------------------------------------------ *
 * Settings · Roles & Permissions
 * ------------------------------------------------------------------ */

/** One module's grant inside a role: the actions it allows and over which records. */
const RoleGrant = z
  .object({
    module_key: ModuleKey,
    scope: RecordScope,
    actions: z.array(Action).max(6),
  })
  .strict();

/** A role as the Roles list shows it. */
const RoleRow = z
  .object({
    role_id: uuid,
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    is_system: z.boolean(),
    two_step_required: z.boolean(),
    users: z.number().int().min(0),
    /** Modules the role may open (grants with view). */
    modules: z.number().int().min(0),
    /** The record scope most of its grants use (the wider on a tie), or none when it opens nothing. */
    scope: z.enum(["all", "team", "own", "none"]),
    /** The restricted field groups it sees unmasked, of all there are. */
    fields_visible: z.number().int().min(0),
  })
  .strict();

/** GET /settings/roles */
const RoleRowListQuery = listQuery({}, ["rank", "name"]);
const RoleRowPage = Paged(RoleRow);

/** GET /settings/roles/:id: everything the role grants, masks and holds. */
const RoleDetail = z
  .object({
    role_id: uuid,
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    home_view: HomeView.nullable(),
    rank: z.number().int(),
    is_system: z.boolean(),
    two_step_required: z.boolean(),
    users: z.number().int().min(0),
    grants: z.array(RoleGrant),
    /** The field groups this role sees; every other group is masked. */
    visible_fields: z.array(FieldKey),
    capabilities: z.array(z.string()),
  })
  .strict();

/**
 * POST /settings/roles and PUT /settings/roles/:id: the whole role. A module left
 * out, or given no actions, is not granted. Any action needs view.
 */
const RoleSave = z
  .object({
    name: text(40).min(2, "At least 2 characters"),
    description: z.string().trim().max(200).nullable().optional(),
    home_view: RoleHomeView.optional(),
    grants: z.array(RoleGrant).max(30),
    visible_fields: z.array(FieldKey).max(FIELD_KEYS.length),
    capabilities: z.array(CapabilityCode).max(50),
  })
  .strict();

/** GET /settings/roles/catalogue: what a role can be given. */
const AccessCatalogue = z
  .object({
    modules: z.array(
      z
        .object({
          key: ModuleKey,
          label: z.string(),
          area: z.string(),
          description: z.string(),
          /** Always own records, whatever a grant says (Self-Service). */
          own_only: z.boolean(),
        })
        .strict(),
    ),
    actions: z.array(Action),
    scopes: z.array(RecordScope),
    fields: z.array(z.object({ key: FieldKey, label: z.string() }).strict()),
    capabilities: z.array(
      z
        .object({ code: z.string(), name: z.string(), description: z.string().nullable() })
        .strict(),
    ),
  })
  .strict();

/** GET /settings/roles/matrix: every active role against every module. */
const RoleMatrix = z
  .object({
    roles: z.array(
      z.object({ role_id: uuid, code: z.string(), name: z.string(), is_system: z.boolean() }).strict(),
    ),
    rows: z.array(
      z
        .object({
          module_key: ModuleKey,
          label: z.string(),
          /** One cell per role, in the order of `roles`. */
          cells: z.array(
            z.object({ role_id: uuid, actions: z.array(Action), scope: RecordScope.nullable() }).strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  RoleOption: { table: "role", virtual: { users: "how many active logins hold the role, counted from user_role" } },
  RoleListQuery: { table: null, reason: "list controls for the roles picker" },
  RolePage: { table: null, reason: "a page of roles" },
  RoleGrant: {
    table: "permission",
    virtual: { actions: "the can_view to can_export columns, as the list of actions that are true" },
  },
  RoleRow: {
    table: "role",
    virtual: {
      users: "how many active logins hold the role, counted from user_role",
      modules: "how many of its permission rows allow view",
      scope: "the scope most of its permission rows that allow view use",
      fields_visible: "how many field_visibility rows of the role are visible",
    },
  },
  RoleRowListQuery: { table: null, reason: "list controls for Settings, Roles & Permissions" },
  RoleRowPage: { table: null, reason: "a page of roles with their counts" },
  RoleDetail: {
    table: "role",
    virtual: {
      users: "how many active logins hold the role, counted from user_role",
      grants: "the role's permission rows",
      visible_fields: "the field keys of its visible field_visibility rows",
      capabilities: "the codes of its role_capability rows",
    },
  },
  RoleSave: {
    table: "role",
    virtual: {
      grants: "written as the role's permission rows",
      visible_fields: "written as one field_visibility row per field key, visible or masked",
      capabilities: "written as the role's role_capability rows",
    },
  },
  AccessCatalogue: { table: null, reason: "the access catalogue in code, the field groups and the capability table" },
  RoleMatrix: { table: null, reason: "every active role against every module, from role and permission" },
};

module.exports = {
  TABLES,
  RecordScope,
  FIELD_KEYS,
  FieldKey,
  CapabilityCode,
  RoleHomeView,
  RoleOption,
  RoleListQuery,
  RolePage,
  RoleGrant,
  RoleRow,
  RoleRowListQuery,
  RoleRowPage,
  RoleDetail,
  RoleSave,
  AccessCatalogue,
  RoleMatrix,
};
