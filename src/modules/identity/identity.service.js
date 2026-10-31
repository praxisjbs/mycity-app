"use strict";
/**
 * Identity: who may sign in, how a session starts, lives and ends, and the
 * credential links (docs/guides/identity.md).
 *
 * Sessions (identity.session-policy.js): a fixed ceiling from sign-in, an idle
 * limit, every token capped at its session's end. The refresh token rotates on
 * every use; presenting one that has already been rotated away is treated as theft
 * and ends the whole session.
 *
 * Wrong passwords slow the account down (identity.throttle.js) and never lock it.
 * The same answer is given for an unknown email and a wrong password, and both take
 * the time of one Argon2 check, so neither the message nor the clock says which
 * emails have an account.
 *
 * Two-step sign-in, the PIN and passkeys (the security module, security.signin.js):
 * the password or the PIN is the first step; when two-step is on and this browser
 * has not proved a code within the person's chosen time, the answer is a ticket for
 * the code step instead of a session. A passkey is both steps at once. A wrong code
 * counts like a wrong password. When two-step is off and a role the person holds
 * requires it (Settings · Security), the answer is the set-up step instead: the
 * session opens only once the app's first code proves the new key. Whatever a step spends (the ticket, the code, a
 * recovery code, the passkey's counter) is spent in the transaction that opens the
 * session, so a replay opens nothing.
 *
 * Writes run in one transaction with emit(); what follows (the link emails, the
 * notifications) runs in the worker after commit. Argon2 runs outside the
 * transaction: it is slow on purpose, and a connection must not wait on it.
 */
const crypto = require("node:crypto");
const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const catalog = require("../../shared/access/access.catalog");
const grantsCache = require("../../shared/rbac/grants-cache");
const fieldMask = require("../../shared/rbac/field-mask");
const sessions = require("../../shared/rbac/sessions");
const policy = require("./identity.session-policy");
const passwordPolicy = require("./identity.password-policy");
const throttle = require("./identity.throttle");
const cookies = require("./identity.cookies");
const { deviceLabel, platformOf } = require("./identity.device-label");
const repo = require("./identity.repo");
// The path only; the photo itself is the organisation module's (organisation.photo.js).
const { photoUrl } = require("../organisation/organisation.photo");
const { EVENTS } = require("./identity.events");
const waysIn = require("../security/security.signin");
const access = require("../access/access.service");

const ARGON = Object.freeze({ type: argon2.argon2id });
const RESET_LINK_MINUTES = 30;
const INVITE_LINK_HOURS = 72;
/** A second reset link for one account within this long is not sent. */
const RESET_REPEAT_SECONDS = 120;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A person's own login, as an event entity (links to My Security). */
const account = (userId) => ({ type: "account", id: userId });

/** The ledger's actor for a person acting on their own account. */
const actorOf = (user, ip) => ({
  user_id: user.user_id,
  display_name: user.display_name,
  email: user.email,
  ip: ip || null,
});

let dummyHash = null;
/** A real Argon2 hash nobody knows the password of, for the no-such-account path. */
async function dummy() {
  if (!dummyHash)
    dummyHash = await argon2.hash(crypto.randomBytes(32).toString("hex"), ARGON);
  return dummyHash;
}

/** Does `password` match `hash`? Never throws: a malformed hash (an invited login) is no match. */
async function verifyPassword(hash, password) {
  const target = hash && hash.startsWith("$argon2") ? hash : await dummy();
  const ok = await argon2.verify(target, String(password || "")).catch(() => false);
  return Boolean(ok) && target !== dummyHash;
}

const hashPassword = (password) => argon2.hash(String(password), ARGON);

function signAccess({ userId, sessionId, seconds }) {
  return jwt.sign(
    { sub: userId, sid: sessionId, typ: "access" },
    config.JWT_ACCESS_SECRET,
    { algorithm: "HS256", expiresIn: seconds, jwtid: crypto.randomUUID() },
  );
}

function signRefresh({ userId, sessionId, jti, seconds }) {
  return jwt.sign(
    { sub: userId, sid: sessionId, typ: "refresh" },
    config.JWT_REFRESH_SECRET,
    { algorithm: "HS256", expiresIn: seconds, jwtid: jti },
  );
}

/** The refresh token's claims, or null for anything that is not a live refresh token. */
function readRefreshToken(token) {
  if (!token) return null;
  try {
    const p = jwt.verify(token, config.JWT_REFRESH_SECRET, { algorithms: ["HS256"] });
    return p && p.typ === "refresh" && p.sid && p.sub && p.jti ? p : null;
  } catch {
    return null;
  }
}

/** Drop ended sessions from the fast index and the cached identity, after commit. */
async function forget(userId, sessionIds) {
  await Promise.allSettled(sessionIds.map((sid) => sessions.removeSession(sid, userId)));
  await grantsCache.invalidateUser(userId);
}

/* ------------------------------------------------------------------ *
 * The signed-in person
 * ------------------------------------------------------------------ */

/**
 * GET /auth/me: who the person is, what they may open, and which Home they see.
 * The CEO holds every action; anyone else holds what their roles add up to.
 * @param {{query: Function}} db
 * @param {string} userId
 */
