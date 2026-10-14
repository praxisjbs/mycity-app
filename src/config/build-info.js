"use strict";
/**
 * What is running: the release the health check reports, the staging top bar
 * shows, and every error report carries (SYSTEM_ARCHITECTURE §10, §11).
 *
 * BUILD_SHA and BUILD_TIME are written into the server's .env by the deploy;
 * on a laptop they are empty and read as "local".
 */
const { config } = require("./env");
const { version } = require("../../package.json");

const STARTED_AT = new Date().toISOString();

function buildInfo() {
  return {
    version,
    sha: config.BUILD_SHA || "local",
    built_at: config.BUILD_TIME || null,
    started_at: STARTED_AT,
    node: process.version,
    env: config.APP_ENV,
  };
}

/** Short form for headers and log lines: the first 12 characters of the sha. */
function shortSha() {
  return (config.BUILD_SHA || "local").slice(0, 12);
}

module.exports = { buildInfo, shortSha, STARTED_AT };
