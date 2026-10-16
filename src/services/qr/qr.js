"use strict";
/**
 * QR codes, for document verification (M5): a printed offer or contract carries a
 * code that opens go.mycityapp.io/verify/<number>.
 *
 *   const svg = await qr.svg(verifyUrl);          // inline in an HTML page
 *   const uri = await qr.dataUrl(verifyUrl);      // <img src> inside a PDF template
 *
 * Error correction "M" (15%): survives a crease or a stamp across the code. Only
 * https URLs on our own public origin are encoded, so a code on a MyCity document can
 * never send someone elsewhere.
 *
 * The one other thing encoded is the key of two-step sign-in, for an authenticator
 * app to scan off My Security: `authenticator()` takes only an otpauth://totp/
 * address issued as MyCity App, and its image never leaves that screen.
 */
const QRCode = require("qrcode");
const { config } = require("../../config/env");

function assertOwnUrl(text) {
  let u;
  try {
    u = new URL(String(text));
  } catch {
    throw new Error("qr: give a URL");
  }
  const own = new URL(config.PUBLIC_ORIGIN);
  if (u.origin !== own.origin)
    throw new Error(`qr: only ${own.origin} links are encoded`);
  return u.toString();
}

const OPTS = {
  errorCorrectionLevel: "M",
  margin: 2,
  color: { dark: "#01221D", light: "#FFFFFF" },
};

/** SVG markup. */
function svg(url, { width = 160 } = {}) {
  return QRCode.toString(assertOwnUrl(url), { ...OPTS, type: "svg", width });
}

/** PNG bytes. */
function png(url, { width = 320 } = {}) {
  return QRCode.toBuffer(assertOwnUrl(url), { ...OPTS, type: "png", width });
}

/** A data: URL of the PNG, for a template's <img src>. */
function dataUrl(url, { width = 320 } = {}) {
  return QRCode.toDataURL(assertOwnUrl(url), {
    ...OPTS,
    type: "image/png",
    width,
  });
}

const AUTHENTICATOR = /^otpauth:\/\/totp\/MyCity%20App:[^?]+\?secret=[A-Z2-7]+&issuer=MyCity%20App$/;

/**
 * A data: URL of the QR code an authenticator app scans to add the key.
 * @param {string} otpauthUrl  as security.mfa.otpauthUrl() writes it
 */
function authenticator(otpauthUrl, { width = 240 } = {}) {
  if (!AUTHENTICATOR.test(String(otpauthUrl)))
    throw new Error("qr: only a MyCity App authenticator key is encoded");
  return QRCode.toDataURL(otpauthUrl, { ...OPTS, type: "image/png", width });
}

module.exports = { svg, png, dataUrl, authenticator };
