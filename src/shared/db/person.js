"use strict";
/**
 * A person as every list and card names them (the contract's PersonRef), in SQL, and the
 * one place the sizes of a person's photo are chosen.
 *
 *   `SELECT ${personJson("e", "d")} AS employee`, with employee `e` and department `d` joined
 *
 * builds { employee_id, display_name, job_title, department, photo_url } from employee `e`
 * and department `d`, or null when the employee joined nothing (a LEFT JOIN that missed).
 *
 * photo_url is the API path of `employee.photo_document_id` at a size (migration 1170;
 * modules/organisation/organisation.photo.js): lists and cards read the 192 px size, a
 * profile the 384 px one. The path needs the session, so the apps fetch it with the token
 * (app/src/api/download.ts usePhotos), never as a bare image link. The file's own read rule
 * (the `employee_photo` record type) lets every signed-in member of staff open it.
 */

/** The image pipeline's sizes a photo is shown at (services/media/image-pipeline.js). */
const PHOTO_VARIANTS = Object.freeze({
  /** A row, a card, a chat line, a node of the chart. */
  list: "webp-192",
  /** My Profile's header, the shell and the lock screen. */
  profile: "webp-384",
});

const VARIANT_RE = /^webp-(96|192|384)$/;
const ALIAS_RE = /^[a-z_][a-z0-9_]{0,30}$/;

function checkVariant(variant) {
  if (!VARIANT_RE.test(String(variant))) throw new Error(`person: "${variant}" is not a photo size`);
  return variant;
}

function checkAlias(alias) {
  if (!ALIAS_RE.test(String(alias))) throw new Error(`person: "${alias}" is not a table alias`);
  return alias;
}

/** The API path of a photo document at a size, or null for none. */
const photoPath = (documentId, variant = PHOTO_VARIANTS.list) =>
  documentId ? `/api/v1/documents/${documentId}/variant/${checkVariant(variant)}` : null;

/** The same path in SQL, from employee `e`'s photo_document_id; null when there is none. */
const photoUrlSql = (e = "e", variant = PHOTO_VARIANTS.list) =>
  `CASE WHEN ${checkAlias(e)}.photo_document_id IS NULL THEN NULL
        ELSE '/api/v1/documents/' || ${e}.photo_document_id::text || '/variant/${checkVariant(variant)}' END`;

/**
 * PersonRef as SQL, from employee `e` and department `d` (`d` may be a LEFT JOIN).
 * Null when `e` joined nothing, so a missing person is null rather than a row of nulls.
 */
const personJson = (e = "e", d = "d", variant = PHOTO_VARIANTS.list) =>
  `CASE WHEN ${checkAlias(e)}.employee_id IS NULL THEN NULL ELSE json_build_object(
     'employee_id', ${e}.employee_id,
     'display_name', btrim(${e}.first_name || ' ' || ${e}.last_name),
     'job_title', ${e}.job_title,
     'department', ${checkAlias(d)}.name,
     'photo_url', ${photoUrlSql(e, variant)}) END`;

module.exports = { PHOTO_VARIANTS, photoPath, photoUrlSql, personJson };