async function me(db, userId) {
  const row = await repo.meOf(db, userId);
  if (!row || row.status !== "active")
    throw new AppError("AUTH_REQUIRED", "Sign in to continue", 401);
  const roles = await repo.rolesOf(db, userId);
  const grants = {};
  if (row.is_ceo === true) {
    for (const m of catalog.MODULES) grants[m] = [...catalog.ACTIONS];
  } else {
    for (const g of await repo.grantsOf(db, roles.map((r) => r.role_id))) {
      if (!catalog.isModule(g.module_key)) continue;
      const actions = catalog.ACTIONS.filter((a) => g[`can_${a}`] === true);
      if (actions.length) grants[g.module_key] = actions;
    }
  }
  const view = row.is_ceo
    ? "ceo"
    : (roles.find((r) => r.home_view) || { home_view: "staff" }).home_view;
  // The same codes requireCapability reads, so the shell shows what the API allows;
  // the CEO passes every capability check and so holds every code there is.
  const capabilities =
    row.is_ceo === true
      ? await repo.allCapabilityCodes(db)
      : await grantsCache.getCapabilities(db, userId);
  return {
    user_id: row.user_id,
    employee_id: row.employee_id,
    email: row.email,
    display_name: row.display_name,
    first_name: row.first_name,
    job_title: row.job_title,
    department: row.department,
    photo_url: photoUrl(row.photo_document_id),
    is_ceo: row.is_ceo === true,
    grants,
    capabilities,
    roles: roles.map((r) => ({ code: r.code, name: r.name })),
    home_view: view,
    manages_people: row.manages_people === true,
    // Required here, not at the top: settings.appearance reads security, which reads this file.
    appearance: await require("../settings/settings.appearance").applied(db),
    hidden_fields: await fieldMask.hiddenFieldsFor(db, { user_id: row.user_id, is_ceo: row.is_ceo === true }),
  };
}

/* ------------------------------------------------------------------ *
 * Signing in
 * ------------------------------------------------------------------ */

async function failedSignIn(user, { email, ip, reason }) {
  await tx(async (client) => {
    if (!user) {
      await emit(client, {
        key: EVENTS.AUTH_SIGN_IN_FAILED,
        entity: { type: "app_user", id: "unknown" },
        actor: { user_id: null, ip },
        payload: { reason, email },
      });
      return;
    }
    // A wrong code after the right password counts too: whoever typed it has the password.
    const counted = reason === "bad_password" || reason === "bad_code";
    const count = counted
      ? await repo.recordFailure(client, user.user_id)
      : user.failed_login_count;
    await emit(client, {
      key: EVENTS.AUTH_SIGN_IN_FAILED,
      entity: account(user.user_id),
      actor: { user_id: null, ip },
      payload: { reason, failed_count: count },
    });
    if (counted && count === throttle.FIRST_THROTTLED) {
      await emit(client, {
        key: EVENTS.AUTH_SIGN_IN_THROTTLED,
        entity: account(user.user_id),
        actor: { user_id: null, ip },
        payload: { failed_count: count, reason },
      });
    }
  });
}

/**
 * Open a session for a person whose credentials have already been checked.
 *
 * `trustDays`: the browser just proved a two-step code and may skip the next ones
 * for this long (0: it may not). `within(client)` runs in the same transaction,
 * after the session row: it spends what the sign-in used (a ticket, a code, a
 * passkey's counter), and when it throws nothing is opened.
 * @returns {Promise<{body: object, refresh: {token: string, seconds: number}, device: string}>}
 */
async function startSession(user, { ip, userAgent, deviceToken, method, trustDays = 0, within = null }) {
  const label = deviceLabel(userAgent);
  const token = deviceToken || cookies.newDeviceToken();
  await policy.load(pool);
  const remaining = policy.maxAgeSeconds();
  const sessionId = crypto.randomUUID();
  const jti = crypto.randomUUID();

  const person = await tx(async (client) => {
    const knownBefore = await repo.hasDevices(client, user.user_id);
    const known = await repo.rememberDevice(client, {
      userId: user.user_id,
      hash: cookies.hashToken(token),
      label,
      platform: platformOf(userAgent),
      ip,
    });
    if (trustDays > 0) await repo.trustDevice(client, known.known_device_id, trustDays);
    await repo.recordSuccess(client, user.user_id);
    await repo.insertSession(client, {
      sessionId,
      userId: user.user_id,
      refreshHash: cookies.hashToken(jti),
      ip,
      userAgent,
      deviceLabel: label,
      knownDeviceId: known.known_device_id,
      method,
      seconds: remaining,
    });
    if (within) await within(client);
    await emit(client, {
      key: EVENTS.AUTH_SIGNED_IN,
      entity: account(user.user_id),
      actor: actorOf(user, ip),
      payload: {
        session_id: sessionId,
        method,
        device_label: label,
        ip_address: ip || null,
        new_device: known.is_new === true,
        known_before: knownBefore,
      },
    });
    return me(client, user.user_id);
  });

  await sessions.indexSession(sessionId, {
    userId: user.user_id,
    expiresAt: new Date(Date.now() + remaining * 1000),
  });
  await grantsCache.invalidateUser(user.user_id);

  return {
    body: {
      access_token: signAccess({
        userId: user.user_id,
        sessionId,
        seconds: policy.accessTtlFor(remaining),
      }),
      ...policy.clock(remaining),
      user: person,
    },
    refresh: {
      token: signRefresh({
        userId: user.user_id,
        sessionId,
        jti,
        seconds: policy.refreshTtlFor(remaining),
      }),
      seconds: remaining,
    },
    device: token,
  };
}

/**
 * POST /auth/login.
 * @param {{email: string, password: string, ip?: string, userAgent?: string, deviceToken?: string|null}} input
 */
async function login({ email, password, ip, userAgent, deviceToken }) {
  const user = await repo.findLoginByEmail(pool, email);

  // Before Argon2: an account being guessed at must not also cost the server a hash per guess.
  if (user) {
    const wait = throttle.waitSeconds(user);
    if (wait > 0) {
      await failedSignIn(user, { email, ip, reason: "throttled" });
      throw new AppError(
        "LOGIN_THROTTLED",
        `Too many attempts. Try again in ${throttle.sayWait(wait)}.`,
        429,
      );
    }
  }

  const ok = await verifyPassword(user ? user.password_hash : null, password);
  if (!user || !ok) {
    await failedSignIn(user, {
      email,
      ip,
      reason: user ? "bad_password" : "no_such_account",
    });
    throw new AppError(
      "INVALID_CREDENTIALS",
      "That email and password do not match.",
      401,
    );
  }

  // Only after the right password: a stranger cannot learn an account is suspended.
  await refuseInactive(user, { email, ip });

  return afterFirstStep(user, { via: "password", ip, userAgent, deviceToken });
}

