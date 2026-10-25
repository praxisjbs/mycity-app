"use strict";
/**
 * What identity records, who is told, and the work that follows (loaded by the API
 * and the worker).
 *
 * Event keys start with `auth.` or `app_user.`, so their notifications are in the
 * Security category (shared/notifications/categories.js): on by default, by email
 * too, and not something a person can switch off.
 *
 * The credential links. A reset or invitation link carries a secret, so the secret
 * never touches the event, the audit ledger or a notification row. The request
 * records `auth.link_requested`; the handler below then mints the token, keeps only
 * its hash, and queues the email that carries it. A retried handler mints a new
 * token for the same event (the old one stops working), so a retry can never send a
 * link that no longer opens.
 */
const c = require("@mycity/contract");
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineVariables } = require("../../shared/templates/variables");

const EVENTS = defineEvents("settings", {
  "auth.signed_in": { summary: "Signed in" },
  "auth.sign_in_failed": { summary: "A sign-in failed" },
  "auth.sign_in_throttled": {
    summary: "Repeated wrong passwords slowed sign-in to an account",
  },
  "auth.signed_out": { summary: "Signed out" },
  "auth.session_ended": { summary: "A session was ended" },
  "auth.password_changed": { summary: "A password was changed" },
  "auth.link_requested": { summary: "A password link was requested" },
  "auth.password_set": { summary: "A password was set from a link" },
  "app_user.created": { summary: "A login was created", security: true },
  "app_user.suspended": { summary: "A login was suspended", security: true },
  "app_user.reactivated": {
    summary: "A login was reactivated",
    security: true,
  },
  "app_user.left": {
    summary: "A login was closed: its employee was archived",
    security: true,
  },
  "app_user.email_changed": {
    summary: "A login moved to another email address",
    security: true,
  },
});

defineVariables("email", "password-reset", c.identity.PasswordResetEmailVars);
defineVariables("email", "user-invite", c.identity.UserInviteEmailVars);

/** The person the event is about: its entity is their own account. */
const self = (e) => (e.entity && e.entity.type === "account" ? [e.entity.id] : []);

// A sign-in from a browser this person has never used, when they have used others.
// The first sign-in after an invitation is not news, so it says nothing.
defineNotification(EVENTS.AUTH_SIGNED_IN, {
  to: [
    {
      users: (e) =>
        e.payload && e.payload.new_device && e.payload.known_before ? self(e) : [],
    },
  ],
  title: "New sign-in to your account",
  body: (e) =>
    `${e.payload.device_label}${e.payload.ip_address ? `, ${e.payload.ip_address}` : ""}. If this was not you, reset your password now.`,
  priority: "high",
  include_actor: true,
  who: "The account holder",
});

// A wrong two-step code comes after the right password, so it says more than a wrong password.
const wrongCodes = (e) => Boolean(e.payload && e.payload.reason === "bad_code");

defineNotification(EVENTS.AUTH_SIGN_IN_THROTTLED, {
  to: [{ users: self }],
  title: (e) =>
    wrongCodes(e) ? "Several wrong codes on your account" : "Several wrong passwords on your account",
  body: (e) =>
    wrongCodes(e)
      ? "Someone with your password is entering wrong codes. Change your password now."
      : "Sign-in now waits between attempts. If this was not you, reset your password.",
  priority: "high",
  include_actor: true,
  who: "The account holder",
});

defineNotification(EVENTS.AUTH_PASSWORD_CHANGED, {
  to: [{ users: self }],
  title: "Your password was changed",
  body: (e) =>
    e.payload && e.payload.sessions_ended
      ? `Your other sessions were signed out. If this was not you, tell People now.`
      : "If this was not you, tell People now.",
  priority: "high",
  include_actor: true,
  who: "The account holder",
});

defineNotification(EVENTS.AUTH_PASSWORD_SET, {
  to: [{ users: (e) => (e.payload && e.payload.purpose === "reset" ? self(e) : []) }],
  title: "Your password was reset",
  body: "Every session was signed out. If this was not you, tell People now.",
  priority: "high",
  include_actor: true,
  who: "The account holder",
});

defineNotification(EVENTS.AUTH_SESSION_ENDED, {
  to: [{ users: (e) => (e.payload && e.payload.by === "admin" ? self(e) : []) }],
  title: "Your sessions were signed out",
  body: "An administrator signed you out. Sign in again to continue.",
  priority: "high",
  who: "The account holder",
});

// The service is required lazily: it requires this file for EVENTS.
outbox.register(EVENTS.AUTH_LINK_REQUESTED, "identity.send_link", (event) =>
  require("./identity.service").sendCredentialLink(event),
);

/*
 * No login without an employee who works here (docs/guides/identity.md §6.1): archiving a
 * record closes its login, ends its sessions and spends its open links. Signing in already
 * refuses it before this runs (identity.repo.js EFFECTIVE_STATUS).
 */
outbox.register("employee.archived", "identity.close_login", (event) =>
  require("./identity.service").closeLoginOf(event),
);

/* Both addresses hear of a move made with Use Work Email. */
outbox.register(EVENTS.APP_USER_EMAIL_CHANGED, "identity.tell_email_changed", (event) =>
  require("./identity.service").tellEmailChanged(event),
);

/* A login nobody has used yet follows its employee's corrected work email (JBS Praxis, 25/10/2026). */
outbox.register("employee.updated", "identity.follow_work_email", (event) =>
  require("./identity.service").followWorkEmail(event),
);

module.exports = { EVENTS };
