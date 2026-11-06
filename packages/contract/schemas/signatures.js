"use strict";
/**
 * The signatures service (docs/guides/offers.md §3, §6; docs/guides/partnerships.md §6.9): one
 * signing page and one verification page for every signed document, M5's offers and contracts
 * first, M7's agreements next.
 *
 * A document is sent for signature as a signature_request with one signature row per signer. The
 * signer opens an opaque link (`go.mycityapp.io/sign/<token>`), proves the email with a six-digit
 * code, types their full name and title, draws or types a signature and ticks I Agree to Sign
 * Electronically. Each signature row keeps its evidence and two hashes (A12): `content_hash` over
 * the canonical payload (recomputable) and `artifact_hash` over the sealed bytes the vault returned.
 * Verification reports both verdicts. Typed by reference it shows the status and the signers, never
 * the content (A9); opened from the document's QR it shows the document too.
 *
 * Statuses (the contract's spelling is the table's CHECK, migration 5020):
 *   request    pending, completed (every signer signed; sealed), declined, expired, revoked
 *   signature  pending, signed, declined, expired
 */
const { z } = require("zod");
const { text, optionalText, isoDateTime } = require("./common");

const SignatureRequestStatus = z.enum(["pending", "completed", "declined", "expired", "revoked"]);
const SignatureStatus = z.enum(["pending", "signed", "declined", "expired"]);
/** How a signature was made: drawn on the pad, typed in a signature face, or on paper and recorded. */
const SignatureMethod = z.enum(["draw", "type", "paper"]);
/** Whose signature it is, as the verification page names them. */
const SignatoryRole = z.enum(["candidate", "employee", "partner", "mycity"]);
/** What was signed, as the verification page names it. */
const SignedDocumentType = z.enum(["offer_letter", "employment_contract", "agreement"]);
/** A verdict of the two checks (A12). */
const Verdict = z.enum(["matches", "differs"]);

/* ------------------------------------------------------------------ *
 * The signing page
 * ------------------------------------------------------------------ */

const SignTokenParams = z.object({ token: z.string().min(16).max(200) }).strict();

/** The six-digit code emailed to the address the link was sent to; ten minutes, five tries. */
const SignCodeVerify = z.object({ code: z.string().regex(/^\d{6}$/, "Six digits") }).strict();

/** A drawn signature as the pad gives it: a PNG data URL, at most about 1.5 MB. */
const SignaturePng = z
  .string()
  .max(2000000, "Too large")
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/, "Draw your signature");

/** Accept and Sign: full name and title, drawn or typed, and I Agree to Sign Electronically. */
const SignSubmit = z
  .object({
    full_name: text(120),
    title: optionalText(120),
    method: z.enum(["draw", "type"]),
    signature_png: SignaturePng.optional(),
    typed: text(120).optional(),
    consent: z.literal(true),
  })
  .strict()
  .refine((v) => v.method !== "draw" || Boolean(v.signature_png), { message: "Draw your signature", path: ["signature_png"] })
  .refine((v) => v.method !== "type" || Boolean(v.typed), { message: "Type your signature", path: ["typed"] });

/** Decline the Offer (or the agreement): the reason the owner reads. */
const SignDecline = z.object({ reason: text(500) }).strict();

/** One signer as the signing and verification pages list them. */
const SignerView = z
  .object({
    name: z.string(),
    title: z.string().nullable(),
    role: SignatoryRole,
    status: SignatureStatus,
    signed_at: isoDateTime.nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * The verification page
 * ------------------------------------------------------------------ */

/** By reference: OFF-0018, CON-0004, AGR-2026-0001. A reference is not a secret, so it reveals no content. */
const VerifyRefParams = z.object({ ref: z.string().trim().min(3).max(60) }).strict();

const VerifyResult = z
  .object({
    reference: z.string(),
    document_type: SignedDocumentType,
    title: z.string(),
    issued_by: z.string(),
    issued_at: isoDateTime,
    status: SignatureRequestStatus,
    /** The document's own state where it has one beyond signing (an agreement active, expiring, closed). */
    record_status: z.string().nullable(),
    signers: z.array(SignerView),
    /** Signed on paper and recorded, not in the hub. */
    signed_outside: z.boolean(),
    /** The two checks (A12): the content matches what was signed; the stored file is the one sealed. */
    content: Verdict,
    artifact: Verdict,
  })
  .strict();

/** Opened from the document's QR: the same record, and the document it is about. */
const VerifyByToken = VerifyResult.extend({
  document: z
    .object({
      title: z.string(),
      /** The document's text, from the one renderer the PDF is made with. */
      letter: z.array(z.string()),
      file_name: z.string(),
      url: z.string(),
    })
    .strict(),
});

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  SignTokenParams: { table: null, reason: "the signing link's :token" },
  SignCodeVerify: { table: null, reason: "the one-time code a signer was emailed" },
  SignSubmit: { table: null, reason: "a signature and its evidence, kept on the signature row" },
  SignDecline: { table: null, reason: "the reason, kept as the request's end_reason" },
  SignerView: { table: null, reason: "a signature row as the public pages list it" },
  VerifyRefParams: { table: null, reason: "a document's reference" },
  VerifyResult: { table: null, reason: "what verification shows: status, signers and the two verdicts" },
  VerifyByToken: { table: null, reason: "verification from the QR: the record and its document" },
};

module.exports = {
  TABLES,
  SignatureRequestStatus,
  SignatureStatus,
  SignatureMethod,
  SignatoryRole,
  SignedDocumentType,
  Verdict,
  SignTokenParams,
  SignCodeVerify,
  SignaturePng,
  SignSubmit,
  SignDecline,
  SignerView,
  VerifyRefParams,
  VerifyResult,
  VerifyByToken,
};