/** A login that cannot sign in, told so only once a first step has passed. */
async function refuseInactive(user, { email, ip }) {
  if (user.status === "active") return;
  await failedSignIn(user, { email, ip, reason: `status_${user.status}` });
  throw new AppError(
    "ACCOUNT_SUSPENDED",
    user.status === "left"
      ? "This account is closed."
      : "This account is suspended. Contact People.",
    403,
  );
}

/**
 * The password or the PIN was right. With two-step on, a browser that has not
 * proved a code within the person's chosen time gets the code step; otherwise the
 * session opens.
 * @param {{via: "password"|"pin", ip?: string, userAgent?: string, deviceToken?: string|null, within?: Function}} ctx
 */
async function afterFirstStep(user, ctx) {
  const two = await waysIn.twoStepOf(pool, user.user_id);
  if (!two.on && (await access.requiresTwoStep(pool, user.user_id)))
    return { body: waysIn.setupRequired(user.user_id, ctx.via) };
  if (two.on) {
    const trusted =
      two.trustDays > 0 && ctx.deviceToken
        ? await repo.deviceTrusted(pool, user.user_id, cookies.hashToken(ctx.deviceToken))
        : false;
    if (!trusted) return { body: waysIn.codeRequired(user.user_id, ctx.via) };
  }
  return startSession(user, { ...ctx, method: ctx.via });
}

/**
 * POST /auth/two-step: the code after the password or the PIN, from the
 * authenticator app or a recovery code. Throttled with the password: a wrong code
 * here means someone has the password.
 */
async function twoStep({ challenge_token, code, ip, userAgent, deviceToken }) {
  const claims = waysIn.readCodeTicket(challenge_token);
  const user = await repo.findLoginById(pool, claims.sub);
  if (!user || user.status !== "active")
    throw new AppError("CHALLENGE_EXPIRED", "This request has expired. Start again.", 400);
  const wait = throttle.waitSeconds(user);
  if (wait > 0) {
    await failedSignIn(user, { email: user.email, ip, reason: "throttled" });
    throw new AppError("LOGIN_THROTTLED", `Too many attempts. Try again in ${throttle.sayWait(wait)}.`, 429);
  }
  const second = await waysIn.checkSecondStep(user.user_id, code);
  if (!second) {
    await failedSignIn(user, { email: user.email, ip, reason: "bad_code" });
    throw waysIn.codeRefused();
  }
  const two = await waysIn.twoStepOf(pool, user.user_id);
  return startSession(user, {
    ip,
    userAgent,
    deviceToken,
    method: `${claims.via}_totp`,
    trustDays: two.trustDays,
    within: async (client) => {
      await waysIn.spendSecondStep(client, user.user_id, second, claims, actorOf(user, ip));
      if (claims.via === "pin") await waysIn.pinUsed(client, user.user_id);
    },
  });
}

/** The person a set-up ticket names, refused when they can no longer sign in. */
async function setupHolder(challenge_token) {
  const claims = waysIn.readSetupTicket(challenge_token);
  const user = await repo.findLoginById(pool, claims.sub);
  if (!user || user.status !== "active")
    throw new AppError("CHALLENGE_EXPIRED", "This request has expired. Start again.", 400);
  return { claims, user };
}

/**
 * POST /auth/two-step/setup: the set-up step's key, for a person whose role requires
 * two-step and who has not set it up. The ticket is the proof of the first step.
 */
async function twoStepSetup({ challenge_token }) {
  const { claims } = await setupHolder(challenge_token);
  return waysIn.startSetup(claims);
}

/**
 * POST /auth/two-step/enrol: the app's first code proves the new key. Two-step goes on,
 * the session opens, and the ten recovery codes are shown this once. A wrong code
 * counts like a wrong password: whoever types it has the password.
 */
async function enrolTwoStep({ challenge_token, code, ip, userAgent, deviceToken }) {
  const { claims, user } = await setupHolder(challenge_token);
  const wait = throttle.waitSeconds(user);
  if (wait > 0) {
    await failedSignIn(user, { email: user.email, ip, reason: "throttled" });
    throw new AppError("LOGIN_THROTTLED", `Too many attempts. Try again in ${throttle.sayWait(wait)}.`, 429);
  }
  const proof = await waysIn.checkSetupCode(user.user_id, code);
  if (!proof) {
    await failedSignIn(user, { email: user.email, ip, reason: "bad_code" });
    throw waysIn.codeRefused();
  }
  const { codes, hashes } = await waysIn.newRecoveryCodes();
  const two = await waysIn.twoStepOf(pool, user.user_id);
  const out = await startSession(user, {
    ip,
    userAgent,
    deviceToken,
    method: `${claims.via}_totp`,
    trustDays: two.trustDays,
    within: async (client) => {
      await waysIn.enrolOnSignIn(client, user.user_id, proof, hashes, claims, actorOf(user, ip));
      if (claims.via === "pin") await waysIn.pinUsed(client, user.user_id);
    },
  });
  return { ...out, body: { ...out.body, recovery_codes: codes } };
}

/**
 * POST /auth/pin: the PIN in place of the password, only on a browser this person
 * has signed in on before. An unknown email, no PIN and a browser that is not theirs
 * all get the same answer.
 */
