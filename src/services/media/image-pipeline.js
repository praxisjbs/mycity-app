"use strict";
/**
 * Every image upload goes through here once, before it is stored (BACKEND_STRUCTURE §5.3).
 *
 *   const out = await images.processImage(buffer, sniffedType, "photo");
 *   // out.master     { buffer, type, width, height }   what is stored and hashed
 *   // out.variants   [{ kind: "webp-640", mime, width, height, buffer }, ...]
 *
 * Profiles, and why they differ:
 *
 *   photo      a picture of people or places. Master kept in its own format (JPEG
 *              stays JPEG: a download must open anywhere), capped at 2400 px; AVIF
 *              and WebP at 320, 640, 960 and 1600 for lists and screens.
 *   document   a scan of a certificate, an ID, a signed page. Orientation fixed and
 *              downscaled to 2600 px (A4 at about 220 dpi, small print stays legible),
 *              re-encoded at high quality, and NOTHING that changes tone: auto-levels
 *              turn a faint stamp or a pale signature white, and a scan that no longer
 *              matches the paper is a problem found in an audit. WebP previews only.
 *   avatar     a face. Square, centred on the most interesting region, 512 px master;
 *              96, 192 and 384 px variants.
 *   signature  a drawn signature (M5). PNG kept, transparency kept, width capped; no
 *              variants, it is stamped into a PDF as is.
 *
 * Always:
 *  - HEIC from iPhones is converted to JPEG on the way in (most browsers cannot show HEIC).
 *  - EXIF orientation is applied and then ALL metadata is dropped: a phone photo carries
 *    the GPS position it was taken at, and a staff photo must not publish a home address.
 *  - Decoding is capped at 50 megapixels, so a small file that decodes to a vast bitmap
 *    (a decompression bomb) is refused instead of exhausting memory.
 *  - A variant that fails to encode is skipped, not fatal: a missing thumbnail is a slower
 *    list, a failed upload is a lost document.
 *
 * The master returned is what the caller stores AND hashes (shared/files/hash.js).
 */
const sharp = require("sharp");
const { AppError } = require("../../shared/errors");
const { logger } = require("../../config/logger");
const { TYPES } = require("../../shared/files/sniff");

const MAX_PIXELS = 50_000_000;
sharp.cache(false);

const PROFILES = Object.freeze({
  photo: { maxEdge: 2400, quality: 82, square: false, keepFormat: true, variants: { widths: [320, 640, 960, 1600], formats: ["avif", "webp"] } },
  document: { maxEdge: 2600, quality: 90, square: false, keepFormat: true, variants: { widths: [320, 960], formats: ["webp"] } },
  avatar: { maxEdge: 512, quality: 85, square: true, keepFormat: false, variants: { widths: [96, 192, 384], formats: ["avif", "webp"] } },
  signature: { maxEdge: 1200, quality: 100, square: false, keepFormat: true, png: true, variants: { widths: [], formats: [] } },
});

const PROCESSABLE = new Set([TYPES.jpeg.mime, TYPES.png.mime, TYPES.webp.mime, TYPES.heic.mime, TYPES.avif.mime]);

const isProcessable = (type) => Boolean(type) && PROCESSABLE.has(type.mime);

async function heicToJpeg(buffer) {
  const convert = require("heic-convert");
  try {
    return Buffer.from(await convert({ buffer, format: "JPEG", quality: 0.92 }));
  } catch {
    throw new AppError("IMAGE_UNREADABLE", "This HEIC photo could not be read. Export it as JPEG and try again.", 422);
  }
}

const open = (input) => sharp(input, { failOn: "error", limitInputPixels: MAX_PIXELS, sequentialRead: true });

function encode(img, format, quality) {
  switch (format) {
    case "jpeg":
      return img.jpeg({ quality, mozjpeg: true, chromaSubsampling: quality >= 90 ? "4:4:4" : "4:2:0" });
    case "png":
      return img.png({ compressionLevel: 9, adaptiveFiltering: true });
    case "webp":
      return img.webp({ quality, effort: 4 });
    case "avif":
      return img.avif({ quality: Math.max(40, quality - 30), effort: 4 });
    default:
      throw new Error(`image-pipeline: no encoder for ${format}`);
  }
}

const TYPE_OF = { jpeg: TYPES.jpeg, png: TYPES.png, webp: TYPES.webp, avif: TYPES.avif };

/** Which format the master is written in. */
function masterFormat(profile, type) {
  if (profile.png) return "png";
  if (!profile.keepFormat) return "webp";
  if (type.mime === TYPES.png.mime) return "png";
  if (type.mime === TYPES.webp.mime) return "webp";
  if (type.mime === TYPES.avif.mime) return "avif";
  return "jpeg";
}

/**
 * @param {Buffer} buffer
 * @param {{mime: string, ext: string}} type  from sniff()
 * @param {keyof PROFILES} profileName
 */
async function processImage(buffer, type, profileName = "document") {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`image-pipeline: unknown profile "${profileName}"`);
  if (!isProcessable(type)) throw new Error(`image-pipeline: ${type && type.mime} is not an image it processes`);

  let source = buffer;
  let sourceType = type;
  if (type.mime === TYPES.heic.mime) {
    source = await heicToJpeg(buffer);
    sourceType = TYPES.jpeg;
  }

  let meta;
  try {
    meta = await open(source).metadata();
  } catch (err) {
    if (/pixel limit/i.test(String(err.message))) throw new AppError("IMAGE_TOO_LARGE", "This image is too large to process.", 413);
    throw new AppError("IMAGE_UNREADABLE", "This image could not be read. It may be damaged.", 422);
  }

  // rotate() with no angle applies the EXIF orientation; output carries no metadata.
  const base = () => {
    const img = open(source).rotate();
    return profile.square
      ? img.resize(profile.maxEdge, profile.maxEdge, { fit: "cover", position: sharp.strategy.attention })
      : img.resize(profile.maxEdge, profile.maxEdge, { fit: "inside", withoutEnlargement: true });
  };

  const fmt = masterFormat(profile, sourceType);
  const { data: masterBuf, info } = await encode(base(), fmt, profile.quality).toBuffer({ resolveWithObject: true });
  const master = { buffer: masterBuf, type: TYPE_OF[fmt], width: info.width, height: info.height };

  const variants = [];
  for (const width of profile.variants.widths) {
    if (!profile.square && width >= Math.max(info.width, info.height)) continue;
    for (const format of profile.variants.formats) {
      try {
        const img = open(masterBuf).resize(width, width, { fit: profile.square ? "cover" : "inside", withoutEnlargement: true });
        const out = await encode(img, format, profile.quality).toBuffer({ resolveWithObject: true });
        variants.push({ kind: `${format}-${width}`, mime: TYPE_OF[format].mime, ext: format, width: out.info.width, height: out.info.height, buffer: out.data });
      } catch (err) {
        logger.warn({ err, width, format }, "image variant skipped");
      }
    }
  }

  return { master, variants, original: { mime: type.mime, width: meta.width || null, height: meta.height || null, bytes: buffer.length } };
}

/** The variant kinds a profile produces, for checking a requested `:kind` before reading anything. */
function variantKinds(profileName) {
  const p = PROFILES[profileName];
  if (!p) return [];
  return p.variants.widths.flatMap((w) => p.variants.formats.map((f) => `${f}-${w}`));
}

module.exports = { PROFILES, MAX_PIXELS, isProcessable, processImage, variantKinds };
