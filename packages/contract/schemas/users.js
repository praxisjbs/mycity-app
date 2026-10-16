"use strict";
/**
 * Users: the logins, as Settings · Users manages them. A login always belongs to
 * an employee (no login without an employee), so a person gets one by being
 * invited from their employee record: they receive a link and choose their own
 * password. Nobody else ever sets or sees it.
 *
 * Status, derived rather than stored:
 *   invited     the login exists and no password has been chosen yet
 *   active      can sign in
 *   suspended   cannot sign in; every session ended
 *   left        the employee has left; cannot sign in
 */
const { z } = require("zod");
const { uuid, text, isoDateTime, listQuery, Paged } = require("./common");


const UserStatus = z.enum(["invited", "active", "suspended", "left"]);

/** A role code, as stored on `role.code`. */
const RoleCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{1,49}$/, "Pick a role");

const UserRole = z.object({ code: z.string(), name: z.string() }).strict();

/** One login, as the Users list shows it. */
const UserRow = z
  .object({
    user_id: uuid,
    employee_id: uuid,
    display_name: z.string(),
    email: z.string(),
    job_title: z.string(),
    department: z.string(),
    roles: z.array(UserRole),
    is_ceo: z.boolean(),
    status: UserStatus,
    last_seen_at: isoDateTime.nullable(),
    created_at: isoDateTime,
  })
  .strict();

/** GET /users */
const UserListQuery = listQuery(
  { status: UserStatus.optional(), role: RoleCode.optional() },
  ["display_name", "last_seen_at", "created_at"],
);
const UserPage = Paged(UserRow);

/** GET /users/summary: the counts above the list. */
const UsersSummary = z
  .object({
    users: z.number().int().min(0),
    active: z.number().int().min(0),
    invited: z.number().int().min(0),
    suspended: z.number().int().min(0),
    signed_in_now: z.number().int().min(0),
    by_role: z.array(
      z
        .object({ code: z.string(), name: z.string(), users: z.number().int().min(0) })
        .strict(),
    ),
  })
  .strict();

/** GET /users/candidates: employees who have no login yet, for the invite picker. */
const Candidate = z
  .object({
    employee_id: uuid,
    display_name: z.string(),
    email: z.string(),
    job_title: z.string(),
    department: z.string(),
  })
  .strict();
const CandidateListQuery = listQuery({}, ["display_name"]);
const CandidatePage = Paged(Candidate);

/** POST /users: give an employee a login and send them the link to choose a password. */
const UserInvite = z
  .object({ employee_id: uuid, role_codes: z.array(RoleCode).min(1).max(5) })
  .strict();

/** POST /users/:id/roles */
const UserRolesSet = z
  .object({ role_codes: z.array(RoleCode).min(1).max(5) })
  .strict();

/** POST /users/:id/suspend */
const UserSuspend = z.object({ reason: text(500).min(6, "At least 6 characters") }).strict();

/** POST /users/:id/invite (send the invitation again) and /users/:id/reset-link. */
const LinkSent = z.object({ sent: z.literal(true), email: z.string() }).strict();

/** POST /users/:id/end-sessions */
const UserSessionsEnded = z.object({ ended: z.number().int().min(0) }).strict();

module.exports = {
  UserStatus,
  RoleCode,
  UserRole,
  UserRow,
  UserListQuery,
  UserPage,
  UsersSummary,
  Candidate,
  CandidateListQuery,
  CandidatePage,
  UserInvite,
  UserRolesSet,
  UserSuspend,
  LinkSent,
  UserSessionsEnded,
};
