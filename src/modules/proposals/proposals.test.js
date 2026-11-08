"use strict";
/**
 * Proposals' assistant surface and search (docs/guides/partnerships.md §9): one read and one card, each
 * of the module's create and edit forms accounted for, and ⌘K finding the newest version of each
 * proposal by the rule Proposals keeps. The studio itself runs on the real database in
 * tests/integration/partnerships-proposals.test.js.
 */
const c = require("@mycity/contract");
const manifest = require("./proposals.ai");
const search = require("./proposals.search");

describe("proposals: Praxis AI", () => {
  test("reads the list and offers New Proposal as a card of the deal and the notes", () => {
    expect(manifest.reads.map((r) => r.key)).toEqual(["proposals.list"]);
    const [card] = manifest.actions;
    expect(card).toMatchObject({ key: "proposals.start", permission: ["partnerships", "create"], risk: "standard" });
    expect(card.input).toBe(c.proposals.ProposalBriefAdd);
    expect(c.proposals.ProposalBriefAdd.safeParse({ deal_id: "00000000-0000-4000-8000-000000000001", notes: "Three nights." }).success).toBe(true);
    expect(c.proposals.ProposalBriefAdd.safeParse({ deal_id: "00000000-0000-4000-8000-000000000001", transcript_document_id: "x" }).success).toBe(false);
  });

  test("every create and edit form of the contract is in the chat or never, for a written reason", () => {
    const forms = Object.keys(c.proposals).filter((k) => /(Create|Edit|Update|Patch|Save)$/.test(k));
    for (const form of forms) expect([form, /^(design|file|secret|ai|via [a-z_.]+):/.test(manifest.not_offered[form] || "")]).toEqual([form, true]);
  });
});

describe("proposals: ⌘K", () => {
  test("finds proposals by number, title and partner, the newest version only, within the reader's scope", () => {
    expect(search.type).toBe("proposal");
    expect(search.words).toEqual(expect.arrayContaining(["proposal", "pitch"]));
  });
});
