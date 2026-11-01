"use strict";
/**
 * The engine's one error shape (docs/guides/praxis-ai.md §6.14). The engine knows no web
 * framework and no AppError: it throws an EngineError with a code and a status, and the
 * adapter (services/ai/assistant) turns it into the application's own error at the edge.
 */
class EngineError extends Error {
  /**
   * @param {string} code      SCREAMING_SNAKE, as the API reports it
   * @param {string} message   what a person may be told
   * @param {number} [status]  the HTTP status the adapter answers with
   * @param {object} [fields]  problems by field, as the form system shows them
   */
  constructor(code, message, status = 400, fields = null) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

const isEngineError = (e) => Boolean(e) && e.name === "EngineError" && typeof e.code === "string";

module.exports = { EngineError, isEngineError };
