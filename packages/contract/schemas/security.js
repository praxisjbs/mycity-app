"use strict";
/**
 * Security: the ways a person proves who they are besides the password, and
 * proving it again before changing them (docs/guides/identity.md).
 *
 *   two-step sign-in  a 6-digit code from an authenticator app after the password
 *                     or the PIN, on a device that has not proved one recently;
 *                     ten recovery codes stand in for a lost phone, once each
 *   passkeys          the device's fingerprint, face or screen lock, signing in
 *                     without the password; both steps at once, so no code after it
 *   the PIN           four digits that unlock the lock screen and sign in on a
 *                     browser the person has signed in on before
 *
 * Adding or removing any of them needs a fresh sign-in: within the window after
 * signing in it is allowed, past it the person confirms with the password, a
 * passkey or the PIN first (403 REAUTH_REQUIRED until they do).
 *
 * WebAuthn's own JSON (creation and request options, the browser's responses) is
 * the W3C's, camelCase, and passes through untouched as `WebAuthnJson`: the server
 * library builds and checks it, and nothing here renames it.
 */
const { z } = require("zod");
const { uuid, email, text, isoDateTime, Paged } = require("./common");
const { CurrentPassword, Session } = require("./identity");

/** Seconds, whole. */
const seconds = z.number().int().min(0);

/* ------------------------------------------------------------------ *
 * The PIN
 * ------------------------------------------------------------------ */

const PIN_LENGTH = 4;

/** Codes that top every published list of real PINs beyond the shapes weakPinReason refuses. */
const COMMON_PINS = new Set(["1004", "2000", "2001", "1998", "1999", "2468", "1357", "2580"]);

/**
 * Why a new PIN is refused, as a field mark (at most four words), or null when it
 * is fine. One rule for the form and the API. Four digits are 10,000 codes, and
 * people reach for the same few first, so the shapes they reach for are refused.
 * The server also passes the person's date of birth (ISO), which the form does not
 * have: a birthday is the first thing someone who knows them would try.
 * @param {string} pin
 * @param {{birthDate?: string|null}} [opts]
 * @returns {string|null}
 */
function weakPinReason(pin, { birthDate = null } = {}) {
  const p = pin === null || pin === undefined ? "" : String(pin);
  if (!/^\d{4}$/.test(p)) return "Enter 4 digits";
  const d = p.split("").map(Number);
  if (d.every((x) => x === d[0])) return "Not one digit repeated";
  const up = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  const down = d.every((x, i) => i === 0 || x === d[i - 1] - 1);
  if (up || down) return "Not a run like 1234";
  if (d[0] === d[2] && d[1] === d[3]) return "Not a repeated pair";
  if (d[0] === d[1] && d[2] === d[3]) return "Not two doubles";
  if (COMMON_PINS.has(p)) return "Too common";
  const born = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthDate || ""));
  if (born) {
    const [, year, month, day] = born;
    if ([`${day}${month}`, `${month}${day}`, year].includes(p)) return "Not your birthday";
  }
  return null;
}

/** A PIN someone types to prove who they are: four digits, never judged. */
const Pin = z.string().regex(/^\d{4}$/, "Enter 4 digits");

/** A PIN someone is choosing. The server also refuses their birthday. */
const NewPin = z.string().superRefine((v, ctx) => {
  const why = weakPinReason(v);
  if (why) ctx.addIssue({ code: z.ZodIssueCode.custom, message: why });
});

/* ------------------------------------------------------------------ *
 * Two-step sign-in
 * ------------------------------------------------------------------ */

/** How often a device is asked for the code: every sign-in, or once a day or a month per device. */
const TwoStepFrequency = z.enum(["every_sign_in", "daily", "monthly"]);

