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
  if (u.origin !== own.origin) throw new Error(`qr: only ${own.origin} links are encoded`);
  return u.toString();
}

const OPTS = { errorCorrectionLevel: "M", margin: 2, color: { dark: "#01221D", light: "#FFFFFF" } };

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
  return QRCode.toDataURL(assertOwnUrl(url), { ...OPTS, type: "image/png", width });
}

module.exports = { svg, png, dataUrl };
