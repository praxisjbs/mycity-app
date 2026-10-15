"use strict";
/**
 * The storage key of a document's derived file (an image size, a transcoded
 * voice note, a video poster).
 *
 * THE ONE FUNCTION THAT KNOWS HOW A DERIVED FILE IS NAMED. Everything that
 * writes one (vault image variants, the AV pipeline) and everything that looks
 * for one (media reconcile) calls it, so a file cannot be written under a name
 * the other side cannot rebuild; otherwise the sweep misses the real file and
 * reports one that never existed. A leaf: no requires, no side effects. No part
 * of a request ever reaches it: callers pass a document id the database
 * generated and names from code.
 */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const EXT_RE = /^[a-z0-9]{2,5}$/;

/**
 * @param {string} documentId
 * @param {string} name   "thumb", "voice", "poster"
 * @param {string} ext    "webp", "ogg", "jpg"
 */
function variantKey(documentId, name, ext) {
  if (!/^[0-9a-f-]{36}$/i.test(String(documentId)))
    throw new Error(`variantKey: "${documentId}" is not a document id`);
  if (!NAME_RE.test(String(name)) || !EXT_RE.test(String(ext)))
    throw new Error(`variantKey: bad name "${name}" or extension "${ext}"`);
  return `derived/${documentId}/${name}.${ext}`;
}

/** The folder every derived file of one document lives in. */
const variantPrefix = (documentId) => `derived/${documentId}/`;

module.exports = { variantKey, variantPrefix };