async function pinSignIn({ email, pin, ip, userAgent, deviceToken }) {
  const unavailable = () =>
    new AppError("PIN_UNAVAILABLE", "Use your password to sign in on this device.", 401);
  const user = await repo.findLoginByEmail(pool, email);
  if (!user || !deviceToken) throw unavailable();
  if (!(await repo.knownDeviceOf(pool, user.user_id, cookies.hashToken(deviceToken)))) throw unavailable();
  const r = await waysIn.verifyPin(user.user_id, pin, { ip, purpose: "sign_in" });
  if (!r.ok) {
    if (r.code === "PIN_UNAVAILABLE") throw unavailable();
    throw new AppError(
      r.code,
      r.message,
      r.code === "PIN_THROTTLED" ? 429 : 401,
      r.code === "INVALID_PIN" ? { pin: ["Not the right PIN"] } : null,
    );
  }
  await refuseInactive(user, { email, ip });
  return afterFirstStep(user, {
    via: "pin",
    ip,
    userAgent,
    deviceToken,
    within: (client) => waysIn.pinUsed(client, user.user_id),
  });
}

/** POST /auth/passkey/options. Bound to the email when one is given (the lock screen). */
const passkeyOptions = ({ email }) => waysIn.passkeySignInOptions({ email });

/** POST /auth/passkey: a passkey is both steps, so the session opens on a good answer. */
async function passkeySignIn({ challenge_token, credential, ip, userAgent, deviceToken }) {
  const found = await waysIn.checkPasskeySignIn({ challenge_token, credential });
  const user = await repo.findLoginById(pool, found.userId);
  if (!user) throw new AppError("PASSKEY_UNKNOWN", "This passkey is not on any account here. Use your password.", 401);
  await refuseInactive(user, { email: user.email, ip });
  return startSession(user, {
    ip,
    userAgent,
    deviceToken,
    method: "passkey",
    within: (client) => waysIn.spendPasskey(client, found),
  });
}

/* ------------------------------------------------------------------ *
 * Refreshing and ending
 * ------------------------------------------------------------------ */

const ENDED_MESSAGES = Object.freeze({
  session_max_age: [
    "SESSION_TIME_LIMIT",
    "Your session reached its time limit. Sign in again to carry on.",
  ],
  inactivity_timeout: [
    "SESSION_IDLE",
    "Your session ended after a period of inactivity. Sign in again.",
  ],
});

function endedError(reason) {
  const [code, message] = ENDED_MESSAGES[reason] || [
    "SESSION_ENDED",
    "This session has ended. Sign in again.",
  ];
  return new AppError(code, message, 401);
}

/**
 * POST /auth/refresh: a new access token, and a new refresh token, for the session
 * the cookie names. Ends the session instead when it is past its ceiling, idle past
 * the limit, belongs to a login that can no longer sign in, or the token presented
 * was already rotated away.
 * @param {string|null} refreshToken
 * @returns {Promise<{body: object, refresh: {token: string, seconds: number}}>}
 */
async function refresh(refreshToken) {
  const claims = readRefreshToken(refreshToken);
  if (!claims) throw endedError(null);
  await policy.load(pool);

  const outcome = await tx(async (client) => {
    const s = await repo.lockSession(client, claims.sid);
    if (!s || s.killed_at || s.user_id !== claims.sub)
      return { ended: "not_live" };

    let reason;
    if (s.refresh_token_hash !== cookies.hashToken(claims.jti))
      reason = "refresh_token_reuse";
    else if (s.status !== "active") reason = "account_suspended";
    else reason = policy.endReason(s);

    if (reason) {
      await repo.endSession(client, s.session_id, { reason });
      await emit(client, {
        key: EVENTS.AUTH_SESSION_ENDED,
        entity: account(s.user_id),
        actor: null,
        payload: { session_id: s.session_id, reason, by: "policy" },
      });
      return { ended: reason, userId: s.user_id, sessionId: s.session_id };
    }

    const remaining = policy.remainingSeconds(s.age_seconds);
    const jti = crypto.randomUUID();
    await repo.rotateSession(client, s.session_id, cookies.hashToken(jti));
    return { remaining, jti, userId: s.user_id, sessionId: s.session_id };
  });

  if (outcome.ended) {
    if (outcome.userId) await forget(outcome.userId, [outcome.sessionId]);
    if (outcome.ended === "refresh_token_reuse")
      logger.warn(
        { user_id: outcome.userId, session_id: outcome.sessionId },
        "refresh token presented after rotation; session ended",
      );
    throw endedError(outcome.ended);
  }

  const { remaining, jti, userId, sessionId } = outcome;
  return {
    body: {
      access_token: signAccess({
        userId,
        sessionId,
        seconds: policy.accessTtlFor(remaining),
      }),
      ...policy.clock(remaining),
    },
    refresh: {
      token: signRefresh({
        userId,
        sessionId,
        jti,
        seconds: policy.refreshTtlFor(remaining),
      }),
      seconds: remaining,
    },
  };
}

/**
 * POST /auth/logout. The session comes from the access token when it is still
 * valid, or else from the refresh cookie, so signing out works after the access
 * token has expired. Ends nothing it cannot identify; always succeeds. `idle`
 * is the screen locking itself after the idle limit, recorded as such.
 * @param {{accessClaims?: {sub: string, sid: string}|null, refreshToken?: string|null, ip?: string, idle?: boolean}} input
 */
async function logout({ accessClaims, refreshToken, ip, idle = false }) {
  const claims =
    accessClaims && accessClaims.sid ? accessClaims : readRefreshToken(refreshToken);
  if (!claims || !claims.sid || !claims.sub) return { ended: false };
  const reason = idle ? "inactivity_timeout" : "signed_out";
  const ended = await tx(async (client) => {
    const done = await repo.endSession(client, claims.sid, {
      reason,
      by: claims.sub,
      userId: claims.sub,
    });
    if (done) {
      await emit(client, {
        key: EVENTS.AUTH_SIGNED_OUT,
        entity: account(claims.sub),
        actor: { user_id: claims.sub, ip: ip || null },
        payload: { session_id: claims.sid, reason },
      });
    }
    return done;
  });
  await forget(claims.sub, [claims.sid]);
  return { ended };
}

