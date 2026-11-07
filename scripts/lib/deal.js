"use strict";
/**
 * Deals files out to n CI shards by expected cost: longest first, each to the shard with the least
 * so far. Used by jest's backend shards (tests/shard-sequencer.js) and vitest's frontend shards
 * (scripts/fe-test.js), whose own splits go by count: one shard drew app's three slowest files
 * and took 438 s where the others took 180 (06/11/2026).
 *
 * Pure and deterministic: every shard computes the same deal from the same files, so together
 * they run each file exactly once.
 */
const fs = require("node:fs");

/** A file's size in kilobytes, 0 when it cannot be read (the runner reports a missing file). */
function kb(file) {
  try {
    return fs.statSync(file).size / 1024;
  } catch {
    return 0;
  }
}

/**
 * @param {string[]} files
 * @param {number} shardCount
 * @param {(file: string) => number} costOf
 * @returns {{owner: Map<string, number>, loads: number[]}} each file's shard (0-based) and each shard's cost
 */
function deal(files, shardCount, costOf) {
  const loads = Array.from({ length: shardCount }, () => 0);
  const owner = new Map();
  const weighed = files.map((f) => ({ f, c: costOf(f) })).sort((a, b) => b.c - a.c || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0));
  for (const { f, c } of weighed) {
    let least = 0;
    for (let i = 1; i < shardCount; i++) if (loads[i] < loads[least]) least = i;
    owner.set(f, least);
    loads[least] += c;
  }
  return { owner, loads };
}

/** The files of shard i (1-based) of n. */
function shardFiles(files, i, n, costOf) {
  const { owner } = deal(files, n, costOf);
  return files.filter((f) => owner.get(f) === i - 1);
}

module.exports = { deal, shardFiles, kb };
