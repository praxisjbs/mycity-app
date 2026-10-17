import type { Passkey, SignInMethods } from "@mycity/contract/contract.gen.ts";
import { at, created, fail, invalid, notFound, ok, paged, route, uuid } from "../core";
import { byKey } from "../data/people";

/**
 * Security, as packages/contract/schemas/security.js describes it: each
 * demonstration account's two-step sign-in, PIN and passkeys, which My Security
 * changes and the sign-in mock reads. Cynthia and Ifeoma have two-step on; this
 * browser has already given Cynthia's code today, so only Ifeoma's sign-in asks
 * for one. Any six digits pass but 000000; a recovery code is any ten letters
 * and numbers. Passkeys are this browser's own: the mock keeps their ids and
 * checks nothing else. Adding or removing a way in needs a sign-in or a
 * confirmation in the last 15 minutes, as on the server.
 */

type Frequency = SignInMethods["two_step"]["mfa_frequency"];
type MockPasskey = Passkey & { credential_id: string };

export interface MockWays {
  twoStep: { on: boolean; frequency: Frequency; since: string | null; codesLeft: number; trustedUntil: number };
  pin: { value: string | null; changed: string | null };
  passkeys: MockPasskey[];
}

const DAY = 86_400_000;
const WINDOW_MS = 15 * 60_000;
const TRUST_DAYS: Record<Frequency, number> = { every_sign_in: 0, daily: 1, monthly: 30 };

const ways: Record<string, MockWays> = {};

/** One account's ways in (made on first use). */
export function waysOf(key: string): MockWays {
  if (!ways[key]) {
    const on = key === "cynthia" || key === "ifeoma";
    ways[key] = {
      twoStep: { on, frequency: "daily", since: on ? at(40, "09:10") : null, codesLeft: on ? 10 : 0, trustedUntil: key === "cynthia" ? Date.now() + DAY : 0 },
      pin: { value: null, changed: null },
      passkeys: [],
    };
  }
  return ways[key];
}

/** Whose passkey this browser answer names, if any. */
export function passkeyOwner(credentialId: string): { key: string; passkey: MockPasskey } | null {
  for (const [key, w] of Object.entries(ways)) {
    const passkey = w.passkeys.find((p) => p.credential_id === credentialId);
    if (passkey) return { key, passkey };
  }
  return null;
}

/* ───── the window after signing in ───── */

const freshUntil: Record<string, number> = {};
/** A sign-in or a confirmation opens the window. */
export const markFresh = (key: string) => {
  freshUntil[key] = Date.now() + WINDOW_MS;
};
const freshFor = (key: string) => Math.max(0, Math.floor(((freshUntil[key] ?? 0) - Date.now()) / 1000));
const stale = (key: string) => (freshFor(key) > 0 ? null : fail(403, "REAUTH_REQUIRED", "Confirm it is you to continue."));

/* ───── the code step ───── */

/** A browser that just gave a code is trusted for the person's chosen time. */
export function codeGiven(key: string) {
  const t = waysOf(key).twoStep;
  t.trustedUntil = TRUST_DAYS[t.frequency] ? Date.now() + TRUST_DAYS[t.frequency] * DAY : 0;
}
export const needsCode = (key: string) => {
  const t = waysOf(key).twoStep;
  return t.on && t.trustedUntil < Date.now();
};
/** Six digits (but 000000), or a recovery code while any are left. */
export function codeOk(key: string, code: string): boolean {
  const t = waysOf(key).twoStep;
  const plain = code.replace(/\s+/g, "");
  if (/^\d{6}$/.test(plain)) return plain !== "000000";
  if (code.replace(/[^A-Za-z0-9]/g, "").length === 10 && t.codesLeft > 0) {
    t.codesLeft -= 1;
    return true;
  }
  return false;
}

/* ───── what My Security shows ───── */

