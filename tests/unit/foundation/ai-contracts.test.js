"use strict";
/**
 * A contract or MoU attached on Praxis AI (docs/guides/praxis-ai.md §6.18, Appendix A PR 2), without a
 * database: the terms the pane's Record tab shows, in words a person reads, money in its own
 * currency; and a kind of document offered on a `view` grant, its card's grant standing apart.
 */
const { defineManifest } = require("../../../src/shared/ai/manifest");
const c = require("@mycity/contract");
const { recordOf, valueWords } = require("../../../src/modules/agreements/agreements.document-ai");

const read = {
  title: "Memorandum of Understanding",
  kind: "mou",
  parties: [
    { name: "MyCity App Ltd", role: "MyCity" },
    { name: "Lagoon Youth Fest Limited", role: null },
  ],
  signed_on: "2026-11-12",
  starts_on: "2026-12-01",
  ends_on: null,
  notice_days: 1,
  value: "1000.00",
  currency: "USD",
  renewal: null,
  obligations: [
    { party: "Lagoon Youth Fest Limited", obligation: "List every event." },
    { party: "Lagoon Youth Fest Limited", obligation: "Scan every ticket." },
    { party: "MyCity App Ltd", obligation: "Promote it." },
  ],
  signatories: [{ name: "Sample Signatory", title: null, party: "Lagoon Youth Fest Limited" }],
};

test("the terms read as a person reads them: dates day first, money in its own currency, each party's obligations under its name", () => {
  const r = recordOf(read);
  expect(c.assistant.AiAttachmentRecord.safeParse(r).success).toBe(true);
  expect(r.title).toBe("Memorandum of Understanding");
  expect(r.items).toEqual([
    { label: "Kind", value: "MOU" },
    { label: "Parties", value: "MyCity App Ltd (MyCity); Lagoon Youth Fest Limited" },
    { label: "Signed On", value: "12/11/2026" },
    { label: "Starts On", value: "01/12/2026" },
    { label: "Notice", value: "1 day" },
    { label: "Value", value: "USD 1,000.00" },
    { label: "Lagoon Youth Fest Limited", value: "List every event. Scan every ticket." },
    { label: "MyCity App Ltd", value: "Promote it." },
    { label: "Signed By", value: "Sample Signatory" },
  ]);
});

test("naira through shared/money; a document with no title is titled by its kind", () => {
  expect(valueWords("2500000.00", "NGN")).toBe("₦2,500,000.00");
  expect(valueWords("2500000.00", null)).toBe("₦2,500,000.00");
  expect(valueWords(null, "NGN")).toBeNull();
  expect(recordOf({ ...read, title: null, kind: "service_agreement" }).title).toBe("Service Agreement");
});

test("a kind of document may be offered on a view grant; a grant that is no action still fails", () => {
  const file = { kind: "contract", label: "Contract or MoU", question: "Summarise this contract and file it", read: () => ({ outcome: "unreadable" }), actions: ["agreements.record_signed_copy"] };
  const m = defineManifest({ module: "partnerships", files: [{ ...file, permission: ["partnerships", "view"] }] });
  expect(m.files[0]).toMatchObject({ kind: "contract", permission: ["partnerships", "view"], capability: null });
  expect(() => defineManifest({ module: "partnerships", files: [{ ...file, permission: ["partnerships", "update"] }] })).toThrow(/a file needs "view" or "create"/);
});
