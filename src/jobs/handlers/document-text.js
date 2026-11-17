"use strict";
/**
 * Queue `document-text`: one library file's text read into document_text, so a word inside it finds
 * it in the Document Centre and ⌘K (src/modules/library/library.text.js; docs/guides/document-centre.md
 * §6.7). Idempotent: a file already read is left as it is.
 */
const { UnrecoverableError } = require("bullmq");
const text = require("../../modules/library/library.text");

module.exports = async function documentText(job) {
  const { document_id: documentId } = job.data || {};
  if (!documentId) throw new UnrecoverableError("document-text: document_id is required");
  return text.read(documentId);
};
