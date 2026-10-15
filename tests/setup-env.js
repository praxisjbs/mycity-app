"use strict";
/**
 * Runs before every test file (jest.config.js setupFiles). A unit test sees the
 * same environment on every machine: never the developer's .env (config/env.js
 * skips it under Jest), APP_ENV=test so route responses are checked against their
 * contract, a silent logger, and a throwaway MEDIA_ROOT.
 */
process.env.APP_ENV = "test";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";
// Files a test stores go to a throwaway folder, never the repository's ./media.
process.env.MEDIA_ROOT = require("node:path").join(
  require("node:os").tmpdir(),
  `mycity-test-media-${process.pid}`,
);
