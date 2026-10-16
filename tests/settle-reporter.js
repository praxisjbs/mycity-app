"use strict";
/**
 * Runs in every test file after the framework loads (jest.config.js setupFilesAfterEnv).
 *
 * The error reporter batches its writes on a timer (error-reporter.js, FLUSH_MS). A file
 * that reports an error and finishes before the timer fires would leave it to fire inside
 * the next file, after this file's environment is gone, and Jest fails the whole run for
 * it. So every file ends by dropping what it left buffered. A test that needs the rows
 * flushes them itself while its pool is open (tests/integration).
 */
afterAll(() => {
  const reporter = require("../src/shared/observability/error-reporter");
  if (typeof reporter.__reset === "function") reporter.__reset();
});
