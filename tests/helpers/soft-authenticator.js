"use strict";
/**
 * A passkey authenticator in software, for tests: it makes the same answers a phone's
 * fingerprint or a laptop's face unlock would, so the server's WebAuthn checks run for
 * real (signatures, challenges, origins, the counter), without a browser.
 *
 *   const device = softAuthenticator({ origin: "http://localhost:5173", rpId: "localhost" });
 *   const answer = device.create(creationOptions);        // RegistrationResponseJSON
 *   const signed = device.get(requestOptions);             // AuthenticationResponseJSON
 *
 * ES256 (P-256) keys, "none" attestation, user presence and user verification set,
 * a counter that goes up by one on each use (or stays at 0 with `syncedCounter`, as a
 * password manager's synced passkey reports it). `get` signs with the first
 * credential it holds that the options allow.
 */
const crypto = require("node:crypto");

/* ------------------------------------------------------------------ *
 * The little of CBOR WebAuthn uses
 * ------------------------------------------------------------------ */

function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

/** Encode numbers, strings, byte strings, arrays and maps (a Map keeps integer keys). */
function cbor(value) {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === "string") {
    const b = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, b.length), b]);
  }
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sha256 = (data) => crypto.createHash("sha256").update(data).digest();

const FLAG = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40 };

/**
 * @param {{origin: string, rpId: string, syncedCounter?: boolean}} opts
 */
function softAuthenticator({ origin, rpId, syncedCounter = false }) {
  const credentials = [];
  const rpIdHash = sha256(Buffer.from(rpId, "utf8"));

  function authData(flags, counter, attested = null) {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(counter, 0);
    return Buffer.concat([rpIdHash, Buffer.from([flags]), c, ...(attested ? [attested] : [])]);
  }

  /** Make a passkey for the options the server gave (PublicKeyCredentialCreationOptionsJSON). */
  function create(options, { userVerified = true } = {}) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const id = crypto.randomBytes(32);
    const cose = cbor(
      new Map([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x, "base64url")],
        [-3, Buffer.from(jwk.y, "base64url")],
      ]),
    );
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(id.length, 0);
    const attested = Buffer.concat([Buffer.alloc(16), idLen, id, cose]);
    const flags = FLAG.UP | (userVerified ? FLAG.UV : 0) | FLAG.AT;
    const clientData = Buffer.from(
      JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }),
    );
    const attestationObject = cbor({ fmt: "none", attStmt: {}, authData: authData(flags, 0, attested) });
    const credential = { id: b64u(id), privateKey, counter: 0, userHandle: options.user && options.user.id };
    credentials.push(credential);
    return {
      id: credential.id,
      rawId: credential.id,
      type: "public-key",
      response: {
        clientDataJSON: b64u(clientData),
        attestationObject: b64u(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** Sign in with a passkey this device holds (PublicKeyCredentialRequestOptionsJSON). */
  function get(options, { userVerified = true, credentialId = null } = {}) {
    const allowed = (options.allowCredentials || []).map((c) => c.id);
    const credential = credentials.find(
      (c) => (credentialId ? c.id === credentialId : true) && (allowed.length === 0 || allowed.includes(c.id)),
    );
    if (!credential) throw new Error("soft authenticator: no passkey here for these options");
    if (!syncedCounter) credential.counter += 1;
    const data = authData(FLAG.UP | (userVerified ? FLAG.UV : 0), credential.counter);
    const clientData = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }),
    );
    const signature = crypto.sign("sha256", Buffer.concat([data, sha256(clientData)]), credential.privateKey);
    return {
      id: credential.id,
      rawId: credential.id,
      type: "public-key",
      response: {
        clientDataJSON: b64u(clientData),
        authenticatorData: b64u(data),
        signature: b64u(signature),
        userHandle: credential.userHandle || undefined,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  return { create, get, credentials };
}

module.exports = { softAuthenticator, cbor };
