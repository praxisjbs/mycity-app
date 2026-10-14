"use strict";
/**
 * Files and rows that disagree, found and reported (the media-reconcile scheduler).
 *
 * A file is written before its document row commits (the bytes must exist before the
 * row points at them). A save that then rolls back leaves an ORPHAN: a file no row
 * names. And a file can go missing under a row (a restore from an old backup, a disk
 * fault). Both are found here:
 *
 *  - orphans older than a day are MOVED to orphaned/<date>/<original key>, never
 *    deleted: a person decides what to do with them, the sweep does not;
 *  - quarantine files whose upload has since been scanned and moved into the vault
 *    are orphans by design, and go the same way;
 *  - scratch folders (tmp/) older than a day are deleted (they are ours, never data);
 *  - rows whose file is missing are counted and listed (first 50) for the report, and
 *    nothing is changed: that is an incident, not housekeeping.
 *
 * Areas walked: vault, generated, comms, avatars, imports, quarantine, derived.
 */
const fsp = require("node:fs/promises");
const path = require("node:path");
const { logger } = require("../../config/logger");
const storage = require("../storage/storage.service");
const lagos = require("../../shared/time/lagos");

const AREAS = ["vault", "generated", "comms", "avatars", "imports", "quarantine", "derived"];
const GRACE_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;

async function* walk(absDir, relDir) {
  let entries;
  try {
    entries = await fsp.readdir(absDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    const rel = `${relDir}/${e.name}`;
    if (e.isDirectory()) yield* walk(abs, rel);
    else if (e.isFile() && !e.name.endsWith(".part")) yield { abs, key: rel };
  }
}

async function known(db, keys) {
  const { rows } = await db.query(
    `SELECT storage_key FROM document WHERE storage_key = ANY($1::text[])
     UNION SELECT storage_key FROM document_variant WHERE storage_key = ANY($1::text[])`,
    [keys],
  );
  return new Set(rows.map((r) => r.storage_key));
}

/**
 * @param {{db?: import("pg").Pool, now?: Date, dryRun?: boolean}} [opts]
 * @returns {Promise<{scanned: number, orphans: number, moved: string[], missing: number, missing_sample: string[], scratch_removed: number}>}
 */
async function run({ db = require("../../config/db").pool, now = new Date(), dryRun = false } = {}) {
  const root = storage.root();
  const out = { scanned: 0, orphans: 0, moved: [], missing: 0, missing_sample: [], scratch_removed: 0 };
  const stamp = lagos.dateOf(now);

  const settle = async (batch) => {
    if (batch.length === 0) return;
    const have = await known(db, batch.map((f) => f.key));
    for (const f of batch) {
      if (have.has(f.key)) continue;
      out.orphans += 1;
      if (dryRun) continue;
      const target = `orphaned/${stamp}/${f.key}`;
      try {
        await storage.move(f.key, target);
        if (out.moved.length < 200) out.moved.push(f.key);
      } catch (err) {
        logger.warn({ err, key: f.key }, "reconcile: could not move an orphan");
      }
    }
  };

  for (const area of AREAS) {
    let batch = [];
    for await (const f of walk(path.join(root, area), area)) {
      out.scanned += 1;
      const s = await fsp.stat(f.abs).catch(() => null);
      if (!s || now.getTime() - s.mtimeMs < GRACE_MS) continue;
      batch.push(f);
      if (batch.length >= BATCH) {
        await settle(batch);
        batch = [];
      }
    }
    await settle(batch);
  }

  // Scratch folders left by a job that died.
  try {
    for (const e of await fsp.readdir(path.join(root, "tmp"), { withFileTypes: true })) {
      const abs = path.join(root, "tmp", e.name);
      const s = await fsp.stat(abs).catch(() => null);
      if (s && now.getTime() - s.mtimeMs > GRACE_MS && !dryRun) {
        await fsp.rm(abs, { recursive: true, force: true });
        out.scratch_removed += 1;
      }
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  // Rows whose file is gone (rendered or stored ones only; a pending render has no file yet).
  let after = "";
  for (;;) {
    const { rows } = await db.query(
      `SELECT document_id::text AS id, storage_key FROM document
        WHERE render_status IS DISTINCT FROM 'pending' AND document_id::text > $1
        ORDER BY document_id::text
        LIMIT ${BATCH} -- pagination:batch documents one reconcile pass checks`,
      [after],
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      if (!(await storage.exists(r.storage_key))) {
        out.missing += 1;
        if (out.missing_sample.length < 50) out.missing_sample.push(r.id);
      }
    }
    after = rows[rows.length - 1].id;
  }

  if (out.orphans || out.missing) logger.warn({ ...out, moved: out.moved.length }, "media reconcile found differences");
  return out;
}

module.exports = { run, AREAS, GRACE_MS };
