"use strict";
/**
 * What the security module records, and who is told (loaded by the API and the worker).
 *
 * Every key starts with `auth.`, so its notification is in the Security category
 * (shared/notifications/categories.js): in the bell and by email, and not something a
 * person can switch off. A way to sign in that is added, changed or removed always
 * tells its owner, even when they did it themselves: the point is the line "if this
 * was not you". An administrator resetting someone's two-step is a security event as
 * well, so the CEO and the people who manage Settings are told too.
 *
 * No secret reaches an event: not a key, a code, a PIN or a credential. emit()
 * redacts any field that names one, and none is passed.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");

const EVENTS = defineEvents("settings", {
  "auth.two_step_started": { summary: "Two-step sign-in set-up was started" },
  "auth.two_step_on": { summary: "Two-step sign-in was turned on" },
  "auth.two_step_changed": { summary: "The authenticator app for two-step sign-in was changed" },
  "auth.two_step_off": { summary: "Two-step sign-in was turned off" },
  "auth.two_step_reset": { summary: "Two-step sign-in was reset", security: true },
  "auth.two_step_frequency_set": { summary: "How often two-step sign-in asks was changed" },
  "auth.recovery_codes_renewed": { summary: "New recovery codes were made" },
  "auth.recovery_code_used": { summary: "A recovery code was used to sign in" },
  "auth.passkey_added": { summary: "A passkey was added" },
  "auth.passkey_renamed": { summary: "A passkey was renamed" },
  "auth.passkey_removed": { summary: "A passkey was removed" },
  "auth.pin_set": { summary: "A PIN was set" },
  "auth.pin_changed": { summary: "The PIN was changed" },
  "auth.pin_removed": { summary: "The PIN was removed" },
  "auth.pin_failed": { summary: "A wrong PIN was entered" },
  "auth.pin_throttled": { summary: "Repeated wrong PINs slowed PIN sign-in to an account" },
  "auth.pin_switched_off": { summary: "The PIN was switched off after wrong tries" },
  "auth.reauthenticated": { summary: "A person confirmed it was them before a security change" },
});

/** The person the event is about: its entity is their own account. */
const self = (e) => (e.entity && e.entity.type === "account" ? [e.entity.id] : []);

const notYou = "If this was not you, tell People now.";

/** Tell the owner, high priority, whoever did it. */
function tell(key, title, body) {
  defineNotification(key, { to: [{ users: self }], title, body, priority: "high", include_actor: true, who: "The account holder" });
}

const HOW_OFTEN = {
  every_sign_in: "at every sign-in",
  daily: "once a day on each device",
  monthly: "once a month on each device",
};
const labelOf = (e) => (e.payload && e.payload.label) || "A passkey";

tell(EVENTS.AUTH_TWO_STEP_ON, "Two-step sign-in is on", `Signing in now asks for a code from your authenticator app. ${notYou}`);
tell(EVENTS.AUTH_TWO_STEP_CHANGED, "Your authenticator app changed", `Codes now come from the app you just set up. ${notYou}`);
tell(
  EVENTS.AUTH_TWO_STEP_OFF,
  "Two-step sign-in is off",
  "Signing in no longer asks for a code. If this was not you, change your password and tell People now.",
);
tell(
  EVENTS.AUTH_TWO_STEP_RESET,
  "Two-step sign-in was reset",
  "An administrator removed your authenticator app and signed you out. Set it up again in My Security.",
);
tell(
  EVENTS.AUTH_TWO_STEP_FREQUENCY_SET,
  "Two-step frequency changed",
  (e) => `Two-step now asks ${HOW_OFTEN[e.payload && e.payload.mfa_frequency] || "for a code"}. ${notYou}`,
);
tell(EVENTS.AUTH_RECOVERY_CODES_RENEWED, "New recovery codes", `Your earlier recovery codes no longer work. ${notYou}`);
tell(
  EVENTS.AUTH_RECOVERY_CODE_USED,
  "A recovery code was used",
  (e) =>
    `Someone signed in with one of your recovery codes; ${e.payload && e.payload.codes_left} left. If this was not you, change your password now.`,
);
tell(
  EVENTS.AUTH_PASSKEY_ADDED,
  "Passkey added",
  (e) => `${labelOf(e)} can now sign you in. If this was not you, remove it in My Security and change your password.`,
);
tell(EVENTS.AUTH_PASSKEY_REMOVED, "Passkey removed", (e) => `${labelOf(e)} can no longer sign you in. ${notYou}`);
tell(
  EVENTS.AUTH_PIN_SET,
  "PIN set",
  "Your PIN now unlocks the app and signs you in on your devices. If this was not you, remove it in My Security.",
);
tell(
  EVENTS.AUTH_PIN_CHANGED,
  "PIN changed",
  "Your old PIN no longer works. If this was not you, remove it in My Security and change your password.",
);
tell(EVENTS.AUTH_PIN_REMOVED, "PIN removed", `Your PIN no longer signs you in. ${notYou}`);
tell(
  EVENTS.AUTH_PIN_THROTTLED,
  "Several wrong PINs on your account",
  "Each try now waits longer. If this was not you, change your password.",
);
tell(
  EVENTS.AUTH_PIN_SWITCHED_OFF,
  "Your PIN was switched off",
  "Too many wrong PINs were entered. Sign in with your password, then set a new PIN. If this was not you, change your password.",
);

module.exports = { EVENTS, HOW_OFTEN };
