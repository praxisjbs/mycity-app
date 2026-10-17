"use strict";
/**
 * /api/v1/auth: signing in and out, the session, the caller's own account.
 *
 * The routes that obtain or recover a session are anonymous (there is no session
 * yet), and each is rate limited before its body is even read. The rest are the
 * caller's own (`self`): the service works only on the signed-in person's account,
 * so no grant is involved and none could widen it.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const limits = require("../../middleware/rate-limit");
const controller = require("./identity.controller");

const router = express.Router();

route(router, "post", "/login",
  { body: c.identity.LoginBody, response: c.security.SignInResult, anonymous: true, summary: "Sign in: a session, or the code step" },
  limits.signInLimiter, controller.login);

route(router, "post", "/two-step",
  { body: c.security.CodeStep, response: c.identity.Session, anonymous: true, summary: "The code step of two-step sign-in" },
  limits.twoStepLimiter, controller.twoStep);

route(router, "post", "/two-step/setup",
  { body: c.security.SetupStart, response: c.security.TwoStepSetup, anonymous: true, summary: "Set two-step up when a role requires it: the key to scan" },
  limits.twoStepLimiter, controller.twoStepSetup);

route(router, "post", "/two-step/enrol",
  { body: c.security.SetupFinish, response: c.security.EnrolledSession, anonymous: true, summary: "Turn two-step on with the app's first code, and sign in" },
  limits.twoStepLimiter, controller.enrolTwoStep);

route(router, "post", "/pin",
  { body: c.security.PinSignIn, response: c.security.SignInResult, anonymous: true, summary: "Sign in with the PIN on a known browser" },
  limits.pinLimiter, controller.pinSignIn);

route(router, "post", "/passkey/options",
  { body: c.security.PasskeyStart, response: c.security.PasskeyChallenge, anonymous: true, summary: "Start signing in with a passkey" },
  limits.passkeyLimiter, controller.passkeyOptions);

route(router, "post", "/passkey",
  { body: c.security.PasskeySignIn, response: c.identity.Session, anonymous: true, summary: "Sign in with a passkey" },
  limits.passkeyLimiter, controller.passkeySignIn);

route(router, "post", "/refresh",
  { body: c.common.EmptyBody, response: c.identity.SessionTokens, anonymous: true, summary: "New access token from the refresh cookie" },
  limits.refreshLimiter, controller.refresh);

route(router, "post", "/logout",
  { body: c.identity.LogoutBody, no_content: true, anonymous: true, summary: "Sign out this session" },
  controller.logout);

route(router, "get", "/device",
  { response: c.identity.DeviceAccount, anonymous: true, summary: "Who last signed in on this browser" },
  limits.deviceLimiter, controller.device);

route(router, "post", "/forgot",
  { body: c.identity.ForgotBody, response: c.identity.Accepted, anonymous: true, summary: "Email a reset link" },
  limits.forgotLimiter, controller.forgot);

route(router, "post", "/link",
  { body: c.identity.LinkCheckBody, response: c.identity.LinkCheck, anonymous: true, summary: "Check a reset or invitation link" },
  limits.resetLimiter, controller.checkLink);

route(router, "post", "/reset",
  { body: c.identity.ResetBody, response: c.identity.ResetDone, anonymous: true, summary: "Choose a password from a link" },
  limits.resetLimiter, controller.reset);

route(router, "get", "/me",
  { response: c.identity.Me, self: true, summary: "The signed-in person" },
  controller.me);

route(router, "get", "/security",
  { response: c.identity.SecuritySummary, self: true, summary: "My Security summary" },
  controller.security);

route(router, "post", "/password",
  { body: c.identity.PasswordChange, response: c.identity.PasswordChanged, self: true, summary: "Change my password" },
  limits.changePasswordLimiter, controller.changePassword);

route(router, "get", "/sessions",
  { query: c.identity.SignInListQuery, response: c.identity.SignInPage, self: true, summary: "My sign-ins" },
  controller.sessions);

route(router, "post", "/sessions/end-others",
  { body: c.common.EmptyBody, response: c.identity.SessionsEnded, self: true, summary: "Sign out my other sessions" },
  controller.endOtherSessions);

route(router, "post", "/sessions/:id/end",
  { body: c.common.EmptyBody, no_content: true, self: true, summary: "Sign out one of my other sessions" },
  controller.endSession);

module.exports = { basePath: "/auth", surface: "staff", router };
