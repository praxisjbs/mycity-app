"use strict";
/**
 * The signatures service end to end (docs/guides/offers.md §3 steps 3 to 5 and 9, §6;
 * docs/guides/partnerships.md §6.9): the real migrations on a throwaway database, the public pages
 * through HTTP, every response parsed with its contract (APP_ENV=test). The mail queue is mocked:
 * what is queued is what would be sent. A test record type is declared signable; M5's offers and
 * contracts declare theirs in their own PRs.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/signatures
 *
 * Refuses to run unless the database name ends in "_test". Every person here is invented.
 */
const crypto = require("node:crypto");
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const queues = require("../../src/jobs/queues");
const { rebuild } = require("./helpers/schema");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const { atomically } = require("../../src/shared/db/tx");
const vault = require("../../src/shared/documents/vault");
const storage = require("../../src/services/storage/storage.service");
const { defineDocumentType } = require("../../src/shared/documents/types");
const { one, drain, harness } = require("./helpers/ai-actions");
const signatures = require("../../src/modules/signatures/signatures.service");
const signedPdf = require("../../src/modules/signatures/signatures.signed-pdf");
const verifyKeyHash = require("../../src/modules/signatures/signatures.verify").keyHash;

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n");
/** A 1x1 transparent PNG, as the pad would send a (very small) signature. */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** The test record's canonical text: what its signers attest to. Changing it is "the record changed". */
const RECORD = new Map();
const hashOf = (id) => crypto.createHash("sha256").update(JSON.stringify(RECORD.get(id) || null)).digest("hex");

const DOC_TYPE = "test_signed_letter";
const SUBJECT = "test_letter";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The codes mailed so far, newest last. */
const codesSent = () =>
  queues.enqueue.mock.calls.filter((c) => c[0] === "email-send" && c[1] === "signature-code").map((c) => c[2].data.code);

