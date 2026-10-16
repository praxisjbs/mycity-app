"use strict";
/**
 * Security's rules that need no database: the authenticator's codes and their single
 * use, the recovery codes, which PINs are refused and what wrong PINs cost, the
 * tickets between steps, and passkey ceremonies checked for real against a software
 * authenticator. The flows run against Postgres in tests/integration/security.test.js.
 */
const c = require("@mycity/contract");
const { parseEnv } = require("../../config/env");
const { verifyAccessToken } = require("../../middleware/auth");
const qr = require("../../services/qr/qr");
const { softAuthenticator } = require("../../../tests/helpers/soft-authenticator");
const challenge = require("./security.challenge");
const mfa = require("./security.mfa");
const passkeys = require("./security.passkeys");
const pin = require("./security.pin");

describe("the authenticator's codes", () => {
  const key = mfa.newKey();

  test("a new key is 20 random bytes in base32, grouped in fours for typing", () => {
    expect(key).toMatch(/^[A-Z2-7]{32}$/);
    expect(mfa.groupKey("ABCDEFGHIJKL")).toBe("ABCD EFGH IJKL");
    expect(mfa.newKey()).not.toBe(key);
  });

  test("codes are RFC 6238's: its SHA-1 test vectors, six digits", () => {
    // The RFC's key is the ASCII "12345678901234567890"; its codes are eight digits, ours the last six.
    const rfcKey = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const vectors = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
      [20000000000, "353130"],
    ];
    for (const [seconds, code] of vectors) expect(mfa.codeAt(rfcKey, seconds * 1000)).toBe(code);
  });

  test("one step either side of now counts, two does not", () => {
    const now = 1_800_000_000_000;
    const at = (offset) => mfa.codeAt(key, now + offset * 30_000);
    expect(mfa.checkCode(key, at(-1), null, now)).toEqual({ ok: true, step: 59_999_999 });
    expect(mfa.checkCode(key, at(1), null, now)).toEqual({ ok: true, step: 60_000_001 });
    const twoBack = at(-2);
    if (![at(-1), at(0), at(1)].includes(twoBack)) expect(mfa.checkCode(key, twoBack, null, now)).toEqual({ ok: false });
  });

  test("the address an app scans names MyCity App and the person", () => {
    const url = mfa.otpauthUrl("ada@mycity.test", key);
    expect(url).toBe(`otpauth://totp/MyCity%20App:ada%40mycity.test?secret=${key}&issuer=MyCity%20App`);
  });

  test("the current code works, spaces and all; a wrong one does not", () => {
    const code = mfa.codeAt(key);
    const ok = mfa.checkCode(key, `${code.slice(0, 3)} ${code.slice(3)}`);
    expect(ok).toEqual({ ok: true, step: expect.any(Number) });
    expect(mfa.checkCode(key, code === "000000" ? "111111" : "000000")).toEqual({ ok: false });
    expect(mfa.checkCode(key, "12345")).toEqual({ ok: false });
    expect(mfa.checkCode("not a key!", code)).toEqual({ ok: false });
  });

  test("a code works once: the same step is refused after it was taken", () => {
    const code = mfa.codeAt(key);
    const first = mfa.checkCode(key, code);
    expect(first.ok).toBe(true);
    expect(mfa.checkCode(key, code, first.step)).toEqual({ ok: false });
    expect(mfa.checkCode(key, code, first.step - 2).ok).toBe(true);
  });

  test("the code step tells the app's code from a recovery code by its shape", () => {
    expect(mfa.kindOf("123456")).toBe("totp");
    expect(mfa.kindOf("123 456")).toBe("totp");
    expect(mfa.kindOf("abcde-fghjk")).toBe("recovery");
    expect(mfa.kindOf("ABCDEFGHJK")).toBe("recovery");
    expect(mfa.kindOf("12345")).toBeNull();
    expect(mfa.kindOf("")).toBeNull();
  });
});

describe("recovery codes", () => {
  test("ten codes, grouped, from characters nobody misreads; each hash matches its own code only", async () => {
    const { codes, hashes } = await mfa.newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
    const rows = hashes.map((h, i) => ({ mfa_recovery_code_id: `r${i}`, code_hash: h }));
    // Typed back in lower case, without the dash, with spaces: still the same code.
    const typed = ` ${codes[3].toLowerCase().replace("-", "")} `;
    expect(await mfa.matchRecovery(rows, typed)).toEqual(rows[3]);
    expect(await mfa.matchRecovery(rows.filter((r) => r.mfa_recovery_code_id !== "r3"), typed)).toBeNull();
    expect(await mfa.matchRecovery(rows, "ABCDE")).toBeNull();
  });
});

