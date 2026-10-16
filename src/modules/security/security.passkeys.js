"use strict";
/**
 * Passkeys: WebAuthn ceremonies, built and checked by @simplewebauthn/server
 * (docs/guides/identity.md §6). No database here; security.service and
 * security.signin keep the credentials and spend the tickets.
 *
 * The decisions, in the order a reviewer should check them:
 *
 *  1. The fingerprint, face or screen lock is required, at creation and at every
 *     use (userVerification "required", and refused when the flag is missing). A
 *     passkey here stands for both steps of signing in, so it must be two factors
 *     on its own: the device, and the person unlocking it.
 *  2. The origin and the relying party ID come from configuration
 *     (WEBAUTHN_ORIGIN, WEBAUTHN_RP_ID), never from the request. A passkey made on
 *     hub.mycityapp.io works only there, and staging's only on staging.
 *  3. Passkeys are discoverable (residentKey "required"), so signing in needs
 *     nothing typed, and options for signing in name no credentials: they reveal
 *     nothing about whether an email has a passkey. Who a passkey belongs to is
 *     learnt only from a verified answer.
 *  4. The same device cannot add a second passkey for the same person: the
 *     person's passkeys are excluded at creation.
 *  5. The signature counter must go up when the authenticator keeps one (the
 *     library refuses a counter that went back: a cloned key). Passkeys synced
 *     by a password manager report 0 every time, and that is allowed.
 */
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { AppError } = require("../../shared/errors");

const RP_NAME = "MyCity App";
/** How long the browser waits for the fingerprint or face. */
const TIMEOUT_MS = 90 * 1000;
/** ES256, then RS256 (Windows Hello). */
const ALGORITHMS = [-7, -257];

const rp = () => ({ rpID: config.WEBAUTHN_RP_ID, origin: config.WEBAUTHN_ORIGIN });

const failed = (status = 400) =>
  new AppError("PASSKEY_FAILED", "Your passkey could not be checked. Try again.", status);

/** The credential id a browser answer names (base64url), or null. */
function credentialIdOf(credential) {
  const id = credential && (credential.id || credential.rawId);
  return typeof id === "string" && /^[A-Za-z0-9_-]{16,1024}$/.test(id) ? id : null;
}

/**
 * Options for adding a passkey to this person.
 * @param {{userId: string, email: string, displayName: string, exclude: Array<{credential_id: string, transports: string[]}>}} who
 * @returns {Promise<object>}  PublicKeyCredentialCreationOptionsJSON
 */
function creationOptions({ userId, email, displayName, exclude }) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp().rpID,
    // A stable handle, so a password manager files every passkey under one account.
    userID: new Uint8Array(Buffer.from(String(userId), "utf8")),
    userName: email,
    userDisplayName: displayName || email,
    timeout: TIMEOUT_MS,
    attestationType: "none",
    excludeCredentials: exclude.map((p) => ({ id: p.credential_id, transports: p.transports || undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: ALGORITHMS,
  });
}

/**
 * Check the browser's answer to creationOptions.
 * @returns {Promise<{credentialId: string, publicKey: string, signCount: number, transports: string[], backedUp: boolean}>}
 */
async function checkCreation({ credential, challenge }) {
  let v;
  try {
    v = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: rp().origin,
      expectedRPID: rp().rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    logger.warn({ err: err && err.message }, "passkey creation refused");
    throw failed(422);
  }
  if (!v.verified || !v.registrationInfo) throw failed(422);
  const info = v.registrationInfo;
  const transports = (info.credential.transports || credential.response?.transports || []).filter(
    (t) => typeof t === "string",
  );
  return {
    credentialId: info.credential.id,
    publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
    signCount: Number(info.credential.counter) || 0,
    transports,
    backedUp: info.credentialBackedUp === true,
  };
}

/**
 * Options for using a passkey. With `allow` (a signed-in person confirming it is
 * them) only their passkeys are offered; without it the browser offers its own.
 * @returns {Promise<object>}  PublicKeyCredentialRequestOptionsJSON
 */
function requestOptions({ allow = null } = {}) {
  return generateAuthenticationOptions({
    rpID: rp().rpID,
    timeout: TIMEOUT_MS,
    userVerification: "required",
    ...(allow ? { allowCredentials: allow.map((p) => ({ id: p.credential_id, transports: p.transports || undefined })) } : {}),
  });
}

/**
 * Check the browser's answer to requestOptions against the stored passkey.
 * @param {{credential: object, challenge: string, stored: {credential_id: string, public_key: string, sign_count: string|number, transports: string[]}, status?: number}} input
 * @returns {Promise<number>}  the new signature count to keep
 */
async function checkAssertion({ credential, challenge, stored, status = 400 }) {
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: rp().origin,
      expectedRPID: rp().rpID,
      credential: {
        id: stored.credential_id,
        publicKey: new Uint8Array(Buffer.from(stored.public_key, "base64url")),
        counter: Number(stored.sign_count) || 0,
        transports: stored.transports || undefined,
      },
      requireUserVerification: true,
    });
  } catch (err) {
    // A counter that went back lands here too: logged with the credential so it can be found.
    logger.warn({ err: err && err.message, credential_id: stored.credential_id }, "passkey answer refused");
    throw failed(status);
  }
  if (!v.verified) throw failed(status);
  return Number(v.authenticationInfo.newCounter) || 0;
}

module.exports = {
  RP_NAME,
  credentialIdOf,
  creationOptions,
  checkCreation,
  requestOptions,
  checkAssertion,
};