/** The authenticator app's code. */
const TotpCode = z
  .string()
  .transform((v) => v.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter 6 digits"));

/**
 * What the code step takes: the authenticator's six digits, or a recovery code
 * (ten letters and numbers, typed with or without its dash). The server decides
 * which by its shape.
 */
const SecondStepCode = z
  .string()
  .trim()
  .min(1, "Enter the code")
  .max(20, "Check the code");

/** The ticket that carries a person from one step of signing in to the next. Signed, short-lived, used once. */
const ChallengeToken = z.string().min(20).max(4096);

/** POST /security/two-step/setup: what the authenticator app needs. Nothing is on until a code proves it. */
const TwoStepSetup = z
  .object({
    /** The key, for typing in by hand: base32, in groups of four. */
    secret: z.string(),
    /** The otpauth:// address the QR code carries. */
    otpauth_url: z.string(),
    /** The QR code, as a data URL for an <img>. */
    qr_code: z.string(),
    /** Seconds the set-up waits for its first code. */
    expires_in: seconds,
  })
  .strict();

/** POST /security/two-step: the first code from the app turns two-step on. */
const TwoStepTurnOn = z.object({ code: TotpCode }).strict();

/** Ten recovery codes, shown once: on turning two-step on and on asking for new ones. */
const RecoveryCodes = z
  .object({ recovery_codes: z.array(z.string()).length(10) })
  .strict();

/** POST /security/two-step/frequency */
const TwoStepFrequencySet = z.object({ mfa_frequency: TwoStepFrequency }).strict();

/* ------------------------------------------------------------------ *
 * Passkeys
 * ------------------------------------------------------------------ */

/** The W3C's WebAuthn JSON, passed to and from the browser untouched. */
const WebAuthnJson = z.record(z.string(), z.unknown());

/** A passkey ceremony: its ticket, and the options the browser is handed. */
const PasskeyChallenge = z
  .object({ challenge_token: z.string(), options: WebAuthnJson })
  .strict();

/** A label a person gives a passkey ("Work laptop"). */
const PasskeyLabel = text(60);

/** One of the person's passkeys, as My Security lists it. Never the key itself. */
const Passkey = z
  .object({
    passkey_id: uuid,
    label: z.string(),
    /** Synced to the person's other devices by their password manager. */
    backed_up: z.boolean(),
    created_at: isoDateTime,
    last_used_at: isoDateTime.nullable(),
    /** Added on the browser this request came from. */
    this_device: z.boolean(),
  })
  .strict();

const PasskeyPage = Paged(Passkey);

/** POST /security/passkeys: the browser's answer to the options, and an optional name. */
const PasskeyAdd = z
  .object({
    challenge_token: ChallengeToken,
    credential: WebAuthnJson,
    label: PasskeyLabel.optional(),
  })
  .strict();

/** POST /security/passkeys/:id/rename */
const PasskeyRename = z.object({ label: PasskeyLabel }).strict();

/* ------------------------------------------------------------------ *
 * The PIN, set and removed
 * ------------------------------------------------------------------ */

/** POST /security/pin: set or change the PIN. */
const PinSet = z.object({ pin: NewPin }).strict();

/* ------------------------------------------------------------------ *
 * The person's own methods, and proving it is them again
 * ------------------------------------------------------------------ */

/** GET /security: what My Security shows about how the person signs in. */
const SignInMethods = z
  .object({
    two_step: z
      .object({
        on: z.boolean(),
        mfa_frequency: TwoStepFrequency,
        mfa_enrolled_at: isoDateTime.nullable(),
        recovery_codes_left: z.number().int().min(0),
        /** A role this person holds requires two-step sign-in, so it cannot be turned off. */
        required: z.boolean(),
      })
      .strict(),
    /** How many passkeys can sign in as this person. */
    passkeys: z.number().int().min(0),
    pin: z
      .object({ on: z.boolean(), pin_changed_at: isoDateTime.nullable() })
      .strict(),
    /** Seconds left in which a way to sign in may be added or removed without confirming again. */
    confirmed_for: seconds,
  })
  .strict();

/**
 * POST /security/confirm: prove it is still you, with any one way in. Opens the
 * window again, so the change that asked for it can go ahead.
 */
const Confirm = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), password: CurrentPassword }).strict(),
  z.object({ method: z.literal("pin"), pin: Pin }).strict(),
  z
    .object({ method: z.literal("passkey"), challenge_token: ChallengeToken, credential: WebAuthnJson })
    .strict(),
]);

const Confirmed = z.object({ confirmed_for: seconds }).strict();

/* ------------------------------------------------------------------ *
 * Signing in with them (the /auth routes)
 * ------------------------------------------------------------------ */

/** The first step passed and two-step asks for a code: a ticket for the code step, never a session. */
const CodeRequired = z
  .object({
    step: z.literal("code"),
    challenge_token: z.string(),
    /** Seconds the ticket lasts. */
    expires_in: seconds,
  })
  .strict();

/**
 * The first step passed, two-step is off, and a role the person holds requires it:
 * a ticket for setting it up, never a session. The session opens once the app's
 * first code proves the new key (POST /auth/two-step/enrol).
 */
const SetupRequired = z
  .object({
    step: z.literal("setup"),
    challenge_token: z.string(),
    /** Seconds the ticket lasts. */
    expires_in: seconds,
  })
  .strict();

