"use strict";
/**
 * Settings · Users: the logins and what can be done to them. Every write runs in
 * one transaction through the module that owns the data: identity for the login and
 * its sessions, access for the roles. Sessions this ends leave the fast index after
 * the transaction commits.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const access = require("../access/access.service");
const identity = require("../identity/identity.service");
const policy = require("../identity/identity.session-policy");
const invites = require("./users.invite");
const repo = require("./users.repo");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

async function rowOf(userId) {
  const row = await repo.getRow(pool, userId);
  if (!row) throw new AppError("NOT_FOUND", "Not found", 404);
  return row;
}

const list = (query) => repo.list(pool, query);

async function summary() {
  const counts = await repo.summary(pool, policy.idleSeconds());
  return { ...counts, by_role: await repo.byRole(pool) };
}

const candidates = (query) => repo.candidates(pool, query);

async function invite(body, actor) {
  const userId = await tx((client) => invites.invite(client, body, actor));
  return rowOf(userId);
}

async function resendInvite(userId, actor) {
  const email = await tx((client) => invites.resend(client, userId, actor));
  return { sent: true, email };
}

function refuseSelf(userId, actor, what) {
  if (actor && actor.user_id === userId)
    throw new AppError("NOT_ON_YOURSELF", `You cannot ${what} your own login here.`, 422);
}

async function setRoles(userId, codes, actor) {
  refuseSelf(userId, actor, "change the roles of");
  await tx(async (client) => {
    if (!(await identity.findUserById(client, userId)))
      throw new AppError("NOT_FOUND", "Not found", 404);
    await access.setRoles(client, userId, codes, actor);
  });
  return rowOf(userId);
}

async function suspend(userId, reason, actor) {
  refuseSelf(userId, actor, "suspend");
  const ended = await tx((client) => identity.suspendUser(client, userId, reason, actor));
  await identity.afterSessionsEnded(userId, ended);
  return rowOf(userId);
}

async function reactivate(userId, actor) {
  await tx((client) => identity.reactivateUser(client, userId, actor));
  await identity.afterSessionsEnded(userId, []);
  return rowOf(userId);
}

async function sendResetLink(userId, actor) {
  const email = await tx(async (client) => {
    const user = await identity.findUserById(client, userId);
    if (!user) throw new AppError("NOT_FOUND", "Not found", 404);
    if (user.status !== "active")
      throw new AppError("NOT_ACTIVE", "Reactivate this login before sending a link.", 422);
    await identity.requestLink(client, userId, user.password_changed_at ? "reset" : "invite", actor);
    return user.email;
  });
  return { sent: true, email };
}

async function endSessions(userId, actor) {
  const ended = await tx(async (client) => {
    if (!(await identity.findUserById(client, userId)))
      throw new AppError("NOT_FOUND", "Not found", 404);
    return identity.endAllSessions(client, userId, actor);
  });
  await identity.afterSessionsEnded(userId, ended);
  return { ended: ended.length };
}

module.exports = {
  list,
  summary,
  candidates,
  invite,
  resendInvite,
  setRoles,
  suspend,
  reactivate,
  sendResetLink,
  endSessions,
  get: rowOf,
};
