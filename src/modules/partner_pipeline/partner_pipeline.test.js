"use strict";
/**
 * The pipeline's rules without a database (docs/guides/partnerships.md §6.4 to §6.6): a lead's status
 * read from a stage's meaning, the stage switcher's rules, and an option's commission and take.
 */
const lists = require("./partner_pipeline.lists");
const options = require("./partner_pipeline.options");
const { ruleOf } = require("./partner_pipeline.stages");

const STAGES = [
  ["prospect_identified", "prospect"],
  ["initial_contact", "contacted"],
  ["proposal_sent", "proposal"],
  ["negotiation", "negotiation"],
  ["partnership_signed", "signed"],
  ["active_partnership", "active"],
  ["closed_lost", "closed_lost"],
  ["on_hold", "on_hold"],
  ["old_stage", "prospect", false],
].map(([code, meaning, active = true], i) => ({ code, label: code, meaning, position: i * 10, active }));

const deal = (stage, signed_at = null) => ({ stage, signed_at, status: signed_at ? "live" : "open" });

describe("a lead's status, read from its deal's stage (§6.4)", () => {
  test.each([
    ["prospect", "new"],
    ["contacted", "contacted"],
    ["meeting", "contacted"],
    ["proposal", "qualified"],
    ["negotiation", "qualified"],
    ["closed_lost", "lost"],
    ["signed", "converted"],
    ["active", "converted"],
  ])("%s is %s", (meaning, status) => expect(lists.leadStatusOf(meaning, "new")).toBe(status));

  test("On Hold keeps the status it had", () => {
    expect(lists.leadStatusOf("on_hold", "qualified")).toBe("qualified");
  });

  test("a new deal opens at the first active stage; a meaning's first is the earliest active one", () => {
    expect(lists.firstStage(STAGES).code).toBe("prospect_identified");
    expect(lists.firstOf(STAGES, "closed_lost").code).toBe("closed_lost");
    expect(lists.firstOf(STAGES, "meeting")).toBeNull();
  });
});

describe("the stage switcher's rules (§6.5)", () => {
  const fields = (fn) => {
    try {
      fn();
    } catch (err) {
      return err.fields;
    }
    return null;
  };

  test("the stage it is at, and a retired stage, are refused", () => {
    expect(fields(() => ruleOf(STAGES, deal("initial_contact"), "initial_contact"))).toEqual({ stage: ["Already at this stage"] });
    expect(fields(() => ruleOf(STAGES, deal("initial_contact"), "old_stage"))).toEqual({ stage: ["Pick a stage"] });
  });

  test("forward needs no reason; back, On Hold and Closed Lost need one; leaving On Hold does not", () => {
    expect(ruleOf(STAGES, deal("initial_contact"), "negotiation").needsReason).toBe(false);
    expect(ruleOf(STAGES, deal("negotiation"), "initial_contact")).toMatchObject({ back: true, needsReason: true });
    expect(ruleOf(STAGES, deal("negotiation"), "on_hold").needsReason).toBe(true);
    expect(ruleOf(STAGES, deal("negotiation"), "closed_lost").needsReason).toBe(true);
    expect(ruleOf(STAGES, deal("on_hold"), "initial_contact")).toMatchObject({ back: false, needsReason: false });
  });

  test("entering a signed meaning signs an unsigned deal; a signed deal never goes back before signing", () => {
    expect(ruleOf(STAGES, deal("negotiation"), "partnership_signed").signs).toBe(true);
    expect(ruleOf(STAGES, deal("negotiation"), "active_partnership").signs).toBe(true);
    const live = deal("partnership_signed", new Date());
    expect(ruleOf(STAGES, live, "active_partnership").signs).toBe(false);
    expect(fields(() => ruleOf(STAGES, live, "negotiation"))).toEqual({ stage: ["Already signed"] });
    expect(ruleOf(STAGES, live, "closed_lost").needsReason).toBe(true);
  });
});

describe("a deal's options (§6.6)", () => {
  test("the commission defaults to the price times the rate, the take to the price less it", () => {
    expect(options.withDefaults([{ position: 1, label: "VIP", deal_price: "25000.00" }], "8.00")).toEqual([
      { position: 1, label: "VIP", original_price: null, discount_pct: null, deal_price: "25000.00", price_note: null, commission_amount: "2000.00", merchant_take: "23000.00" },
    ]);
  });

  test("what a holder of partnerships.money sets is kept; a price note has no money", () => {
    const [set, note] = options.withDefaults(
      [
        { position: 1, label: "Regular", deal_price: "10000.00", commission_amount: "500.00" },
        { position: 2, label: "Free Entry", price_note: "Free Entry" },
      ],
      "8.00",
    );
    expect(set).toMatchObject({ commission_amount: "500.00", merchant_take: "9500.00" });
    expect(note).toMatchObject({ deal_price: null, commission_amount: null, merchant_take: null });
  });

  test("a position used twice is refused on the second", () => {
    expect(() =>
      options.withDefaults(
        [
          { position: 1, label: "A" },
          { position: 1, label: "B" },
        ],
        null,
      ),
    ).toThrow(expect.objectContaining({ fields: { "options.1.position": ["Used twice"] } }));
  });

  test("a rate other than the category's deviates; with no default nothing does", () => {
    expect(options.deviates("10.00", "8.00")).toBe(true);
    expect(options.deviates("8", "8.00")).toBe(false);
    expect(options.deviates("8.00", null)).toBe(false);
  });
});
