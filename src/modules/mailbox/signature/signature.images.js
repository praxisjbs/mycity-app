"use strict";
/**
 * A signature's pictures (mailbox.md §3 step 9): the band's logo, icon or pin, the social icons
 * and the app icons, drawn as PNG at twice their size for sharp screens.
 *
 * Every picture carries its own ground or sits on the band, never a dark glyph on the page:
 * dark mode recolours text and backgrounds and never pictures, so a City Green glyph on a page
 * turned dark would disappear. The social icons are white, on the band; the app icons are white
 * on a Deep Green tile of their own.
 *
 * Two ways out: `data:` URLs for a preview in the app (a frame that loads nothing from the web),
 * and inline parts for a message, each stored once in the vault as `mail_signature_image`, found
 * again by the hash of its bytes, so the Sent copy names the same document every time.
 */
const crypto = require("node:crypto");
const sharp = require("sharp");
const vault = require("../../../shared/documents/vault");
const { brandFile, brandPicture } = require("../../../shared/organisation/profile");
const repo = require("./signature.repo");
const { PIN, GLYPHS } = require("./signature.glyphs");

const SCALE = 2;
const YELLOW = "#FFDF55";
const WHITE = "#FFFFFF";
const DEEP = "#01221D";

/** Display sizes in CSS px; the bitmaps are twice these. */
const SIZE = Object.freeze({ pin: 18, social: 16, app: 24, logo_height: 24, icon: 18 });

/** Rendered drawings by key, for the life of the process: they never change. */
const drawn = new Map();

async function drawSvg(key, svg, size, kind = key) {
  if (drawn.has(key)) return drawn.get(key);
  const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const pic = { name: key, kind, buffer, width: size, height: size };
  drawn.set(key, pic);
  return pic;
}

const px = (n) => n * SCALE;

function pin() {
  const s = px(SIZE.pin);
  return drawSvg(
    "pin",
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24"><path d="${PIN}" fill="${YELLOW}" fill-rule="evenodd"/></svg>`,
    SIZE.pin,
  );
}

function social(key) {
  const s = px(SIZE.social);
  return drawSvg(
    `social-${key}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24"><path d="${GLYPHS[key]}" fill="${WHITE}"/></svg>`,
    SIZE.social,
  );
}

function app(key) {
  const s = px(SIZE.app);
  return drawSvg(
    `app-${key}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="${DEEP}"/><g transform="translate(11 11) scale(1.0833)"><path d="${GLYPHS[key]}" fill="${WHITE}"/></g></svg>`,
    SIZE.app,
  );
}

/** An uploaded brand file fitted for the band: the White Logo to a height, the Icon to a square. */
async function uploaded(db, documentId, kind) {
  if (kind === "logo_white") {
    const fitted = await brandPicture(db, documentId, { height: SIZE.logo_height, scale: SCALE });
    return fitted && { name: "logo", kind, buffer: fitted.buffer, width: fitted.width, height: fitted.height };
  }
  const file = await brandFile(db, documentId);
  if (!file) return null;
  const key = `${kind}-${file.document_id}`;
  if (drawn.has(key)) return drawn.get(key);
  const s = px(SIZE.icon);
  const buffer = await sharp(file.buffer)
    .resize(s, s, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const pic = { name: "icon", kind, buffer, width: SIZE.icon, height: SIZE.icon };
  drawn.set(key, pic);
  return pic;
}

/**
 * The pictures one model needs, as bitmaps. The band's picture says what it is (`kind`: the
 * White Logo, the Icon or the drawn pin): a brand file that cannot be read yet leaves the pin.
 * @param {{query: Function}} db
 * @param {object} model  resolve()'s model
 * @param {object} org    readProfile(): the brand files' document ids
 */
async function picturesFor(db, model, org) {
  let band = null;
  if (model.band === "logo_white") band = await uploaded(db, org.logo_white_document_id, "logo_white");
  else if (model.band === "icon") band = await uploaded(db, org.icon_document_id, "icon");
  if (!band) band = await pin();
  const out = { band, social: {}, app: {} };
  for (const s of model.socials) if (GLYPHS[s.key]) out.social[s.key] = await social(s.key);
  for (const a of model.apps) if (GLYPHS[a.key]) out.app[a.key] = await app(a.key);
  return out;
}

const each = (pics, fn) => ({
  band: pics.band && { ...fn(pics.band), kind: pics.band.kind },
  social: Object.fromEntries(Object.entries(pics.social).map(([k, p]) => [k, fn(p)])),
  app: Object.fromEntries(Object.entries(pics.app).map(([k, p]) => [k, fn(p)])),
});

/** The pictures as data: URLs, for a preview. */
function asData(pics) {
  return each(pics, (p) => ({ src: `data:image/png;base64,${p.buffer.toString("base64")}`, width: p.width, height: p.height }));
}

const hashOf = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

/** The vault document holding this picture, stored on first use (mailbox.md §4). */
async function ensureStored(client, pic) {
  const hash = hashOf(pic.buffer);
  // Two sends drawing the same new picture at once store it once.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`mail_signature_image:${hash}`]);
  const found = await repo.storedImage(client, hash);
  if (found) return { document_id: found, hash };
  const doc = await vault.store(client, {
    file: { buffer: pic.buffer, originalname: `${pic.name}.png` },
    purpose: "brand",
    doc_type: "mail_signature_image",
    entity: { type: "mail_signature_image", id: hash },
    title: pic.name,
    actor: null,
  });
  return { document_id: doc.document_id, hash };
}

/**
 * The pictures as inline parts of a message: each stored once, named by a content id.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @returns {Promise<{pics: object, parts: {content_id: string, document_id: string}[]}>}
 */
async function asParts(client, pics, domain = "mycityapp.io") {
  const parts = [];
  const byHash = new Map();
  const one = async (p) => {
    const stored = await ensureStored(client, p);
    let cid = byHash.get(stored.hash);
    if (!cid) {
      cid = `${p.name}.${stored.hash.slice(0, 12)}@${domain}`;
      byHash.set(stored.hash, cid);
      parts.push({ content_id: cid, document_id: stored.document_id });
    }
    return { src: `cid:${cid}`, width: p.width, height: p.height };
  };
  const out = { band: pics.band && { ...(await one(pics.band)), kind: pics.band.kind }, social: {}, app: {} };
  for (const [k, p] of Object.entries(pics.social)) out.social[k] = await one(p);
  for (const [k, p] of Object.entries(pics.app)) out.app[k] = await one(p);
  return { pics: out, parts };
}

module.exports = { picturesFor, asData, asParts, SIZE };
