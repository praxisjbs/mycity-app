"use strict";
/**
 * The people a video is filmed as (docs/runbooks/training-videos.md §4.2): MyCity's own staff, as
 * the roster loader put them on a local rehearsal database, and the Implementation Team's account.
 *
 * The loader leaves each login invited, with no password. Before filming, each person the video
 * signs in as is given the filming password the way a person accepting an invitation is: a link is
 * opened for them and `identity.resetPassword` spends it (the service sets the password, ends their
 * sessions and records it). No mail is sent. Refused anywhere but a development database, so it
 * can never touch staging or production.
 */
const crypto = require("node:crypto");

function guard(config) {
  if (config.APP_ENV !== "development" || /mycity_(stg|prod)\b/.test(config.DB_NAME || ""))
    throw new Error(`Filming signs people in on a development database only (APP_ENV ${config.APP_ENV}, ${config.DB_NAME}).`);
}

/** Make sure each email in `emails` can sign in with `password`; returns {email: name}. */
async function ready(emails, password) {
  const { config } = require("../../src/config/env");
  guard(config);
  const { pool } = require("../../src/config/db");
  const identity = require("../../src/modules/identity/identity.service");
  const repo = require("../../src/modules/identity/identity.repo");
  const cookies = require("../../src/modules/identity/identity.cookies");
  const names = {};
  for (const email of emails) {
    const { rows } = await pool.query(
      `SELECT u.user_id, u.status, u.password_hash, e.first_name, e.last_name FROM app_user u
         JOIN employee e ON e.employee_id = u.employee_id WHERE lower(u.email::text) = lower($1)`,
      [email],
    );
    if (!rows[0]) throw new Error(`No login for ${email}: run load-staff and the staging seed first (runbook §4.1).`);
    names[email] = `${rows[0].first_name} ${rows[0].last_name}`;
    // The password is checked against its hash, never by signing in: a sign-in from a new device tells
    // the person "New sign-in to your account", which a shot of their bell would then show.
    const hash = rows[0].password_hash;
    const ok = typeof hash === "string" && hash.startsWith("$argon2") && (await require("argon2").verify(hash, password).catch(() => false));
    if (ok) continue;
    const token = crypto.randomBytes(32).toString("base64url");
    await repo.upsertLink(pool, {
      userId: rows[0].user_id, hash: cookies.hashToken(token), purpose: "invite", seconds: 600,
      requestedBy: null, ip: null, eventId: crypto.randomUUID(),
    });
    await identity.resetPassword({ token, new_password: password, ip: "127.0.0.1" });
  }
  for (const email of emails) await caughtUp(pool, email);
  return names;
}

/**
 * Read every notice already waiting for this person, as they would before a demonstration: the
 * roster load leaves urgent "Access change" notices that would sit red across every shot. Through
 * the notifications service; notices raised while filming arrive as normal.
 */
async function caughtUp(pool, email) {
  const grants = require("../../src/shared/rbac/grants-cache");
  const notifications = require("../../src/modules/notifications/notifications.service");
  const { rows } = await pool.query("SELECT user_id FROM app_user WHERE lower(email::text) = lower($1)", [email]);
  const user = { ...(await grants.getAuthUser(pool, rows[0].user_id)), ip: null };
  const { rows: waiting } = await pool.query(
    `SELECT notification_id FROM notification WHERE user_id = $1 AND acknowledge_required AND acknowledged_at IS NULL`,
    [user.user_id],
  );
  for (const n of waiting) await notifications.acknowledge(user, n.notification_id);
  await notifications.markAllRead(user);
}

/** Find people by their post (seeds/staging/lib/staff.js), so a video never hard-codes a name. */
async function posts() {
  const { pool } = require("../../src/config/db");
  const { realStaff } = require("../../seeds/staging/lib/staff");
  return realStaff(pool);
}

module.exports = { ready, posts, guard };
