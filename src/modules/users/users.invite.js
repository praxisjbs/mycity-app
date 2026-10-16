"use strict";
/**
 * Inviting a person: their employee record gets a login, their roles, and a link
 * to choose their own password (valid 72 hours, one use). Nobody else ever sets
 * or sees that password. Sending the invitation again replaces the link: the
 * earlier one stops working.
 *
 * A login is always an employee's (no login without an employee); the email it
 * signs in with is the one People hold for that employee.
 */
const { AppError } = require("../../shared/errors");
const access = require("../access/access.service");
const identity = require("../identity/identity.service");
const organisation = require("../organisation/organisation.service");

/**
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{employee_id: string, role_codes: string[]}} body
 * @param {object} actor
 * @returns {Promise<string>} the new login's user_id
 */
async function invite(client, { employee_id, role_codes }, actor) {
  const employee = await organisation.findEmployeeById(client, employee_id);
  if (!employee || employee.status !== "active")
    throw new AppError("NOT_FOUND", "That employee is not on the active staff list.", 404, {
      employee_id: ["Not an active employee"],
    });
  if (!employee.work_email)
    throw new AppError("NO_EMAIL", "Add the employee's email before inviting them.", 422, {
      employee_id: ["No email on record"],
    });
  const user = await identity.createUserForEmployee(
    client,
    { employee_id, email: employee.work_email },
    actor,
  );
  await access.setRoles(client, user.user_id, role_codes, actor);
  await identity.requestLink(client, user.user_id, "invite", actor);
  return user.user_id;
}

/**
 * Send the invitation again: only for a login whose password was never chosen.
 * @returns {Promise<string>} the email it goes to
 */
async function resend(client, userId, actor) {
  const user = await identity.findUserById(client, userId);
  if (!user) throw new AppError("NOT_FOUND", "Not found", 404);
  if (user.password_changed_at)
    throw new AppError("ALREADY_ACTIVE", "This person has already chosen a password.", 422);
  if (user.status !== "active")
    throw new AppError("NOT_ACTIVE", "Reactivate this login before inviting again.", 422);
  await identity.requestLink(client, userId, "invite", actor);
  return user.email;
}

module.exports = { invite, resend };