/** POST /auth/login and POST /auth/pin: a session, the code step, or the set-up step first. */
const SignInResult = z.union([Session, CodeRequired, SetupRequired]);

/** POST /auth/two-step/setup: the set-up step's ticket; answers with the key to scan. */
const SetupStart = z.object({ challenge_token: ChallengeToken }).strict();

/** POST /auth/two-step/enrol: the ticket and the app's first code. */
const SetupFinish = z.object({ challenge_token: ChallengeToken, code: TotpCode }).strict();

/** A session opened by setting two-step up, with the recovery codes shown this once. */
const EnrolledSession = Session.extend({ recovery_codes: z.array(z.string()).length(10) }).strict();

/** POST /auth/two-step */
const CodeStep = z
  .object({ challenge_token: ChallengeToken, code: SecondStepCode })
  .strict();

/** POST /auth/pin: on a browser the person has signed in on before. */
const PinSignIn = z.object({ email, pin: Pin }).strict();

/**
 * POST /auth/passkey/options. With an email (the lock screen, a known browser),
 * only that person's passkey can finish the ceremony.
 */
const PasskeyStart = z.object({ email: email.optional() }).strict();

/** POST /auth/passkey */
const PasskeySignIn = z
  .object({ challenge_token: ChallengeToken, credential: WebAuthnJson })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  TwoStepSetup: { table: null, reason: "a new authenticator key and its QR code; only the encrypted key is stored, as app_user.mfa_pending_secret_enc" },
  TwoStepTurnOn: { table: null, reason: "the first code from the app; it proves the pending key and is never stored" },
  RecoveryCodes: { table: null, reason: "the recovery codes in plain text, shown once; mfa_recovery_code keeps only their hashes" },
  TwoStepFrequencySet: { table: "app_user" },
  PasskeyChallenge: { table: null, reason: "a signed ceremony ticket and the browser's WebAuthn options; nothing is stored until the answer is verified" },
  Passkey: { table: "passkey", virtual: { this_device: "whether passkey.known_device_id is the device of the session asking" } },
  PasskeyPage: { table: null, reason: "a page of passkeys" },
  PasskeyAdd: { table: null, reason: "the browser's registration answer; the passkey row is built from the verified credential" },
  PasskeyRename: { table: "passkey" },
  PinSet: { table: null, reason: "a PIN being chosen; only its Argon2 hash is stored, as app_user.pin_hash" },
  SignInMethods: { table: null, reason: "My Security's view of two-step, passkeys and the PIN, read from app_user, mfa_recovery_code and passkey" },
  Confirmed: { table: null, reason: "how long the confirmed window lasts; user_session.reauthenticated_at records it" },
  CodeRequired: { table: null, reason: "the code step's ticket after the first step; no session exists yet" },
  CodeStep: { table: null, reason: "a code-step ticket and the code typed; neither is stored" },
  SetupRequired: { table: null, reason: "the set-up step's ticket after the first step; no session exists yet" },
  SetupStart: { table: null, reason: "a set-up ticket; the new key is stored encrypted as app_user.mfa_pending_secret_enc" },
  SetupFinish: { table: null, reason: "a set-up ticket and the app's first code; neither is stored" },
  EnrolledSession: { table: null, reason: "a new session's tokens and clock, with the recovery codes in plain text shown once" },
  PinSignIn: { table: null, reason: "sign-in with an email and a PIN, checked against app_user.pin_hash" },
  PasskeyStart: { table: null, reason: "the email a passkey sign-in is bound to, when there is one" },
  PasskeySignIn: { table: null, reason: "a ceremony ticket and the browser's signed answer; neither is stored" },
};

module.exports = {
  TABLES,
  PIN_LENGTH,
  weakPinReason,
  Pin,
  NewPin,
  TwoStepFrequency,
  TotpCode,
  SecondStepCode,
  ChallengeToken,
  TwoStepSetup,
  TwoStepTurnOn,
  RecoveryCodes,
  TwoStepFrequencySet,
  WebAuthnJson,
  PasskeyChallenge,
  PasskeyLabel,
  Passkey,
  PasskeyPage,
  PasskeyAdd,
  PasskeyRename,
  PinSet,
  SignInMethods,
  Confirm,
  Confirmed,
  CodeRequired,
  SetupRequired,
  SignInResult,
  SetupStart,
  SetupFinish,
  EnrolledSession,
  CodeStep,
  PinSignIn,
  PasskeyStart,
  PasskeySignIn,
};
