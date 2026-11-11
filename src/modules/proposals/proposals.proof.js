"use strict";
/**
 * Proof points (docs/guides/partnerships.md §6.11): MyCity's own facts a proposal may cite, a figure (the
 * size of its network), a partner's logo, an endorsement, a past result, entered on Categories. Claude
 * cites only these and the record. Nothing is seeded on production (A26); MyCity enters them, and staging
 * carries a demonstration set. A proof point is retired, never deleted, so a proposal that cited it keeps
 * its source. Its picture is uploaded to it (POST /proof-points/:id/image) and stored against it.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const documents = require("../documents/documents.service");
const grantsCache = require("../../shared/rbac/grants-cache");
const repo = require("./proposals.repo");
const { EVENTS } = require("./proposals.events");

/** A proof point's picture is MyCity's own: whoever may open Partnerships may see it. */
vault.defineAccess("proof_point", async (client, user) => {
  if (!user || !user.user_id) return false;
  if (user.is_ceo === true) return true;
  const { scopeFromGrants } = require("../../middleware/rbac");
  const rows = await grantsCache.getGrants(client, { role_ids: user.role_ids || [], module: "partnerships" });
  return Boolean(scopeFromGrants(rows, "view"));
});

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That proof point does not exist", 404);

/** A proof point as the wire has it: its image as a document reference. */
async function shaped(db, row) {
  const { document_id: documentId, ...rest } = row;
  const doc = documentId ? await vault.get(db, documentId) : null;
  return { ...rest, document: doc ? documents.refOf(doc) : null };
}

async function list(query) {
  const page = await repo.listProofPoints(pool, query);
  return { ...page, data: await Promise.all(page.data.map((r) => shaped(pool, r))) };
}

async function get(id, db = pool) {
  const row = await repo.getProofPoint(db, id);
  if (!row) throw notFound();
  return shaped(db, row);
}

async function create(actor, body) {
  const id = await tx(async (client) => {
    const row = await repo.insertProofPoint(client, { ...body, position: body.position ?? (await repo.nextProofPosition(client)) });
    await emit(client, {
      key: EVENTS.PROOF_POINT_CREATED,
      entity: { type: "proof_point", id: row.proof_point_id },
      actor,
      after: await repo.getProofPoint(client, row.proof_point_id),
      payload: { proof_point_id: row.proof_point_id, kind: body.kind },
    });
    return row.proof_point_id;
  });
  return get(id);
}

async function update(actor, id, body) {
  await tx(async (client) => {
    const before = await repo.getProofPoint(client, id);
    if (!before) throw notFound();
    await repo.updateProofPoint(client, id, body);
    await emit(client, {
      key: EVENTS.PROOF_POINT_UPDATED,
      entity: { type: "proof_point", id },
      actor,
      before,
      after: await repo.getProofPoint(client, id),
      payload: { proof_point_id: id, active: body.active },
    });
  });
  return get(id);
}

/** POST /proof-points/:id/image: the logo or picture, stored against the proof point, replacing any before. */
async function setImage(actor, id, file) {
  if (!file) throw new AppError("FILE_REQUIRED", "Choose a file to upload", 422, { file: ["Choose a file"] });
  await tx(async (client) => {
    const before = await repo.getProofPoint(client, id);
    if (!before) throw notFound();
    const doc = await vault.store(client, {
      file,
      purpose: "photo",
      doc_type: "proof_point_image",
      entity: { type: "proof_point", id },
      title: before.label,
      actor,
    });
    await repo.updateProofPoint(client, id, { document_id: doc.document_id });
    await emit(client, {
      key: EVENTS.PROOF_POINT_UPDATED,
      entity: { type: "proof_point", id },
      actor,
      before,
      after: await repo.getProofPoint(client, id),
      payload: { proof_point_id: id, image: true },
    });
  });
  return get(id);
}

module.exports = { list, get, create, update, setImage };