/* ------------------------------------------------------------------ *
 * Passwords
 * ------------------------------------------------------------------ */

/**
 * POST /auth/password: the signed-in person proves their current password and
 * chooses a new one. Their other sessions end; this one stays. Open reset links stop
 * working: whoever asked for one is now behind the password just proved.
 * @param {{user_id: string, session_id: string}} actor  req.user
 */
async function changePassword(actor, { current_password, new_password }, ip) {
  const user = await repo.findLoginById(pool, actor.user_id);
  if (!user || user.status !== "active")
    throw new AppError("AUTH_REQUIRED", "Sign in to continue", 401);
  if (!(await verifyPassword(user.password_hash, current_password))) {
    throw new AppError("INVALID_CURRENT_PASSWORD", "That is not your current password.", 422, {
      current_password: ["Not your password"],
    });
  }
  if (current_password === new_password) {
    throw new AppError("SAME_PASSWORD", "Choose a password you have not used here.", 422, {
      new_password: ["Same as current"],
    });
  }
  await policy.load(pool);
  await passwordPolicy.assert(new_password, { email: user.email, field: "new_password" });
  const hash = await hashPassword(new_password);

  const ended = await tx(async (client) => {
    await repo.setPasswordHash(client, user.user_id, hash);
    await repo.closeOpenLinks(client, user.user_id);
    const ids = await repo.endUserSessions(client, user.user_id, {
      reason: "password_changed",
      by: user.user_id,
      except: actor.session_id,
    });
    await emit(client, {
      key: EVENTS.AUTH_PASSWORD_CHANGED,
      entity: account(user.user_id),
      actor: actorOf(user, ip),
      payload: { sessions_ended: ids.length },
    });
    return ids;
  });
  await forget(user.user_id, ended);
  return { sessions_signed_out: ended.length };
}

/**
 * POST /auth/forgot. The same answer whether or not the email has an account. An
 * active account gets one reset link; asking again within two minutes sends nothing
 * new, so nobody can fill a colleague's inbox.
 */
async function forgot({ email, ip }) {
  const user = await repo.findLoginByEmail(pool, email);
  if (
    user &&
    user.status === "active" &&
    !(await repo.recentLink(pool, user.user_id, "reset", RESET_REPEAT_SECONDS))
  ) {
    await tx((client) =>
      emit(client, {
        key: EVENTS.AUTH_LINK_REQUESTED,
        entity: account(user.user_id),
        actor: { user_id: null, ip: ip || null },
        payload: { purpose: "reset", ip_address: ip || null },
        dedup_key: `reset:${user.user_id}:${Math.floor(Date.now() / (RESET_REPEAT_SECONDS * 1000))}`,
      }),
    );
  }
  return { ok: true };
}

/**
 * The outbox handler for auth.link_requested: mint the link, keep its hash, and
 * queue the email that carries it. Runs in the worker after the request committed.
 * @param {{event_id: string, entity: {id: string}, payload: {purpose: string, ip_address?: string, requested_by?: string}}} event
 */
async function sendCredentialLink(event) {
  const purpose = event.payload.purpose === "invite" ? "invite" : "reset";
  const userId = event.entity.id;
  const token = crypto.randomBytes(32).toString("base64url");
  const seconds =
    purpose === "invite" ? INVITE_LINK_HOURS * 3600 : RESET_LINK_MINUTES * 60;

  const found = await tx(async (client) => {
    const user = await repo.findLoginById(client, userId);
    if (!user || user.status !== "active") return null;
    const link = await repo.upsertLink(client, {
      userId,
      hash: cookies.hashToken(token),
      purpose,
      seconds,
      requestedBy: event.payload.requested_by || null,
      ip: event.payload.ip_address || null,
      eventId: event.event_id,
    });
    await repo.closeOpenLinks(client, userId, { except: link.password_reset_id });
    const by = event.payload.requested_by
      ? await repo.findLoginById(client, event.payload.requested_by)
      : null;
    return { user, invitedBy: by ? by.display_name : "MyCity People" };
  });
  if (!found) return;

  const { user, invitedBy } = found;
  const url = new URL(purpose === "invite" ? "/welcome" : "/reset", config.STAFF_ORIGIN);
  url.searchParams.set("token", token);
  const queues = require("../../jobs/queues");
  await queues.enqueue(
    "email-send",
    purpose === "invite" ? "user-invite" : "password-reset",
    {
      to: { name: user.display_name, email: user.email },
      recipient: { first_name: user.first_name, last_name: user.last_name, email: user.email },
      template: purpose === "invite" ? "user-invite" : "password-reset",
      data:
        purpose === "invite"
          ? { link_url: url.href, hours: INVITE_LINK_HOURS, job_title: user.job_title, invited_by: invitedBy }
          : { link_url: url.href, minutes: RESET_LINK_MINUTES },
    },
    // The link is a secret: the job holding it is dropped from Redis once sent.
    { removeOnComplete: true, removeOnFail: 50 },
  );
}

/**
 * Does the link in a queued invitation or reset still work? The mail queue drops one that a
 * newer link replaced, or that expired while it waited (docs/guides/integrations.md §6.15), so
 * nobody is sent a link that only says it has expired. A link this code cannot read is sent.
 * @param {string} url  the message's link_url
 */
async function linkStillOpen(url) {
  let token;
  try {
    token = new URL(url).searchParams.get("token");
  } catch {
    return true;
  }
  if (!token) return true;
  return Boolean(await repo.findOpenLink(pool, cookies.hashToken(token)));
}

/** POST /auth/link: is this reset or invitation link still good? */
async function checkLink(token) {
  const link = await repo.findOpenLink(pool, cookies.hashToken(token));
  if (!link)
    throw new AppError("LINK_INVALID", "This link has expired or was already used.", 404);
  return {
    purpose: link.purpose,
    email: link.email,
    first_name: link.first_name,
    expires_at: new Date(link.expires_at).toISOString(),
  };
}

