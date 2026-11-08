"use strict";
/**
 * What the signatures service records, and what follows (docs/guides/offers.md §3, §7;
 * docs/guides/partnerships.md §6.9). Loaded by the API (through the service) and the worker.
 * Payloads carry ids, references and titles; never a code, a signature image or an address.
 *
 *   signature.requested   a document was sent for signature (the owning module mails the link)
 *   signature.viewed      a signer opened their link for the first time
 *   signature.signed      one signer signed
 *   signature.declined    a signer declined; the request ends
 *   signature.completed   the last signer signed: the copy is sealed from the outbox (signed-pdf)
 *   signature.sealed      the sealed copy is stored and hashed: each signer is mailed it
 *   signature.ended       the request expired or was revoked
 *
 * The service is required when a handler runs, not when this file loads.
 */
const c = require("@mycity/contract");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineVariables } = require("../../shared/templates/variables");
const { defineDocumentType } = require("../../shared/documents/types");
const outbox = require("../../shared/events/outbox");
const vault = require("../../shared/documents/vault");

const EVENTS = defineEvents("recruitment", {
  "signature.requested": { summary: "A document was sent for signature" },
  "signature.viewed": { summary: "A signer opened their signing link" },
  "signature.signed": { summary: "A signer signed a document" },
  "signature.declined": { summary: "A signer declined to sign a document" },
  "signature.completed": { summary: "Every signer signed a document" },
  "signature.sealed": { summary: "A signed document was sealed" },
  "signature.ended": { summary: "A signature request expired or was withdrawn" },
});

/** A drawn signature as the pad sent it, kept through the vault for the row it signs. */
const SIGNATURE_IMAGE = "signature_image";
defineDocumentType(SIGNATURE_IMAGE, { label: "Signature", module: "recruitment", sensitivity: "personal" });

/** The record a signature image belongs to, for the vault. */
const SIGNATURE_ENTITY = "signature";

/** The emails this service sends itself; the owning module sends the link. */
const EMAILS = Object.freeze({ code: "signature-code", completed: "signature-completed" });
defineVariables("email", EMAILS.code, c.signatures.SignatureCodeEmailVars);
defineVariables("email", EMAILS.completed, c.signatures.SignatureCompletedEmailVars);

const seal = () => require("./signatures.signed-pdf");

outbox.register(EVENTS.SIGNATURE_COMPLETED, "signatures.seal", (event) => seal().seal(event.payload.signature_request_id));
// A sealed copy finishes rendering in the worker: its stored bytes' hash is every row's artifact_hash.
outbox.register(vault.EVENTS.DOCUMENT_GENERATED, "signatures.sealed", (event) => seal().sealed(event.payload.document_id));
outbox.register(EVENTS.SIGNATURE_SEALED, "signatures.mail_sealed", (event) => seal().mailSealed(event.payload.signature_request_id));

module.exports = { EVENTS, EMAILS, SIGNATURE_IMAGE, SIGNATURE_ENTITY };
