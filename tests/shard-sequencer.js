"use strict";
/**
 * How `jest --shard=i/n` splits the suite between CI's backend jobs (scripts/check/lib/scope.js
 * plan(), JEST_SHARDS). Jest's own split gives each shard the same number of files, picked by a
 * hash of their paths; here the files are not alike. An integration file rebuilds the test
 * database's schema before its tests and runs one at a time, so it costs seconds where a unit file
 * costs milliseconds, and one shard drawing most of the long ones would hold the whole run up.
 *
 * So each file is given a cost (COST below, from its kind and its size), and scripts/lib/deal.js
 * deals the files out longest first, each to the shard with the least so far. Every shard computes
 * the same deal from the same files, so together they run each file exactly once. Sizes stand in
 * for timings because they need no record to keep up to date: a file that grows costs more the
 * next time the suite is split.
 *
 * Only --shard calls this; `npm test` and `npm run ci` without MYCITY_JEST_SHARD run every file as
 * jest always did (the default order is kept: sort() is jest's own).
 */
const path = require("node:path");
const Sequencer = require("@jest/test-sequencer").default;
const { deal, kb } = require("../scripts/lib/deal");

const INTEGRATION = `${path.sep}tests${path.sep}integration${path.sep}`;

/** A file's expected cost in milliseconds. */
const COST = Object.freeze({ integrationFixed: 4000, integrationPerKb: 140, unitFixed: 150, unitPerKb: 5 });

function cost(file) {
  return file.includes(INTEGRATION) ? COST.integrationFixed + kb(file) * COST.integrationPerKb : COST.unitFixed + kb(file) * COST.unitPerKb;
}

class ShardSequencer extends Sequencer {
  shard(tests, { shardIndex, shardCount }) {
    const { owner } = deal(
      tests.map((t) => t.path),
      shardCount,
      cost,
    );
    return tests.filter((t) => owner.get(t.path) === shardIndex - 1);
  }
}

module.exports = ShardSequencer;
module.exports.cost = cost;
module.exports.COST = COST;