describeDb("Signatures against the real migrations", () => {
  let app;
  let h;
  const sealedDocs = [];
  const pub = () => ({
    get: (path) => request(app).get(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()),
    post: (path) => request(app).post(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()).set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1"),
  });

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    defineDocumentType(DOC_TYPE, { label: "Test letter", module: "recruitment", sensitivity: "personal" });
    signatures.defineSignable(SUBJECT, {
      document_type: "offer_letter",
      letter: async (_db, id) => [`Letter ${id.slice(0, 8)}`, (RECORD.get(id) || {}).body || ""],
      contentHash: async (_db, id) => hashOf(id),
      // The real signables generate their template with ctx's signatures, certificate and QR; here the
      // sealed copy is a stored PDF, enough for the hashes and the flow.
      seal: async (client, ctx) => {
        expect(ctx.certificate.length).toBeGreaterThan(0);
        expect(ctx.qr).toMatch(/^data:image\/png;base64,/);
        expect(ctx.verify_url).toMatch(/\/verify\/t\/[A-Za-z0-9_-]{43}$/);
        const doc = await vault.store(client, {
          file: { buffer: Buffer.concat([PDF, Buffer.from(`% sealed ${ctx.request.reference}\n`)]), originalname: "sealed.pdf" },
          purpose: "document",
          doc_type: DOC_TYPE,
          entity: { type: SUBJECT, id: ctx.request.subject_id },
          actor: null,
        });
        sealedDocs.push({ request: ctx.request.signature_request_id, key: ctx.verify_url.split("/").pop(), document_id: doc.document_id });
        return doc;
      },
    });
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
    ]);
    await drain();
  }, 120_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /** A test record sent for signature: the company signs in the hub, then the candidate on the page. */
  async function sendForSignature({ reference, expiresInHours = 72 }) {
    const subjectId = crypto.randomUUID();
    RECORD.set(subjectId, { body: `Offer ${reference}: NGN 500,000.00 a month from 01/12/2026.` });
    const ops = h.people.ops;
    return tx(async (client) => {
      const doc = await vault.store(client, {
        file: { buffer: PDF, originalname: `${reference}.pdf` },
        purpose: "document",
        doc_type: DOC_TYPE,
        entity: { type: SUBJECT, id: subjectId },
        actor: { user_id: ops.user_id },
      });
      const out = await signatures.requestIn(client, { user_id: ops.user_id }, {
        document_id: doc.document_id,
        subject_type: SUBJECT,
        subject_id: subjectId,
        reference,
        title: `Offer of Employment ${reference}`,
        expires_at: new Date(Date.now() + expiresInHours * 3600000),
        signers: [
          { signer_type: "user", signer_id: ops.user_id, name: "Ada Obi", email: ops.email, title: "Operations & People Lead", role: "mycity" },
          { signer_type: "candidate", signer_id: null, name: "Chiamaka Eze", email: "chiamaka.eze@example.test", role: "candidate" },
        ],
      });
      return { ...out, subjectId, token: out.links[0].token };
    });
  }

  const companySigns = (requestId) =>
    tx((client) =>
      signatures.signAsStaffIn(client, { user_id: h.people.ops.user_id }, requestId, { full_name: "Ada Obi", title: "Operations & People Lead", method: "type", typed: "Ada Obi", consent: true }),
    );

  test("the candidate reads, proves the email, signs, and the copy is sealed and verifies with two verdicts", async () => {
    const sent = await sendForSignature({ reference: "OFF-0901" });
    // Only the candidate has a link; the company's signatory signs in the hub.
    expect(sent.links).toHaveLength(1);
    expect(sent.links[0].url).toMatch(/\/sign\/[A-Za-z0-9_-]{43}$/);

    const first = await pub().get(`/sign/${sent.token}`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ reference: "OFF-0901", state: "awaiting", code_verified: false, signer_name: "Chiamaka Eze", verify_number: null });
    expect(first.body.signers.map((s) => [s.role, s.status])).toEqual([["mycity", "pending"], ["candidate", "pending"]]);
    expect(first.body.letter[1]).toContain("NGN 500,000.00");

    // Signers sign in order: the company first.
    const early = await pub().post(`/sign/${sent.token}/code`).send({});
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("NOT_YOUR_TURN");
    await companySigns(sent.signature_request_id);

    // The code: emailed, masked on the page, a new one only after a minute.
    const code = await pub().post(`/sign/${sent.token}/code`).send({});
    expect(code.status).toBe(200);
    expect(code.body.sent_to).toBe("c••••e@example.test");
    expect((await pub().post(`/sign/${sent.token}/code`).send({})).status).toBe(429);
    const mailed = codesSent().pop();
    expect(mailed).toMatch(/^\d{6}$/);
    // The code travels in the mail job only: no event, no row holds it.
    const kept = await one("SELECT code_hash FROM signature WHERE signer_email = 'chiamaka.eze@example.test' AND signature_request_id = $1", [sent.signature_request_id]);
    expect(kept.code_hash).not.toContain(mailed);
    expect(JSON.stringify((await one("SELECT coalesce(json_agg(payload), '[]'::json) AS p FROM event_log WHERE event_key LIKE 'signature.%'")).p)).not.toContain(mailed);

    // Signing needs the code first.
    const sign = { full_name: "Chiamaka Eze", title: "Head of PR, Marketing & Brand Strategy", method: "draw", signature_png: PNG, consent: true };
    expect((await pub().post(`/sign/${sent.token}/sign`).send(sign)).body.error.code).toBe("CODE_NEEDED");
    const wrong = mailed === "000000" ? "111111" : "000000";
    expect((await pub().post(`/sign/${sent.token}/code/verify`).send({ code: wrong })).body.error.code).toBe("CODE_WRONG");
    const verified = await pub().post(`/sign/${sent.token}/code/verify`).send({ code: mailed });
    expect(verified.status).toBe(200);
    expect(verified.body.code_verified).toBe(true);

    const signed = await pub().post(`/sign/${sent.token}/sign`).send(sign);
    expect(signed.status).toBe(200);
    expect(signed.body.state).toBe("signed");
    // A second press answers with the signed state, never an error.
    const again = await pub().post(`/sign/${sent.token}/sign`).send(sign);
    expect(again.status).toBe(200);
    expect(again.body.state).toBe("signed");

    const rows = await one(
      "SELECT json_agg(json_build_object('status', status, 'method', method, 'hash', content_hash, 'image', signature_document_id, 'ip', evidence->>'ip') ORDER BY position) AS r FROM signature WHERE signature_request_id = $1",
      [sent.signature_request_id],
    );
    expect(rows.r.map((x) => x.status)).toEqual(["signed", "signed"]);
    expect(rows.r.every((x) => x.hash === hashOf(sent.subjectId))).toBe(true);
    expect(rows.r[1].method).toBe("draw");
    expect(rows.r[1].image).toBeTruthy();
    expect(rows.r[1].ip).toBeTruthy();

    // The outbox seals it: the sealed copy, then (as the worker would after rendering) its hash on every row.
    await drain();
    const s = sealedDocs.find((x) => x.request === sent.signature_request_id);
    expect(s).toBeTruthy();
    await signedPdf.sealed(s.document_id);
    await drain();
    const req = await one("SELECT status, sealed_at, sealed_document_id, verify_key_hash FROM signature_request WHERE signature_request_id = $1", [sent.signature_request_id]);
    expect(req.status).toBe("completed");
    expect(req.sealed_at).toBeTruthy();
    expect(req.verify_key_hash).toBe(verifyKeyHash(s.key));
    // Each signer is mailed the sealed copy.
    const copies = queues.enqueue.mock.calls.filter((c) => c[1] === "signature-completed" && c[2].attachments[0].document_id === s.document_id);
    expect(copies.map((c) => c[2].to.email).sort()).toEqual(["chiamaka.eze@example.test", "ops@mycity.test"]);

    // By reference: status, signers, verdicts; no content.
    const byRef = await pub().get("/verify/off-0901");
    expect(byRef.status).toBe(200);
    expect(byRef.body).toMatchObject({ reference: "OFF-0901", status: "completed", content: "matches", artifact: "matches", signed_outside: false });
    expect(byRef.body.document).toBeUndefined();
    expect(byRef.body.signers.map((x) => x.name)).toEqual(["Ada Obi", "Chiamaka Eze"]);

    // From the QR: the document too.
    const byKey = await pub().get(`/verify/t/${s.key}`);
    expect(byKey.status).toBe(200);
    expect(byKey.body.document.letter[1]).toContain("NGN 500,000.00");
    expect((await pub().get(`/verify/t/${s.key}/document`)).status).toBe(200);
    expect((await pub().get(`/verify/t/${"A".repeat(43)}`)).status).toBe(404);

    // The signing page now names the reference to verify.
    expect((await pub().get(`/sign/${sent.token}`)).body.verify_number).toBe("OFF-0901");

    // The record changed after signing: content differs. The file changed: artifact differs.
    RECORD.get(sent.subjectId).body = "Offer OFF-0901: NGN 900,000.00 a month from 01/12/2026.";
    expect((await pub().get("/verify/OFF-0901")).body.content).toBe("differs");
    const doc = await vault.get(pool, s.document_id);
    await storage.put(doc.storage_key, Buffer.concat([PDF, Buffer.from("% altered\n")]), { overwrite: true });
    expect((await pub().get("/verify/OFF-0901")).body.artifact).toBe("differs");
  }, 60_000);

  test("five wrong codes, and a new code must be asked for", async () => {
    const sent = await sendForSignature({ reference: "OFF-0902" });
    await companySigns(sent.signature_request_id);
    await pub().post(`/sign/${sent.token}/code`).send({});
    const right = codesSent().pop();
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) expect((await pub().post(`/sign/${sent.token}/code/verify`).send({ code: wrong })).body.error.code).toBe("CODE_WRONG");
    expect((await pub().post(`/sign/${sent.token}/code/verify`).send({ code: right })).body.error.code).toBe("CODE_LOCKED");
  });

  test("a decline ends the request for everyone; a bad or ended link is the same 404", async () => {
    const sent = await sendForSignature({ reference: "OFF-0903" });
    await companySigns(sent.signature_request_id);
    const declined = await pub().post(`/sign/${sent.token}/decline`).send({ reason: "I accepted another offer." });
    expect(declined.status).toBe(200);
    expect(declined.body.state).toBe("declined");
    const r = await one("SELECT status, end_reason FROM signature_request WHERE signature_request_id = $1", [sent.signature_request_id]);
    expect(r).toEqual({ status: "declined", end_reason: "I accepted another offer." });
    expect((await pub().post(`/sign/${sent.token}/code`).send({})).body.error.code).toBe("NOT_OPEN");
    expect((await pub().get(`/sign/${"x".repeat(43)}`)).status).toBe(404);
    // Not sealed, so not verifiable.
    expect((await pub().get("/verify/OFF-0903")).status).toBe(404);
  });

  test("a request opened before it is sent has no link until Send; Resend revokes the earlier one", async () => {
    const subjectId = crypto.randomUUID();
    RECORD.set(subjectId, { body: "Offer OFF-0906." });
    const ops = { user_id: h.people.ops.user_id };
    const opened = await tx(async (client) => {
      const doc = await vault.store(client, { file: { buffer: PDF, originalname: "OFF-0906.pdf" }, purpose: "document", doc_type: DOC_TYPE, entity: { type: SUBJECT, id: subjectId }, actor: ops });
      return signatures.requestIn(client, ops, {
        document_id: doc.document_id, subject_type: SUBJECT, subject_id: subjectId, reference: "OFF-0906", title: "Offer of Employment OFF-0906",
        expires_at: new Date(Date.now() + 48 * 3600000), issue_links: false,
        signers: [{ signer_type: "candidate", name: "Tunde Ade", email: "tunde.ade@example.test", role: "candidate" }],
      });
    });
    expect(opened.links).toEqual([]);
    const sent = await tx((client) => signatures.issueLinks(client, ops, opened.signature_request_id));
    expect(sent).toHaveLength(1);
    expect((await pub().get(`/sign/${sent[0].token}`)).status).toBe(200);
    const resent = await tx((client) => signatures.issueLinks(client, ops, opened.signature_request_id));
    expect((await pub().get(`/sign/${sent[0].token}`)).status).toBe(404);
    expect((await pub().get(`/sign/${resent[0].token}`)).status).toBe(200);
  });

  test("withdrawn and lapsed requests end: their links say so, read only, without the document", async () => {
    const withdrawn = await sendForSignature({ reference: "OFF-0904" });
    await tx((client) => signatures.endFor(client, { user_id: h.people.ops.user_id }, { subject_type: SUBJECT, subject_id: withdrawn.subjectId, reason: "Role closed" }));
    // Opens on Offer Withdrawn (AJ, 13/11/2026), shows nothing of the letter, and takes nothing.
    const ended = await pub().get(`/sign/${withdrawn.token}`);
    expect(ended.status).toBe(200);
    expect(ended.body).toMatchObject({ state: "withdrawn", letter: [], blocks: null });
    expect((await pub().post(`/sign/${withdrawn.token}/code`).send({})).body.error.code).toBe("NOT_OPEN");
    expect((await pub().post(`/sign/${withdrawn.token}/decline`).send({ reason: "Too late now" })).body.error.code).toBe("NOT_OPEN");
    expect((await pub().get(`/sign/${withdrawn.token}/document`)).status).toBe(404);

    const lapsed = await sendForSignature({ reference: "OFF-0905" });
    await pool.query("UPDATE signature_request SET expires_at = now() - interval '1 minute' WHERE signature_request_id = $1", [lapsed.signature_request_id]);
    const out = await signatures.expireLapsed();
    expect(out.ended).toBeGreaterThanOrEqual(1);
    expect((await one("SELECT status FROM signature_request WHERE signature_request_id = $1", [lapsed.signature_request_id])).status).toBe("expired");
    expect((await pub().get(`/sign/${lapsed.token}`)).body).toMatchObject({ state: "expired", letter: [] });
  });
});
