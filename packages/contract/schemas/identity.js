"use strict";
/**
 * Identity: signing in and out, the session, the caller's own account, and the
 * credential links (password reset and the first password of an invited person).
 *
 * Sessions follow one policy (docs/guides/identity.md §6): a session lives a fixed
 * time from sign-in whatever the person does, and less if it sits idle; every
 * token ends no later than its session. The access token travels in the body and
 * is held in memory; the refresh token never does: it is an HttpOnly cookie.
 */
const { z } = require("zod");
const { uuid, email, isoDateTime, listQuery, Paged } = require("./common");
const { AppearanceApplied } = require("./appearance");

/** Seconds, whole. */
const seconds = z.number().int().min(0);

/* ------------------------------------------------------------------ *
 * Passwords
 * ------------------------------------------------------------------ */

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

/**
 * A password someone is choosing. The messages are field marks (at most four
 * words). The server also refuses one that contains the name part of the
 * person's email or appears in a known breach; those arrive as a 422 on the field.
 */
const NewPassword = z
  .string()
  .min(PASSWORD_MIN, "At least 8 characters")
  .max(PASSWORD_MAX, "At most 200 characters")
  .refine((v) => /[a-z]/.test(v), "Add a lowercase letter")
  .refine((v) => /[A-Z]/.test(v), "Add an uppercase letter")
  .refine((v) => /[0-9]/.test(v), "Add a number")
  .refine((v) => /[^A-Za-z0-9]/.test(v), "Add a symbol");

/** A password someone is typing to prove who they are: never judged, only bounded. */
const CurrentPassword = z.string().min(1, "Enter your password").max(PASSWORD_MAX);

/** A credential link's token: 32 random bytes, base64url. */
const LinkToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Link is not valid");

/* ------------------------------------------------------------------ *
 * The signed-in person
 * ------------------------------------------------------------------ */

/**
 * A permission key and an action, as the wire carries them. The lists themselves are
 * the access catalogue's (src/shared/access/access.catalog.js); a test holds the
 * action list here equal to it.
 */
const ModuleKey = z.string().regex(/^[a-z][a-z_]*$/);
const ACTIONS = ["view", "create", "edit", "delete", "approve", "export"];
const Action = z.enum(ACTIONS);

/**
 * A capability's code, as stored on `capability.code`: `<area>.<authority>`, two
 * lower_snake segments ("alerts.clear"). The codes are the access catalogue's
 * CAPABILITY_CATALOG; a test holds this rule equal to its own. Declared here, not in
 * access.js, because Me carries the codes and access.js imports this file.
 */
const CAPABILITY_CODE = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;
const CapabilityCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(CAPABILITY_CODE, "Not a capability");

/** Which Home layout the person's role opens (docs/guides/home.md). */
const HomeView = z.enum(["operations", "ceo", "partnerships", "staff"]);

const RoleRef = z.object({ code: z.string(), name: z.string() }).strict();

/** GET /auth/me, and the user inside every session response. */
const Me = z
  .object({
    user_id: uuid,
    employee_id: uuid,
    email: z.string(),
    display_name: z.string(),
    first_name: z.string(),
    job_title: z.string(),
    department: z.string(),
    photo_url: z.string().nullable(),
    is_ceo: z.boolean(),
    /** Module key → the actions the person may take there. Hiding is a courtesy; the API enforces. */
    grants: z.record(ModuleKey, z.array(Action)),
    /**
     * The capabilities the person holds, through a role or given to them, A to Z; the
     * CEO holds every one there is. Opens Home's Team, Alerts and Reports tabs.
     */
    capabilities: z.array(CapabilityCode),
    roles: z.array(RoleRef),
    home_view: HomeView,
    /** Does anyone report to this person? Opens the manager views (My Team, approvals). */
    manages_people: z.boolean(),
    /** Settings · Appearance as every screen of the hub applies it (appearance.js). */
    appearance: AppearanceApplied,
    /**
     * The record fields the person's role hides (gross_monthly, bank_name, date_of_birth...),
     * A to Z, from shared/rbac/field-mask.js: a form leaves them out, and the API refuses them.
     * Empty for the CEO.
     */
    hidden_fields: z.array(z.string()),
  })
  .strict();