function methodsOf(key: string): SignInMethods {
  const w = waysOf(key);
  return {
    two_step: { on: w.twoStep.on, required: false, mfa_frequency: w.twoStep.frequency, mfa_enrolled_at: w.twoStep.since, recovery_codes_left: w.twoStep.on ? w.twoStep.codesLeft : 0 },
    passkeys: w.passkeys.length,
    pin: { on: !!w.pin.value, pin_changed_at: w.pin.changed },
    confirmed_for: freshFor(key),
  };
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const draw = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
const recoveryCodes = () => Array.from({ length: 10 }, () => `${draw(RECOVERY, 5)}-${draw(RECOVERY, 5)}`);
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomB64u = (n: number) => b64u(crypto.getRandomValues(new Uint8Array(n)));

/** A QR-like picture: the mock has no QR encoder, so an app cannot scan it. */
function pictureOf(seed: string): string {
  const n = 21;
  const finder = (x: number, y: number) => {
    const inBox = (ox: number, oy: number) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
    const box = inBox(0, 0) ? [0, 0] : inBox(n - 7, 0) ? [n - 7, 0] : inBox(0, n - 7) ? [0, n - 7] : null;
    if (!box) return null;
    const dx = x - box[0];
    const dy = y - box[1];
    return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
  };
  let cells = "";
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const f = finder(x, y);
      const on = f === null ? (seed.charCodeAt((x * 7 + y * 13) % seed.length) + x * y) % 3 === 0 : f;
      if (on) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 25 25"><rect x="-2" y="-2" width="25" height="25" fill="white"/>${cells}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/* ───── routes ───── */

route("GET /api/v1/security", (req) => ok(methodsOf(req.user!)));

let pendingKey: Record<string, boolean> = {};

route("POST /api/v1/security/two-step/setup", (req) => {
  const key = req.user!;
  const refused = stale(key);
  if (refused) return refused;
  pendingKey = { ...pendingKey, [key]: true };
  const secret = draw(BASE32, 32);
  const email = byKey(key)!.work_email;
  return ok({
    secret: secret.match(/.{4}/g)!.join(" "),
    otpauth_url: `otpauth://totp/MyCity%20App:${encodeURIComponent(email)}?secret=${secret}&issuer=MyCity%20App`,
    qr_code: pictureOf(secret),
    expires_in: 900,
  });
});

route("POST /api/v1/security/two-step", (req) => {
  const key = req.user!;
  if (!pendingKey[key]) return fail(422, "SETUP_EXPIRED", "The set-up has expired. Start again.", { code: ["Set-up expired"] });
  const code = String(req.body.code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code) || code === "000000") return fail(422, "INVALID_CODE", "That code is not right.", { code: ["Not the right code"] });
  pendingKey = { ...pendingKey, [key]: false };
  const t = waysOf(key).twoStep;
  Object.assign(t, { on: true, since: t.since ?? new Date().toISOString(), codesLeft: 10, trustedUntil: 0 });
  return ok({ recovery_codes: recoveryCodes() });
});

route("POST /api/v1/security/two-step/off", (req) => {
  const key = req.user!;
  const refused = stale(key);
  if (refused) return refused;
  const t = waysOf(key).twoStep;
  if (!t.on) return fail(422, "TWO_STEP_OFF", "Two-step sign-in is not on.");
  Object.assign(t, { on: false, since: null, codesLeft: 0, trustedUntil: 0 });
  return ok(methodsOf(key));
});

route("POST /api/v1/security/two-step/recovery-codes", (req) => {
  const key = req.user!;
  const refused = stale(key);
  if (refused) return refused;
  const t = waysOf(key).twoStep;
  if (!t.on) return fail(422, "TWO_STEP_OFF", "Two-step sign-in is not on.");
  t.codesLeft = 10;
  return ok({ recovery_codes: recoveryCodes() });
});

route("POST /api/v1/security/two-step/frequency", (req) => {
  const key = req.user!;
  const refused = stale(key);
  if (refused) return refused;
  const t = waysOf(key).twoStep;
  const f = String(req.body.mfa_frequency ?? "") as Frequency;
  if (!(f in TRUST_DAYS)) return invalid({ mfa_frequency: ["Choose one"] });
  if (!t.on) return fail(422, "TWO_STEP_OFF", "Two-step sign-in is not on.");
  if (t.frequency !== f) Object.assign(t, { frequency: f, trustedUntil: 0 });
  return ok(methodsOf(key));
});

/** The server names a passkey after the browser it was added on; the mock does the same, roughly. */
const browserLabel = () => {
  const ua = navigator.userAgent;
  const system = /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "this computer";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : "Safari";
  return `${browser} on ${system}`;
};

const publicOf = ({ credential_id: _id, ...p }: MockPasskey): Passkey => {
  void _id;
  return p;
};

route("GET /api/v1/security/passkeys", (req) => paged(waysOf(req.user!).passkeys.map(publicOf), req));

route("POST /api/v1/security/passkeys/options", (req) => {
  const key = req.user!;
  const refused = stale(key);
  if (refused) return refused;
  const p = byKey(key)!;
  const w = waysOf(key);
  if (w.passkeys.length >= 10) return fail(422, "PASSKEY_LIMIT", "You have 10 passkeys. Remove one first.");
  return ok({
    challenge_token: `mock-passkey-add.${key}`,
    options: {
      challenge: randomB64u(32),
      rp: { name: "MyCity App", id: location.hostname },
      user: { id: b64u(new TextEncoder().encode(p.employee_id)), name: p.work_email, displayName: p.display_name },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      timeout: 90000,
      attestation: "none",
      excludeCredentials: w.passkeys.map((x) => ({ id: x.credential_id, type: "public-key" })),
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
    },
  });
});

route("POST /api/v1/security/passkeys", (req) => {
  const key = req.user!;
  const credential = (req.body.credential ?? {}) as { id?: string };
  if (!credential.id || req.body.challenge_token !== `mock-passkey-add.${key}`) return fail(400, "CHALLENGE_EXPIRED", "This request has expired. Start again.");
  if (passkeyOwner(credential.id)) return fail(409, "PASSKEY_TAKEN", "This passkey is already added.");
  const row: MockPasskey = {
    passkey_id: uuid(),
    credential_id: credential.id,
    label: String(req.body.label ?? "").trim() || browserLabel(),
    backed_up: false,
    created_at: new Date().toISOString(),
    last_used_at: null,
    this_device: true,
  };
  waysOf(key).passkeys.unshift(row);
  return created(publicOf(row));
});

route("POST /api/v1/security/passkeys/:id/rename", (req) => {
  const p = waysOf(req.user!).passkeys.find((x) => x.passkey_id === req.params.id);
  if (!p) return notFound();
  const label = String(req.body.label ?? "").trim();
  if (!label) return invalid({ label: ["Required"] });
  p.label = label.slice(0, 60);
  return ok(publicOf(p));
});

route("POST /api/v1/security/passkeys/:id/remove", (req) => {
  const key = req.user!;
  const refused = stale(key);
  if (refused) return refused;
  const w = waysOf(key);
  if (!w.passkeys.some((x) => x.passkey_id === req.params.id)) return notFound();
  w.passkeys = w.passkeys.filter((x) => x.passkey_id !== req.params.id);
  return ok(methodsOf(key));
});

route("POST /api/v1/security/pin", (req) => {
  const key = req.user!;
  const pin = String(req.body.pin ?? "");
  if (!/^\d{4}$/.test(pin)) return invalid({ pin: ["Enter 4 digits"] });
  const refused = stale(key);
  if (refused) return refused;
  const w = waysOf(key);
  w.pin = { value: pin, changed: new Date().toISOString() };
  return ok(methodsOf(key));
});

route("POST /api/v1/security/pin/remove", (req) => {
  const key = req.user!;
  const refused = stale(key);
  if (refused) return refused;
  const w = waysOf(key);
  if (!w.pin.value) return fail(422, "PIN_OFF", "No PIN is set.");
  w.pin = { value: null, changed: null };
  return ok(methodsOf(key));
});

route("POST /api/v1/security/confirm/options", (req) => {
  const w = waysOf(req.user!);
  if (!w.passkeys.length) return fail(422, "NO_PASSKEY", "You have no passkey. Use your password or PIN.");
  return ok({
    challenge_token: `mock-passkey-confirm.${req.user}`,
    options: {
      challenge: randomB64u(32),
      rpId: location.hostname,
      timeout: 90000,
      userVerification: "required",
      allowCredentials: w.passkeys.map((p) => ({ id: p.credential_id, type: "public-key" })),
    },
  });
});

route("POST /api/v1/security/confirm", (req) => {
  const key = req.user!;
  const w = waysOf(key);
  const b = req.body as { method?: string; password?: string; pin?: string; credential?: { id?: string } };
  if (b.method === "password" && String(b.password ?? "").length < 8)
    return fail(422, "INVALID_CURRENT_PASSWORD", "That is not your password.", { password: ["Not your password"] });
  if (b.method === "pin" && (!w.pin.value || b.pin !== w.pin.value)) return fail(422, "INVALID_PIN", "That PIN is not right.", { pin: ["Not the right PIN"] });
  if (b.method === "passkey" && passkeyOwner(String(b.credential?.id ?? ""))?.key !== key)
    return fail(422, "PASSKEY_NOT_YOURS", "Use one of your own passkeys.");
  markFresh(key);
  return ok({ confirmed_for: freshFor(key) });
});