/**
 * POST /auth/reset: choose a password from a link. The link is spent, every other
 * open link closes, and every session of the account ends.
 */
async function resetPassword({ token, new_password, ip }) {
  const hashOfToken = cookies.hashToken(token);
  const link = await repo.findOpenLink(pool, hashOfToken);
  if (!link)
    throw new AppError("LINK_INVALID", "This link has expired or was already used.", 404);
  await policy.load(pool);
  await passwordPolicy.assert(new_password, { email: link.email, field: "new_password" });
  const hash = await hashPassword(new_password);

  const out = await tx(async (client) => {
    const locked = await repo.findOpenLink(client, hashOfToken, { lock: true });
    if (!locked) return null;
    await repo.setPasswordHash(client, locked.user_id, hash);
    await repo.spendLink(client, locked.password_reset_id);
    await repo.closeOpenLinks(client, locked.user_id);
    const ended = await repo.endUserSessions(client, locked.user_id, {
      reason: "password_reset",
      by: locked.user_id,
    });
    await emit(client, {
      key: EVENTS.AUTH_PASSWORD_SET,
      entity: account(locked.user_id),
      actor: { user_id: locked.user_id, email: locked.email, ip: ip || null },
      payload: { purpose: locked.purpose, sessions_ended: ended.length },
    });
    return { userId: locked.user_id, email: locked.email, ended };
  });
  if (!out)
    throw new AppError("LINK_INVALID", "This link has expired or was already used.", 404);
  await forget(out.userId, out.ended);
  return { email: out.email };
}

/* ------------------------------------------------------------------ *
 * The caller's own sessions
 * ------------------------------------------------------------------ */

async function listSessions(actor, query) {
  await policy.load(pool);
  return repo.listSessions(pool, actor.user_id, query, {
    currentSessionId: actor.session_id,
    idleSeconds: policy.idleSeconds(),
  });
}

/** End one of the caller's other sessions (a lost phone, a shared computer). */
async function endOwnSession(actor, sessionId, ip) {
  if (sessionId === actor.session_id) {
    throw new AppError("CURRENT_SESSION", "Use Sign Out to end this session.", 422);
  }
  const done = await tx(async (client) => {
    const ended = await repo.endSession(client, sessionId, {
      reason: "ended_by_user",
      by: actor.user_id,
      userId: actor.user_id,
    });
    if (ended) {
      await emit(client, {
        key: EVENTS.AUTH_SESSION_ENDED,
        entity: account(actor.user_id),
        actor: { ...actor, ip: ip || null },
        payload: { session_id: sessionId, reason: "ended_by_user", by: "self" },
      });
    }
    return ended;
  });
  if (!done) throw new AppError("NOT_FOUND", "That session has already ended.", 404);
  await forget(actor.user_id, [sessionId]);
}

/** End every session of the caller but this one. */
async function endOtherSessions(actor, ip) {
  const ids = await tx(async (client) => {
    const ended = await repo.endUserSessions(client, actor.user_id, {
      reason: "ended_by_user",
      by: actor.user_id,
      except: actor.session_id,
    });
    if (ended.length) {
      await emit(client, {
        key: EVENTS.AUTH_SESSION_ENDED,
        entity: account(actor.user_id),
        actor: { ...actor, ip: ip || null },
        payload: { count: ended.length, reason: "ended_by_user", by: "self", kept_session_id: actor.session_id || null },
      });
    }
    return ended;
  });
  await forget(actor.user_id, ids);
  return { ended: ids.length };
}

/** GET /auth/security: the My Security summary. */
async function security(actor) {
  const user = await repo.findLoginById(pool, actor.user_id);
  if (!user) throw new AppError("AUTH_REQUIRED", "Sign in to continue", 401);
  await policy.load(pool);
  return {
    password_changed_at: user.password_changed_at
      ? new Date(user.password_changed_at).toISOString()
      : null,
    active_sessions: await repo.countLiveSessions(pool, actor.user_id, policy.idleSeconds()),
    session_max_age: policy.maxAgeSeconds(),
    session_idle_limit: policy.idleSeconds(),
  };
}

/**
 * GET /auth/device: who last signed in on this browser, for the greeting, and
 * whether to offer their PIN or a passkey.
 */
async function device(deviceToken) {
  if (!deviceToken) return { account: null };
  const row = await repo.deviceAccount(pool, cookies.hashToken(deviceToken));
  return {
    account: row
      ? {
          email: row.email,
          display_name: row.display_name,
          first_name: row.first_name,
          has_pin: row.has_pin === true,
          has_passkey: row.has_passkey === true,
        }
      : null,
  };
}

/* ------------------------------------------------------------------ *
 * Proving it is still you (the security module's changes ask for it)
 * ------------------------------------------------------------------ */

/**
 * Seconds this session has left in which a way to sign in may be added or removed
 * without confirming again: the window after signing in, or after confirming.
 * @param {{query: Function}} db
 * @param {{user_id: string, session_id: string}} actor
 */
async function confirmedFor(db, actor) {
  const s = await repo.sessionProof(db, actor.session_id, actor.user_id);
  if (!s) return 0;
  return Math.max(0, Math.floor(policy.confirmWindowSeconds() - Number(s.proved_ago)));
}

/** The session proved who it is again (in the caller's transaction). */
async function markReauthenticated(client, actor) {
  if (!(await repo.markReauthenticated(client, actor.session_id, actor.user_id)))
    throw new AppError("SESSION_ENDED", "This session has ended. Sign in again.", 401);
}

/** The device the session is on, or null. */
async function sessionDevice(db, actor) {
  const s = await repo.sessionProof(db, actor.session_id, actor.user_id);
  return s ? s.known_device_id : null;
}

