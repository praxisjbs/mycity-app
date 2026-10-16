"use strict";
// ai:none sign-in credentials, sessions and devices are not material for the assistant
// search:none nothing here is a record a person looks up; sign-ins are listed on My Security
/**
 * Identity's HTTP edge: reads the request (body, client address, cookies), calls
 * the service, sets or clears the two cookies, answers.
 */
const { pool } = require("../../config/db");
const { ok, noContent } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { bearerOf, verifyAccessToken } = require("../../middleware/auth");
const cookies = require("./identity.cookies");
const service = require("./identity.service");

const userAgentOf = (req) => String(req.headers["user-agent"] || "").slice(0, 400);

async function login(req, res) {
  const result = await service.login({
    ...req.validated.body,
    ip: req.ip,
    userAgent: userAgentOf(req),
    deviceToken: cookies.readDevice(req),
  });
  cookies.setRefresh(res, result.refresh.token, result.refresh.seconds);
  cookies.setDevice(res, result.device);
  return ok(res, result.body);
}

async function refresh(req, res) {
  try {
    const result = await service.refresh(cookies.readRefresh(req));
    cookies.setRefresh(res, result.refresh.token, result.refresh.seconds);
    return ok(res, result.body);
  } catch (err) {
    // A session that has ended leaves no cookie behind to be tried again.
    cookies.clearRefresh(res);
    throw err;
  }
}

async function logout(req, res) {
  let accessClaims = null;
  const bearer = bearerOf(req);
  if (bearer) {
    try {
      accessClaims = verifyAccessToken(bearer);
    } catch {
      accessClaims = null;
    }
  }
  await service.logout({
    accessClaims,
    refreshToken: cookies.readRefresh(req),
    ip: req.ip,
  });
  cookies.clearRefresh(res);
  return noContent(res);
}

const me = async (req, res) => ok(res, await service.me(pool, req.user.user_id));

const device = async (req, res) =>
  ok(res, await service.device(cookies.readDevice(req)));

const security = async (req, res) => ok(res, await service.security(req.user));

const changePassword = async (req, res) =>
  ok(res, await service.changePassword(req.user, req.validated.body, req.ip));

const forgot = async (req, res) =>
  ok(res, await service.forgot({ email: req.validated.body.email, ip: req.ip }));

const checkLink = async (req, res) =>
  ok(res, await service.checkLink(req.validated.body.token));

const reset = async (req, res) =>
  ok(res, await service.resetPassword({ ...req.validated.body, ip: req.ip }));

const sessions = async (req, res) =>
  sendPaged(res, await service.listSessions(req.user, req.validated.query));

async function endSession(req, res) {
  await service.endOwnSession(req.user, req.validated.params.id, req.ip);
  return noContent(res);
}

const endOtherSessions = async (req, res) =>
  ok(res, await service.endOtherSessions(req.user, req.ip));

module.exports = {
  login,
  refresh,
  logout,
  me,
  device,
  security,
  changePassword,
  forgot,
  checkLink,
  reset,
  sessions,
  endSession,
  endOtherSessions,
};