/** How long the session has left, so every open tab locks at the same moment. */
const sessionClock = {
  /** Access token life in seconds (never past the session's end). */
  expires_in: seconds,
  /** Seconds until the session ends and the screen locks. */
  session_expires_in: seconds,
  /** The session's full length in seconds. */
  session_max_age: seconds,
  /** Seconds without use after which the screen locks. */
  session_idle_limit: seconds,
};

/* ------------------------------------------------------------------ *
 * Signing in, refreshing, signing out
 * ------------------------------------------------------------------ */

/** POST /auth/login */
const LoginBody = z
  .object({ email, password: CurrentPassword })
  .strict();

/** POST /auth/login. The refresh cookie is set beside it. */
const Session = z
  .object({ access_token: z.string(), ...sessionClock, user: Me })
  .strict();

/**
 * POST /auth/logout. `idle` when the screen locked itself after the idle limit,
 * so the person's sign-in list says why the session ended.
 */
const LogoutBody = z
  .object({ reason: z.enum(["idle"]).optional() })
  .strict();

/** POST /auth/refresh: a new access token for the session the cookie names; the cookie rotates. */
const SessionTokens = z
  .object({ access_token: z.string(), ...sessionClock })
  .strict();

/**
 * GET /auth/device: who this browser last signed in as, so the sign-in screen
 * can greet them and offer their PIN or passkey. Read from an HttpOnly cookie the
 * server set; on its own it grants nothing.
 */