describe("which PINs are refused", () => {
  const why = c.security.weakPinReason;

  test("four digits, and not the shapes people reach for first", () => {
    expect(why("2958")).toBeNull();
    expect(why("123")).toBe("Enter 4 digits");
    expect(why("12a4")).toBe("Enter 4 digits");
    expect(why("0000")).toBe("Not one digit repeated");
    expect(why("1234")).toBe("Not a run like 1234");
    expect(why("9876")).toBe("Not a run like 1234");
    expect(why("1212")).toBe("Not a repeated pair");
    expect(why("1122")).toBe("Not two doubles");
    expect(why("2580")).toBe("Too common");
  });

  test("not the person's birthday, either way round, nor their year", () => {
    const birthDate = "1991-03-27";
    expect(why("2703", { birthDate })).toBe("Not your birthday");
    expect(why("0327", { birthDate })).toBe("Not your birthday");
    expect(why("1991", { birthDate })).toBe("Not your birthday");
    expect(why("2704", { birthDate })).toBeNull();
  });

  test("the form gets the same rule from the contract, every mark four words at most", () => {
    expect(c.security.NewPin.safeParse("1234").success).toBe(false);
    expect(c.security.NewPin.safeParse("2958").success).toBe(true);
    for (const p of ["123", "0000", "1234", "1212", "1122", "2580", "2703"]) {
      const mark = why(p, { birthDate: "1991-03-27" });
      expect(mark.split(" ").filter((w) => /[A-Za-z]/.test(w)).length).toBeLessThanOrEqual(4);
    }
  });
});

describe("what wrong PINs cost", () => {
  const row = (n, secondsAgo, now = 1_000_000_000) => ({
    pin_failed_count: n,
    pin_last_failed_at: new Date(now - secondsAgo * 1000),
  });

  test("like a wrong password: five free, then each wait doubles", () => {
    expect(pin.waitSeconds(row(5, 0, 1e9), 1e9)).toBe(0);
    expect(pin.waitSeconds(row(6, 0, 1e9), 1e9)).toBe(2);
    expect(pin.waitSeconds(row(8, 0, 1e9), 1e9)).toBe(8);
    expect(pin.waitSeconds(row(8, 9, 1e9), 1e9)).toBe(0);
  });

  test("10 wrong in a row, or 20 in 30 days, switch the PIN off", () => {
    expect(pin.switchesOff({ pin_failed_count: 9, pin_window_failures: 19 })).toBe(false);
    expect(pin.switchesOff({ pin_failed_count: 10, pin_window_failures: 10 })).toBe(true);
    expect(pin.switchesOff({ pin_failed_count: 2, pin_window_failures: 20 })).toBe(true);
    expect(pin.triesLeft({ pin_failed_count: 7, pin_window_failures: 7 })).toBe(3);
    expect(pin.triesLeft({ pin_failed_count: 1, pin_window_failures: 18 })).toBe(2);
  });
});

describe("tickets between steps", () => {
  test("a ticket reads back for its own purpose only", () => {
    const token = challenge.issue("two_step", { sub: "u1", via: "password" });
    expect(challenge.read(token, "two_step")).toEqual(expect.objectContaining({ sub: "u1", via: "password", purpose: "two_step", jti: expect.any(String) }));
    expect(() => challenge.read(token, "passkey_sign_in")).toThrow(expect.objectContaining({ code: "CHALLENGE_EXPIRED" }));
    expect(() => challenge.read(`${token}x`, "two_step")).toThrow(expect.objectContaining({ code: "CHALLENGE_EXPIRED" }));
    expect(() => challenge.read("", "two_step")).toThrow(expect.objectContaining({ code: "CHALLENGE_EXPIRED" }));
  });

  test("a ticket never passes for a session's access token", () => {
    const token = challenge.issue("two_step", { sub: "u1", via: "password" });
    expect(() => verifyAccessToken(token)).toThrow();
  });

  test("an unknown purpose is a programming error", () => {
    expect(() => challenge.issue("anything")).toThrow(/unknown purpose/);
  });
});

