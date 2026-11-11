"use strict";
/**
 * The pure parts of the signatures service: the email code and the certificate's rows. The flow
 * itself, against the real migrations, is tests/integration/signatures.test.js.
 */
const code = require("./signatures.code");
const certificate = require("./signatures.certificate");

describe("signatures.code", () => {
  test("a code is six digits, leading zeros kept", () => {
    for (let i = 0; i < 200; i += 1) expect(code.fresh()).toMatch(/^\d{6}$/);
  });

  test("a code matches only its own row's hash", () => {
    const kept = code.hashOf("sig-1", "042917");
    expect(code.matches("sig-1", "042917", kept)).toBe(true);
    expect(code.matches("sig-1", "042918", kept)).toBe(false);
    expect(code.matches("sig-2", "042917", kept)).toBe(false);
    expect(code.matches("sig-1", "42917", kept)).toBe(false);
    expect(code.matches("sig-1", "042917", null)).toBe(false);
  });

  test("an address is masked enough to recognise, not to read", () => {
    expect(code.maskEmail("chiamaka.eze@example.test")).toBe("c••••e@example.test");
    expect(code.maskEmail("ab@example.test")).toBe("a@example.test");
    expect(code.maskEmail("nonsense")).toBe("your email");
  });
});

describe("signatures.certificate", () => {
  const signed = {
    status: "signed",
    signer_name: "Chiamaka Eze",
    signer_title: "Head of PR",
    signer_email: "chiamaka.eze@example.test",
    method: "draw",
    signed_at: "2026-11-06T14:05:00Z",
    content_hash: "a".repeat(64),
    signature_document_id: "doc-1",
    evidence: {
      ip: "102.89.4.1",
      user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1",
      code_verified_at: "2026-11-06T14:03:00Z",
    },
  };

  test("one row a signed signer, Lagos time day-first, the address masked, the image beside it", () => {
    const rows = certificate.rows([signed, { ...signed, status: "pending" }], new Map([["doc-1", "data:image/png;base64,AA=="]]));
    expect(rows).toEqual([
      {
        name: "Chiamaka Eze",
        title: "Head of PR",
        email: "c••••e@example.test",
        method: "Drawn",
        signed_at: "06/11/2026 15:05",
        code_verified_at: "06/11/2026 15:03",
        ip: "102.89.4.1",
        device: "iPhone or iPad, Safari",
        content_hash: "a".repeat(64),
        signature: "data:image/png;base64,AA==",
        typed: null,
      },
    ]);
  });

  test("a device is named by its system and browser", () => {
    expect(certificate.deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36")).toBe("Windows, Chrome");
    expect(certificate.deviceOf("")).toBeNull();
  });
});
