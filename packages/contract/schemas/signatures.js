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
const { text, optionalText, isoDate, isoDateTime } = require("./common");
const { RichTextBlock } = require("./policies");

const SignatureRequestStatus = z.enum(["pending", "completed", "declined", "expired", "revoked"]);
const SignatureStatus = z.enum(["pending", "signed", "declined", "expired"]);
/**
 * A signer as the pages show them: the row's status, or `void` for a signature on a request that
 * ended unsigned (another signer declined, it lapsed or it was withdrawn), which binds nobody.
 */
const SignerStatus = z.enum(["pending", "signed", "declined", "expired", "void"]);
/** How a signature was made: drawn on the pad, typed in a signature face, or on paper and recorded. */
const SignatureMethod = z.enum(["draw", "type", "paper"]);
/** Whose signature it is, as the verification page names them. */
const SignatoryRole = z.enum(["candidate", "employee", "partner", "mycity"]);
/** What was signed, as the verification page names it. */
const SignedDocumentType = z.enum(["offer_letter", "employment_contract", "agreement"]);
/** What Verify a Document can check: a signed document, or a training certificate (docs/guides/knowledge.md §6.10). */
const VerifiedDocumentType = z.enum([...SignedDocumentType.options, "training_certificate"]);
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

/**
 * Where the person holding the link stands. `void`: they signed, but the document was declined by
 * another signer, lapsed or was withdrawn before everyone signed, so their signature binds nobody.
 */
const SigningState = z.enum(["awaiting", "signed", "declined", "expired", "withdrawn", "void"]);

/** The signing page (go.mycityapp.io/sign/<token>): the document as its PDF reads, and where signing stands. */
const SigningView = z
  .object({
    reference: z.string(),
    document_type: SignedDocumentType,
    title: z.string(),
    company: z.string(),
    /** The person this link is for. */
    signer_name: z.string(),
    /** The day the document is dated, as its letterhead prints it. */
    issued_at: isoDateTime,
    expires_at: isoDateTime.nullable(),
    state: SigningState,
    /** The document's text, from the one renderer its PDF is made with. */
    letter: z.array(z.string()),
    /**
     * The same text as blocks, headings, numbered clauses and tables kept, where the document has
     * them (an agreement); null where its paragraphs say it all (an offer letter).
     */
    blocks: z.array(RichTextBlock).nullable(),
    /** The emailed code was entered; Accept and Sign may be pressed. */
    code_verified: z.boolean(),
    signers: z.array(z.lazy(() => SignerView)),
    signed_at: isoDateTime.nullable(),
    /** The reference to verify once every signer has signed and the copy is sealed. */
    verify_number: z.string().nullable(),
  })
  .strict();

/** Send Code: where it went (masked) and when another may be asked for. */
const SignCodeSent = z
  .object({
    sent_to: z.string(),
    expires_at: isoDateTime,
    resend_after: isoDateTime,
  })
  .strict();

/** One signer as the signing and verification pages list them. */
const SignerView = z
  .object({
    name: z.string(),
    title: z.string().nullable(),
    role: SignatoryRole,
    status: SignerStatus,
    signed_at: isoDateTime.nullable(),
    /** Drawn, typed, or signed on paper and recorded. */
    method: SignatureMethod.nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * The verification page
 * ------------------------------------------------------------------ */

/** By reference: OFF-0018, CON-0004, AGR-2026-0001. A reference is not a secret, so it reveals no content. */
const VerifyRefParams = z.object({ ref: z.string().trim().min(3).max(60) }).strict();

/**
 * A training certificate as it was issued (docs/guides/knowledge.md §6.10): the holder, the course,
 * the completion date. Its number alone shows it; nothing else about the person is shown.
 */
const CertificateFacts = z
  .object({
    holder_name: z.string(),
    course_number: z.string(),
    course_title: z.string(),
    completed_on: isoDate,
    items: z.number().int().min(0),
    minutes: z.number().int().min(1).nullable(),
  })
  .strict();

const VerifyResult = z
  .object({
    reference: z.string(),
    document_type: VerifiedDocumentType,
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
    /** A training certificate's facts; null for a signed document. */
    certificate: CertificateFacts.nullable(),
  })
  .strict();

/** Opened from the document's QR: the same record, and the document it is about. */
const VerifyByToken = VerifyResult.extend({
  document: z
    .object({
      title: z.string(),
      /** The document's text, from the one renderer the PDF is made with. */
      letter: z.array(z.string()),
      /** The same text as blocks, where the document has headings, clauses or tables (SigningView.blocks). */
      blocks: z.array(RichTextBlock).nullable(),
      file_name: z.string(),
      url: z.string(),
    })
    .strict(),
});

/* ------------------------------------------------------------------ *
 * Mail
 * ------------------------------------------------------------------ */

/** signature-code: the six-digit code, ten minutes. Queued after the code's row commits; never in the outbox. */
const SignatureCodeEmailVars = z
  .object({ code: z.string().regex(/^\d{6}$/), title: z.string(), minutes: z.number().int().min(1) })
  .strict();

/** signature-completed: every signer signed; the sealed copy is attached. */
const SignatureCompletedEmailVars = z
  .object({ title: z.string(), reference: z.string(), verify_url: z.string() })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  SignTokenParams: { table: null, reason: "the signing link's :token" },
  SignCodeVerify: { table: null, reason: "the one-time code a signer was emailed" },
  SignSubmit: { table: null, reason: "a signature and its evidence, kept on the signature row" },
  SignDecline: { table: null, reason: "the reason, kept as the request's end_reason" },
  SignerView: { table: null, reason: "a signature row as the public pages list it" },
  SigningView: { table: null, reason: "the signing page's view of a signature request and the signer's row" },
  SignCodeSent: { table: null, reason: "when the code was sent and lapses, kept on the signature row" },
  SignatureCodeEmailVars: { table: null, reason: "the variables of templates/email/signature-code.html" },
  SignatureCompletedEmailVars: { table: null, reason: "the variables of templates/email/signature-completed.html" },
  VerifyRefParams: { table: null, reason: "a document's reference" },
  CertificateFacts: { table: null, reason: "a training certificate as issued, kept on training_enrolment" },
  VerifyResult: { table: null, reason: "what verification shows: status, signers and the two verdicts" },
  VerifyByToken: { table: null, reason: "verification from the QR: the record and its document" },
};

module.exports = {
  TABLES,
  SignatureRequestStatus,
  SignatureStatus,
  SignerStatus,
  SignatureMethod,
  SignatoryRole,
  SignedDocumentType,
  VerifiedDocumentType,
  Verdict,
  SignTokenParams,
  SignCodeVerify,
  SignaturePng,
  SignSubmit,
  SignDecline,
  SigningState,
  SigningView,
  SignCodeSent,
  SignatureCodeEmailVars,
  SignatureCompletedEmailVars,
  SignerView,
  VerifyRefParams,
  CertificateFacts,
  VerifyResult,
  VerifyByToken,
};
