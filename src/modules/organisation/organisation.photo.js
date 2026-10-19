"use strict";
/**
 * An employee's photo (migration 1170; docs/guides/ess.md §3 step 1, §5).
 *
 * The file goes through the upload engine as purpose `avatar` (services/media/image-pipeline.js:
 * cropped square to the face, every piece of metadata stripped, 96, 192 and 384 px sizes) into
 * the vault, as a document of type `employee_photo` held against the record `employee_photo`,
 * which every signed-in member of staff may read (organisation.events.js). `employee.
 * photo_document_id` points at the one in use. A replaced photo stays in the vault; removing the
 * photo only clears the pointer, and the person shows their initials again.
 *
 * `photo_url` is a size's path on the API: 384 px for a profile (My Profile, the shell), 192 px
 * for a list or a card (shared/db/person.js, which every person in a list is read through). The
 * sizes are chosen once, in shared/db/person.js PHOTO_VARIANTS, so SQL and this file agree. The
 * apps fetch the path with the session (app/src/api/download.ts), never as a bare <img src>.
 */
const { AppError } = require("../../shared/errors");
const { PHOTO_VARIANTS, photoPath } = require("../../shared/db/person");
const { emit } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const repo = require("./organisation.repo");
const { EVENTS, PHOTO_DOC_TYPE, PHOTO_ENTITY } = require("./organisation.events");

/** A profile's size: My Profile's header, the shell, the lock screen. */
const VARIANT = PHOTO_VARIANTS.profile;
/** A list's size: rows, cards, chat lines, the chart's nodes. */
const LIST_VARIANT = PHOTO_VARIANTS.list;

/** The API path of a photo document at a size (a profile's unless told), or null for none. */
const photoUrl = (documentId, variant = VARIANT) => photoPath(documentId, variant);

/** Someone's photo as the apps read it. */
async function photoOf(db, employeeId) {
  return photoUrl(await repo.photoDocumentOf(db, employeeId));
}

async function assertEmployee(client, employeeId) {
  const found = await repo.findEmployeeById(client, employeeId);
  if (!found) throw new AppError("NOT_FOUND", "Not found", 404);
  return found;
}

/**
 * Store a new photo and use it.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {string} employeeId
 * @param {{buffer: Buffer, originalname: string}} file  readUpload(req)
 * @param {object} actor
 * @returns {Promise<object>} the stored document row
 */
async function setPhoto(client, employeeId, file, actor) {
  await assertEmployee(client, employeeId);
  const before = await repo.photoDocumentOf(client, employeeId);
  const doc = await vault.store(client, {
    file,
    purpose: "avatar",
    doc_type: PHOTO_DOC_TYPE,
    entity: { type: PHOTO_ENTITY, id: employeeId },
    subject_employee_id: employeeId,
    sensitivity: "normal",
    title: "Profile photo",
    actor,
  });
  await repo.setPhotoDocument(client, employeeId, doc.document_id);
  await emitChange(client, employeeId, before, doc.document_id, actor);
  return doc;
}

/** Stop using a photo: the person shows their initials. Nothing to do when there is none. */
async function clearPhoto(client, employeeId, actor) {
  await assertEmployee(client, employeeId);
  const before = await repo.photoDocumentOf(client, employeeId);
  if (!before) return;
  await repo.setPhotoDocument(client, employeeId, null);
  await emitChange(client, employeeId, before, null, actor);
}

function emitChange(client, employeeId, before, after, actor) {
  return emit(client, {
    key: EVENTS.EMPLOYEE_PHOTO_UPDATED,
    entity: { type: "employee", id: employeeId },
    actor,
    before: { photo_document_id: before },
    after: { photo_document_id: after },
    payload: { employee_id: employeeId, photo_url: photoUrl(after) },
  });
}

module.exports = { VARIANT, LIST_VARIANT, photoUrl, photoOf, setPhoto, clearPhoto };