const DeviceAccount = z
  .object({
    account: z
      .object({
        email: z.string(),
        display_name: z.string(),
        first_name: z.string(),
        /** They have a PIN, which signs in on this browser. */
        has_pin: z.boolean(),
        /** They have at least one passkey. */
        has_passkey: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Passwords
 * ------------------------------------------------------------------ */

/** POST /auth/password: the signed-in person replaces their own password. */
const PasswordChange = z
  .object({ current_password: CurrentPassword, new_password: NewPassword })
  .strict();

const PasswordChanged = z
  .object({ sessions_signed_out: z.number().int().min(0) })
  .strict();

/** POST /auth/forgot. Always the same answer, so nobody learns which addresses have an account. */
const ForgotBody = z.object({ email }).strict();
const Accepted = z.object({ ok: z.literal(true) }).strict();

/** POST /auth/link: is this reset or invitation link still good? */
const LinkCheckBody = z.object({ token: LinkToken }).strict();
const LinkCheck = z
  .object({
    purpose: z.enum(["reset", "invite"]),
    email: z.string(),
    first_name: z.string(),
    expires_at: isoDateTime,
  })
  .strict();

/** POST /auth/reset: choose a password from a link. Every session of the account ends. */
const ResetBody = z
  .object({ token: LinkToken, new_password: NewPassword })
  .strict();
const ResetDone = z.object({ email: z.string() }).strict();

/* ------------------------------------------------------------------ *
 * The caller's own sessions (My Security)
 * ------------------------------------------------------------------ */

const SessionStatus = z.enum(["active", "ended"]);
const EndReason = z.enum([
  "signed_out",
  "session_max_age",
  "inactivity_timeout",
  "refresh_token_reuse",
  "password_changed",
  "password_reset",
  "ended_by_user",
  "ended_by_admin",
  "account_suspended",
]);

/**
 * How a session began: the password or the PIN, each with or without the two-step
 * code after it (a recovery code counts as the code), or a passkey, which is both
 * steps at once.
 */
const SignInMethod = z.enum(["password", "password_totp", "pin", "pin_totp", "passkey"]);

/** One sign-in: a session, live or ended. */
const SignIn = z
  .object({
    session_id: uuid,
    device_label: z.string(),
    ip_address: z.string().nullable(),
    method: SignInMethod,
    issued_at: isoDateTime,
    last_seen_at: isoDateTime,
    status: SessionStatus,
    end_reason: EndReason.nullable(),
    /** The session this request came from. */
    current: z.boolean(),
  })
  .strict();

/** GET /auth/sessions: the caller's sign-ins, newest first. */
const SignInListQuery = listQuery({ status: SessionStatus.optional() }, [
  "issued_at",
]);
const SignInPage = Paged(SignIn);

/** POST /auth/sessions/end-others */
const SessionsEnded = z.object({ ended: z.number().int().min(0) }).strict();

/** GET /auth/security: the My Security summary. */
const SecuritySummary = z
  .object({
    password_changed_at: isoDateTime.nullable(),
    active_sessions: z.number().int().min(0),
    session_max_age: seconds,
    session_idle_limit: seconds,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * What the system mails (template variables, BACKEND_STRUCTURE §5.5)
 * ------------------------------------------------------------------ */

/** templates/email/password-reset.html */
const PasswordResetEmailVars = z
  .object({ link_url: z.string().url(), minutes: z.number().int().min(1) })
  .strict();

/** templates/email/user-invite.html */
const UserInviteEmailVars = z
  .object({
    link_url: z.string().url(),
    hours: z.number().int().min(1),
    job_title: z.string(),
    invited_by: z.string(),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  RoleRef: { table: "role" },
  Me: { table: null, reason: "the signed-in person, assembled from app_user, employee, their roles, their capabilities and the grants cache" },
  LoginBody: { table: null, reason: "sign-in credentials, checked and never stored as sent" },
  Session: { table: null, reason: "a new session's tokens and clock, with the signed-in person" },
  SessionTokens: { table: null, reason: "a refreshed access token and the session's clock" },
  LogoutBody: { table: null, reason: "why the client signed out; recorded as user_session.end_reason" },
  DeviceAccount: { table: null, reason: "who last signed in on this browser, read through the device cookie" },
  PasswordChange: { table: null, reason: "the current and the new password; only an Argon2 hash is stored" },
  PasswordChanged: { table: null, reason: "how many other sessions a password change ended" },
  ForgotBody: { table: null, reason: "the email a reset link is asked for" },
  Accepted: { table: null, reason: "the same answer whether or not the email has an account" },
  LinkCheckBody: { table: null, reason: "a link token as the email carried it; only its hash is stored" },
  LinkCheck: {
    table: "password_reset",
    virtual: {
      email: "the login's email (app_user), shown on the page the link opens",
      first_name: "the employee's first name, for the invitation's greeting",
    },
  },
  ResetBody: { table: null, reason: "a link token and the chosen password" },
  ResetDone: { table: null, reason: "the email to sign in with after a password is set" },
  SignIn: {
    table: "user_session",
    virtual: {
      status: "active or ended, derived from killed_at, expires_at and the idle limit",
      current: "whether this is the session making the request",
    },
  },
  SignInListQuery: { table: null, reason: "list controls and the status filter for My Security's sign-ins" },
  SignInPage: { table: null, reason: "a page of sign-ins" },
  SessionsEnded: { table: null, reason: "how many sessions a request ended" },
  SecuritySummary: { table: null, reason: "My Security's figures, counted from app_user and user_session and the session settings" },
  PasswordResetEmailVars: { table: null, reason: "the variables of templates/email/password-reset.html, not a row" },
  UserInviteEmailVars: { table: null, reason: "the variables of templates/email/user-invite.html, not a row" },
};

module.exports = {
  TABLES,
  PASSWORD_MIN,
  PASSWORD_MAX,
  NewPassword,
  CurrentPassword,
  LinkToken,
  ModuleKey,
  ACTIONS,
  Action,
  CAPABILITY_CODE,
  CapabilityCode,
  HomeView,
  RoleRef,
  Me,
  LoginBody,
  Session,
  SessionTokens,
  LogoutBody,
  DeviceAccount,
  PasswordChange,
  PasswordChanged,
  ForgotBody,
  Accepted,
  LinkCheckBody,
  LinkCheck,
  ResetBody,
  ResetDone,
  SessionStatus,
  EndReason,
  SignInMethod,
  SignIn,
  SignInListQuery,
  SignInPage,
  SessionsEnded,
  SecuritySummary,
  PasswordResetEmailVars,
  UserInviteEmailVars,
};