describe("passkey ceremonies", () => {
  const origin = "http://localhost:5173";
  const user = { userId: "11111111-1111-4111-8111-111111111111", email: "ada@mycity.test", displayName: "Ada Obi" };

  async function made(device) {
    const options = await passkeys.creationOptions({ ...user, exclude: [] });
    const out = await passkeys.checkCreation({ credential: device.create(options), challenge: options.challenge });
    return { credential_id: out.credentialId, public_key: out.publicKey, sign_count: out.signCount, transports: out.transports };
  }

  test("creation asks for a discoverable key unlocked by the person, and excludes their passkeys", async () => {
    const options = await passkeys.creationOptions({ ...user, exclude: [{ credential_id: "abcdefghijklmnopqrstuv", transports: ["internal"] }] });
    expect(options.rp).toEqual({ name: "MyCity App", id: "localhost" });
    expect(options.authenticatorSelection).toEqual(expect.objectContaining({ residentKey: "required", userVerification: "required" }));
    expect(options.excludeCredentials).toEqual([expect.objectContaining({ id: "abcdefghijklmnopqrstuv" })]);
    expect(options.attestation).toBe("none");
  });

  test("a passkey made and used checks out, and its counter goes up", async () => {
    const device = softAuthenticator({ origin, rpId: "localhost" });
    const stored = await made(device);
    const req = await passkeys.requestOptions();
    expect(req.userVerification).toBe("required");
    expect(req.allowCredentials).toBeUndefined();
    const count = await passkeys.checkAssertion({ credential: device.get(req), challenge: req.challenge, stored });
    expect(count).toBe(1);
  });

  test("an answer to another challenge, from another origin, or without the fingerprint is refused", async () => {
    const device = softAuthenticator({ origin, rpId: "localhost" });
    const stored = await made(device);
    const req = await passkeys.requestOptions();
    await expect(passkeys.checkAssertion({ credential: device.get(req), challenge: "another", stored })).rejects.toMatchObject({ code: "PASSKEY_FAILED" });
    const elsewhere = softAuthenticator({ origin: "https://evil.example", rpId: "localhost" });
    const theirs = await passkeys.creationOptions({ ...user, exclude: [] });
    await expect(passkeys.checkCreation({ credential: elsewhere.create(theirs), challenge: theirs.challenge })).rejects.toMatchObject({ code: "PASSKEY_FAILED", status: 422 });
    const req2 = await passkeys.requestOptions();
    await expect(
      passkeys.checkAssertion({ credential: device.get(req2, { userVerified: false }), challenge: req2.challenge, stored, status: 401 }),
    ).rejects.toMatchObject({ code: "PASSKEY_FAILED", status: 401 });
  });

  test("a counter that goes backwards is a cloned key, refused", async () => {
    const device = softAuthenticator({ origin, rpId: "localhost" });
    const stored = await made(device);
    const req = await passkeys.requestOptions();
    await expect(
      passkeys.checkAssertion({ credential: device.get(req), challenge: req.challenge, stored: { ...stored, sign_count: 50 } }),
    ).rejects.toMatchObject({ code: "PASSKEY_FAILED" });
  });

  test("a synced passkey that always reports 0 still signs in", async () => {
    const device = softAuthenticator({ origin, rpId: "localhost", syncedCounter: true });
    const stored = await made(device);
    for (let i = 0; i < 2; i += 1) {
      const req = await passkeys.requestOptions();
      expect(await passkeys.checkAssertion({ credential: device.get(req), challenge: req.challenge, stored })).toBe(0);
    }
  });

  test("only a well-formed credential id is read from an answer", () => {
    expect(passkeys.credentialIdOf({ id: "abcdefghijklmnopqrstuv" })).toBe("abcdefghijklmnopqrstuv");
    expect(passkeys.credentialIdOf({ id: "short" })).toBeNull();
    expect(passkeys.credentialIdOf({ id: "has spaces in it, nope" })).toBeNull();
    expect(passkeys.credentialIdOf(null)).toBeNull();
  });
});

describe("where passkeys belong", () => {
  const base = { APP_ENV: "development" };

  test("by default, the staff app's own host", () => {
    const { config } = parseEnv({ ...base, STAFF_ORIGIN: "http://localhost:5173" });
    expect(config.WEBAUTHN_ORIGIN).toBe("http://localhost:5173");
    expect(config.WEBAUTHN_RP_ID).toBe("localhost");
  });

  test("set explicitly per environment, and refused when they disagree", () => {
    const ok = parseEnv({ ...base, WEBAUTHN_RP_ID: "hub.staging.mycityapp.io", WEBAUTHN_ORIGIN: "https://hub.staging.mycityapp.io" });
    expect(ok.problems).toEqual([]);
    const wrong = parseEnv({ ...base, WEBAUTHN_RP_ID: "hub.mycityapp.io", WEBAUTHN_ORIGIN: "https://hub.staging.mycityapp.io" });
    expect(wrong.problems).toContain("WEBAUTHN_RP_ID must be WEBAUTHN_ORIGIN's host, or a domain it sits under");
  });

  test("https on a server", () => {
    const { problems } = parseEnv({ APP_ENV: "staging", WEBAUTHN_ORIGIN: "http://hub.staging.mycityapp.io" });
    expect(problems).toContain("WEBAUTHN_ORIGIN must be https on staging");
  });
});

describe("the authenticator QR code", () => {
  test("encodes a MyCity App key and nothing else", async () => {
    const url = mfa.otpauthUrl("ada@mycity.test", mfa.newKey());
    expect(await qr.authenticator(url)).toMatch(/^data:image\/png;base64,/);
    expect(() => qr.authenticator("https://example.com/")).toThrow(/only a MyCity App authenticator key/);
    expect(() => qr.authenticator(url.replace("MyCity%20App", "Other"))).toThrow();
  });
});