/** No browser of this person may skip the two-step code any more (in the caller's transaction). */
const clearDeviceTrust = (client, userId) => repo.clearDeviceTrust(client, userId);

/* ------------------------------------------------------------------ *
 * Accounts (create-admin, Settings · Users). Each takes the caller's client:
 * they run inside the caller's transaction. Clear the fast index afterwards with
 * afterSessionsEnded().
 * ------------------------------------------------------------------ */

const findUserByEmail = (client, email) => repo.findLoginByEmail(client, email);
const findUserByEmployeeId = (client, employeeId) =>
  repo.findLoginByEmployeeId(client, employeeId);
const findUserById = (client, userId) => repo.findLoginById(client, userId);
const findCeo = (client) => repo.findCeo(client);

/**
 * A login for an employee. With a password (create-admin) it can sign in at once;
 * without one (an invitation) it cannot until the person chooses one from the link.
 * @param {import("pg").PoolClient} client
 * @param {{employee_id: string, email: string, password?: string|null, is_ceo?: boolean}} input
 * @param {object} actor
 * @returns {Promise<{user_id: string, email: string}>}
 */
async function createUserForEmployee(client, { employee_id, email, password = null, is_ceo = false }, actor) {
  // Named on employee_id, the field Invite User shows, so the person sees why on the form.
  if (await repo.findLoginByEmployeeId(client, employee_id))
    throw new AppError("LOGIN_EXISTS", "This employee already has a login.", 409, { employee_id: ["Already has a login"] });
  if (await repo.findLoginByEmail(client, email))
    throw new AppError("LOGIN_EXISTS", "Another login signs in with this person's work email.", 409, {
      employee_id: ["Email used by a login"],
    });
  let hash = null;
  if (password !== null && password !== undefined) {
    // The pool, not the caller's transaction: a failed read must not abort their work.
    await policy.load(pool);
    await passwordPolicy.assert(password, { email, field: "password" });
    hash = await hashPassword(password);
  }
  let row;
  try {
    row = await repo.insertLogin(client, {
      employeeId: employee_id,
      email,
      passwordHash: hash,
      isCeo: is_ceo,
    });
  } catch (err) {
    // Two invitations for one person at once: the second meets the unique index (migration 0500).
    if (err && err.code === "23505")
      throw new AppError("LOGIN_EXISTS", "This employee already has a login.", 409, { employee_id: ["Already has a login"] });
    throw err;
  }
  await emit(client, {
    key: EVENTS.APP_USER_CREATED,
    entity: { type: "app_user", id: row.user_id },
    actor,
    after: { user_id: row.user_id, employee_id, email: row.email, is_ceo: row.is_ceo, invited: hash === null },
    payload: { employee_id, invited: hash === null },
  });
  return { user_id: row.user_id, email: row.email };
}

/** Send a link: an invitation (choose a first password) or a reset requested by an administrator. */
async function requestLink(client, userId, purpose, actor) {
  await emit(client, {
    key: EVENTS.AUTH_LINK_REQUESTED,
    entity: account(userId),
    actor,
    payload: { purpose, requested_by: actor && actor.user_id ? actor.user_id : null },
  });
}

