"use strict";
/**
 * The one error type a module throws on purpose (README §7 rule 10).
 *
 * `middleware/error-handler.js` turns it into the response envelope. Anything
 * that is NOT an AppError is treated as a defect: logged with its stack, and
 * answered with a generic 500 so no SQL, path or stack trace reaches a client.
 *
 *   throw new AppError("EMPLOYEE_NOT_FOUND", "Employee not found", 404);
 *   throw new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422,
 *                      { work_email: ["is already in use"] });
 *
 * Ported from praxis-ls src/utils/errors.js; `details` is named `fields`
 * because in this codebase it is always a field → messages map.
 */
class AppError extends Error {
  /**
   * @param {string} code      SCREAMING_SNAKE_CASE, stable, safe to show and to branch on
   * @param {string} message   human sentence, safe to show to the user
   * @param {number} [status]  HTTP status
   * @param {Record<string, string[]>|null} [fields] per-field messages for forms
   */
  constructor(code, message, status = 400, fields = null) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

module.exports = { AppError };
