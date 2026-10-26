"use strict";
/**
 * The User Guide's meaning index (docs/guides/user-guide.md §4, §6.8): one vector for each
 * passage of the chapters, keyed by the hash of what was embedded and the model that embedded it.
 * Vectors go in as pgvector's text form (`[0.1,...]`) and never come back out: a search asks the
 * database how near each passage is.
 */
const { completeQuery } = require("../../shared/http/paged");

/** Hashes asked about in one query: the guide's passages, a chunk at a time. */
const CHUNK = 1000;

/**
 * Which of these hashes already have a vector on this model.
 * @param {{query: Function}} db
 * @param {string} model
 * @param {string[]} hashes
 * @returns {Promise<Set<string>>}
 */
async function indexed(db, model, hashes) {
  const out = new Set();
  for (let i = 0; i < hashes.length; i += CHUNK) {
    // pagination:complete the index compares at most CHUNK of the chapters' passages with what it holds
    const { rows } = await completeQuery(
      db,
      `SELECT text_hash FROM user_guide_passage WHERE model = $1 AND text_hash = ANY($2::text[]) ORDER BY text_hash`,
      [model, hashes.slice(i, i + CHUNK)],
      { label: "The guide's passages" },
    );
    for (const r of rows) out.add(r.text_hash);
  }
  return out;
}

/** Vectors written in one statement. */
const SAVE_BATCH = 100;

/**
 * Keep vectors: a hash already held on the model keeps the one it has.
 * @param {{query: Function}} client  inside the service's transaction
 * @param {string} model
 * @param {Array<{hash: string, vector: number[]}>} rows
 * @returns {Promise<number>} how many were added
 */
async function save(client, model, rows) {
  let added = 0;
  for (let i = 0; i < rows.length; i += SAVE_BATCH) {
    const batch = rows.slice(i, i + SAVE_BATCH);
    const res = await client.query(
      `INSERT INTO user_guide_passage (text_hash, model, embedding)
       SELECT h, $3, e::vector FROM unnest($1::text[], $2::text[]) AS v(h, e)
       ON CONFLICT (text_hash, model) DO NOTHING`,
      [batch.map((r) => r.hash), batch.map((r) => JSON.stringify(r.vector)), model],
    );
    added += res.rowCount;
  }
  return added;
}

/**
 * Drop the vectors nothing in the chapters says any more, and every vector of another model.
 * @param {{query: Function}} client  inside the service's transaction
 * @returns {Promise<number>} how many were removed
 */
async function prune(client, model, hashes) {
  const res = await client.query(
    `DELETE FROM user_guide_passage WHERE model <> $1 OR NOT (text_hash = ANY($2::text[]))`,
    [model, hashes],
  );
  return res.rowCount;
}

/**
 * How near a search's vector is to each of these passages, nearest first, leaving out every one
 * further than `floor` (cosine similarity): only the candidates come back, never the index.
 * @param {{query: Function}} db
 * @param {{vector: number[], model: string, hashes: string[], floor: number}} q
 * @returns {Promise<Array<{text_hash: string, similarity: number}>>}
 */
async function nearest(db, { vector, model, hashes, floor }) {
  // pagination:complete a search's candidates are the passages within the floor of it, a few dozen, fused with the words before the page of 25 is cut
  const { rows } = await completeQuery(
    db,
    `SELECT text_hash, similarity FROM (
       SELECT text_hash, 1 - (embedding <=> $1::vector) AS similarity
         FROM user_guide_passage
        WHERE model = $2 AND text_hash = ANY($3::text[])
     ) near
      WHERE similarity >= $4
      ORDER BY similarity DESC, text_hash`,
    [JSON.stringify(vector), model, hashes, floor],
    { label: "The guide's nearest passages" },
  );
  return rows.map((r) => ({ text_hash: r.text_hash, similarity: Number(r.similarity) }));
}

module.exports = { indexed, save, prune, nearest };