/** Suspend a login: it cannot sign in, and every session ends now. Returns the session ids ended. */
async function suspendUser(client, userId, reason, actor) {
  const before = await repo.findLoginById(client, userId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  if (before.is_ceo) throw new AppError("CEO_PROTECTED", "The CEO's login cannot be suspended.", 422);
  await repo.setStatus(client, userId, "suspended");
  const ended = await repo.endUserSessions(client, userId, {
    reason: "account_suspended",
    by: actor && actor.user_id ? actor.user_id : null,
  });
  await emit(client, {
    key: EVENTS.APP_USER_SUSPENDED,
    entity: { type: "app_user", id: userId },
    actor,
    before: { status: before.status },
    after: { status: "suspended" },
    payload: { reason, sessions_ended: ended.length },
  });
  return ended;
}

async function reactivateUser(client, userId, actor) {
  const before = await repo.findLoginById(client, userId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  if (before.employee_status !== "active")
    throw new AppError("EMPLOYEE_NOT_ACTIVE", "Restore their employee record before reactivating this login.", 422);
  await repo.setStatus(client, userId, "active");
  await emit(client, {
    key: EVENTS.APP_USER_REACTIVATED,
    entity: { type: "app_user", id: userId },
    actor,
    before: { status: before.status },
    after: { status: "active" },
  });
}

/**
 * The outbox handler for employee.archived: the person's login closes (status left), every
 * session ends and every open link is spent, so nobody keeps access after leaving. Restoring the
 * record does not reopen it; Reactivate on Settings · Users does (docs/guides/identity.md §6.1).
 * @param {{entity: {id: string}}} event
 */
async function closeLoginOf(event) {
  const employeeId = event.entity && event.entity.id;
  if (!employeeId) return;
  const closed = await tx(async (client) => {
    const held = await repo.findLoginByEmployeeId(client, employeeId);
    if (!held || held.login_status === "left") return null;
    await repo.setStatus(client, held.user_id, "left");
    const ended = await repo.endUserSessions(client, held.user_id, { reason: "account_suspended" });
    await repo.closeOpenLinks(client, held.user_id);
    await emit(client, {
      key: EVENTS.APP_USER_LEFT,
      entity: { type: "app_user", id: held.user_id },
      actor: null,
      before: { status: held.login_status },
      after: { status: "left" },
      payload: { employee_id: employeeId, sessions_ended: ended.length },
    });
    return { userId: held.user_id, ended };
  });
  if (!closed) return;
  await afterSessionsEnded(closed.userId, closed.ended);
  await grantsCache.invalidateUser(closed.userId);
}

/**
 * Move a login to another address: refused when another login signs in with it. Its sessions
 * end and its open links are spent, so the person signs in afresh with the new address. With
 * `notify`, both addresses are told (a login in use: Use Work Email on Settings · Users).
 * @returns {Promise<{user_id: string, from: string, to: string, ended: string[]}>}
 */
async function changeLoginEmail(client, userId, email, actor, { notify = false } = {}) {
  const held = await repo.findLoginById(client, userId);
  if (!held) throw new AppError("NOT_FOUND", "Not found", 404);
  const to = String(email).trim().toLowerCase();
  if (held.email.toLowerCase() === to) return { user_id: userId, from: held.email, to, ended: [] };
  const holder = await repo.findLoginByEmail(client, to);
  if (holder && holder.user_id !== userId)
    throw new AppError("LOGIN_EXISTS", "Another login signs in with this email.", 409, { email: ["Already has a login"] });
  await repo.setEmail(client, userId, to);
  const ended = await repo.endUserSessions(client, userId, { reason: "ended_by_admin", by: actor && actor.user_id ? actor.user_id : null });
  await repo.closeOpenLinks(client, userId);
  await emit(client, {
    key: EVENTS.APP_USER_EMAIL_CHANGED,
    entity: { type: "app_user", id: userId },
    actor,
    before: { email: held.email },
    after: { email: to },
    payload: { from: held.email, to, notify, first_name: held.first_name },
  });
  return { user_id: userId, from: held.email, to, ended };
}

/**
 * The outbox handler for employee.updated: when People correct a work email, a login nobody has
 * used yet (no password chosen) follows it, and its invitation is spent, since it went to the old
 * address; Send Invite sends a new one. A login in use stays where it is until Use Work Email
 * (JBS Praxis, 25/10/2026). A new address another login already uses is left for People to see on
 * Settings · Users.
 * @param {{entity: {id: string}, payload?: {work_email?: {from: string, to: string}}}} event
 */
async function followWorkEmail(event) {
  const change = event.payload && event.payload.work_email;
  if (!change || !change.to) return;
  await tx(async (client) => {
    const held = await repo.findLoginByEmployeeId(client, event.entity.id);
    if (!held || held.password_changed_at || held.login_status !== "active") return;
    const holder = await repo.findLoginByEmail(client, change.to);
    if (holder && holder.user_id !== held.user_id) return;
    await changeLoginEmail(client, held.user_id, change.to, null);
  });
}

/**
 * The outbox handler for app_user.email_changed with `notify`: the old and the new address are
 * both told, so a move nobody expected is noticed whichever inbox the person reads.
 */
async function tellEmailChanged(event) {
  const p = event.payload || {};
  if (!p.notify || !p.from || !p.to) return;
  const queues = require("../../jobs/queues");
  for (const address of [p.from, p.to]) {
    await queues.enqueue("email-send", "notification", {
      to: { email: address },
      recipient: { first_name: p.first_name || "", email: address },
      template: "notification",
      data: {
        title: "Your MyCity sign-in email changed",
        body: `You now sign in with ${p.to}. If you did not expect this, tell People now.`,
        link_url: null,
      },
    });
  }
}

/** An administrator signs a person out everywhere. Returns the session ids ended. */
async function endAllSessions(client, userId, actor) {
  const ended = await repo.endUserSessions(client, userId, {
    reason: "ended_by_admin",
    by: actor && actor.user_id ? actor.user_id : null,
  });
  if (ended.length) {
    await emit(client, {
      key: EVENTS.AUTH_SESSION_ENDED,
      entity: account(userId),
      actor,
      payload: { count: ended.length, reason: "ended_by_admin", by: "admin" },
    });
  }
  return ended;
}

/** After the transaction that ended sessions commits. */
const afterSessionsEnded = (userId, sessionIds) => forget(userId, sessionIds);

/**
 * Everyone's live sessions, for an administrator (Settings · Security).
 * @param {{session_id: string}} actor  req.user, to mark their own session
 */
async function liveSessions(query, actor) {
  await policy.load(pool);
  return repo.liveSessionPage(pool, query, {
    currentSessionId: actor && actor.session_id,
    idleSeconds: policy.idleSeconds(),
  });
}

/**
 * An administrator ends one session (in the caller's transaction). The person is told.
 * Returns the login it belonged to, or null when it had already ended; clear the fast
 * index with afterSessionsEnded() once the transaction commits.
 */
async function endSessionAsAdmin(client, sessionId, actor) {
  if (actor && sessionId === actor.session_id)
    throw new AppError("CURRENT_SESSION", "Use Sign Out to end your own session.", 422);
  const userId = await repo.endAnySession(client, sessionId, {
    reason: "ended_by_admin",
    by: actor && actor.user_id ? actor.user_id : null,
  });
  if (!userId) return null;
  await emit(client, {
    key: EVENTS.AUTH_SESSION_ENDED,
    entity: account(userId),
    actor,
    payload: { session_id: sessionId, reason: "ended_by_admin", by: "admin" },
  });
  return userId;
}

module.exports = {
  me,
  login,
  twoStep,
  twoStepSetup,
  enrolTwoStep,
  pinSignIn,
  passkeyOptions,
  passkeySignIn,
  confirmedFor,
  markReauthenticated,
  sessionDevice,
  clearDeviceTrust,
  refresh,
  logout,
  changePassword,
  forgot,
  sendCredentialLink,
  linkStillOpen,
  checkLink,
  resetPassword,
  listSessions,
  endOwnSession,
  endOtherSessions,
  security,
  device,
  findUserByEmail,
  findUserByEmployeeId,
  findUserById,
  findCeo,
  createUserForEmployee,
  requestLink,
  suspendUser,
  reactivateUser,
  closeLoginOf,
  changeLoginEmail,
  followWorkEmail,
  tellEmailChanged,
  endAllSessions,
  afterSessionsEnded,
  liveSessions,
  endSessionAsAdmin,
  verifyPassword,
  RESET_LINK_MINUTES,
  INVITE_LINK_HOURS,
};
