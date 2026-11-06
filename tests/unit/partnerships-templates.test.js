"use strict";
/**
 * The pieces M7 PR 2 adds beneath Partnerships · Categories, without a database (docs/guides/partnerships.md
 * §6.3, §6.8): the Markdown converter's tables, the wording's field checks and chips, Tidy With AI's guard on
 * the words, the dropdown reader behind Start From Tracker and what it suggests, and the registered action.
 */
const ExcelJS = require("exceljs");
const md = require("../../src/shared/documents/markdown");
const wording = require("../../src/modules/templates/templates.agreements");
const tidy = require("../../src/modules/agreements/agreements.tidy");
const setup = require("../../src/modules/partner_pipeline/partner_pipeline.setup");
const lists = require("../../src/modules/partner_pipeline/partner_pipeline.lists");
const fields = require("../../src/modules/partner_pipeline/partner_pipeline.fields");
const { readDropdowns } = require("../../src/shared/spreadsheet/parse");
const actions = require("../../src/services/ai/actions");
const c = require("@mycity/contract");

const TABLE = "<table><tbody><tr><th>Item</th><th>Amount</th></tr><tr><td><strong>Fee</strong> | listing</td><td>{{ money x }}</td></tr></tbody></table>";

describe("htmlToMarkdown and tables", () => {
  test("flattens a table as it always did, unless asked to keep it", () => {
    expect(md.htmlToMarkdown(TABLE)).toBe("Item · Amount\n\n**Fee** | listing · {{ money x }}");
  });

  test("keeps a table as the pipe table markdownToHtml reads, its first row the header", () => {
    const kept = md.htmlToMarkdown(`<p>Charges</p>${TABLE}<p>After</p>`, { tables: true });
    expect(kept).toBe("Charges\n\n| Item | Amount |\n| --- | --- |\n| **Fee** / listing | {{ money x }} |\n\nAfter");
    expect(md.markdownToHtml(kept)).toContain("<table><tr><th>Item</th><th>Amount</th></tr><tr><td><strong>Fee</strong> / listing</td>");
  });

  test("a table with ragged rows is padded, and an empty one is dropped", () => {
    const kept = md.htmlToMarkdown("<table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table><table></table>", { tables: true });
    expect(kept).toBe("| A | B |\n| --- | --- |\n| C |   |");
  });

  test("no tag survives, whatever was pasted", () => {
    expect(md.htmlToMarkdown('<table><tr><td><script>alert(1)</script><img src=x onerror=y>safe</td></tr></table>', { tables: true })).not.toMatch(/<|alert/);
  });
});

describe("an agreement template's wording", () => {
  const custom = [{ key: "ticket_model", label: "Ticket Model", field_type: "pick" }, { key: "fee", label: "Fee", field_type: "money" }];
  const asks = [{ key: "opening_hours", label: "Opening Hours", type: "text" }, { key: "start", label: "Start", type: "date" }];
  const catalog = wording.catalogOf(custom, asks);

  test("the catalogue holds the record's fields, the category's own and the asks, each with the format its type is written in", () => {
    expect(catalog.get("partner.name")).toMatchObject({ label: "Business Name", type: "text" });
    expect(catalog.get("custom.fee")).toMatchObject({ type: "money", source: "custom" });
    expect(catalog.get("ask.start")).toMatchObject({ type: "date", source: "ask" });
    expect(wording.tagOf(catalog.get("ask.start"))).toBe("{{ longdate ask.start }}");
    expect(wording.tagOf(catalog.get("custom.fee"))).toBe("{{ money custom.fee }}");
    expect(wording.tagOf(catalog.get("partner.name"))).toBe("{{ partner.name }}");
  });

  test("wording that names only what it can fill passes, formats and conditions included", () => {
    expect(() =>
      wording.checkNames("Date {{ longdate today }}\n\n{{ partner.name }} {{ custom.ticket_model }} {{ ask.opening_hours }} {{#if deal.options}}{{ deal.options }}{{/if}} {{ org.name }}", catalog),
    ).not.toThrow();
  });

  test("a name that is no record field, no custom field of the category and no ask is refused, naming it", () => {
    expect.assertions(4);
    try {
      wording.checkNames("{{ partner.nickname }} and {{ ask.bank }} and {{ custom.other }}", catalog);
    } catch (err) {
      expect(err.code).toBe("TEMPLATE_UNKNOWN_VARIABLE");
      expect(err.status).toBe(422);
      expect(err.fields.body_html).toHaveLength(3);
      expect(err.message).toMatch(/partner\.nickname/);
    }
  });

  test("a broken tag is refused with the line, not a stack", () => {
    expect(() => wording.checkNames("Dear {{ partner.name", catalog)).not.toThrow(); // an unclosed brace is text
    expect(() => wording.checkNames("{{#if partner.name}}never closed", catalog)).toThrow(expect.objectContaining({ code: "TEMPLATE_INVALID" }));
    expect(() => wording.checkNames("{{ shout partner.name }}", catalog)).toThrow(expect.objectContaining({ code: "TEMPLATE_INVALID" }));
  });

  test("two asks with one key are refused", () => {
    expect(() => wording.checkAsks([{ key: "a" }, { key: "a" }])).toThrow(expect.objectContaining({ code: "ASK_DUPLICATE" }));
    expect(() => wording.checkAsks([{ key: "a" }, { key: "b" }])).not.toThrow();
  });

  test("the editor's HTML becomes Markdown, and wording too short to be an agreement is refused", () => {
    const html = '<h2>Agreement</h2><p>Business Name: <span data-field="partner.name" data-label="Business Name">{{ partner.name }}</span> agrees to the terms below in full.</p><ol><li>Pay promptly.</li></ol>';
    expect(wording.wordingFrom(html)).toBe("## Agreement\n\nBusiness Name: {{ partner.name }} agrees to the terms below in full.\n\n1. Pay promptly.");
    expect(() => wording.wordingFrom("<p>{{ partner.name }}</p>")).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  test("kept wording opens in the editor with a chip for every field, labelled, and a retired field still shows", () => {
    const html = wording.editorHtml("Hello {{ longdate deal.valid_until }} and {{ ask.opening_hours }} and {{ custom.gone }}.", catalog);
    expect(html).toContain('<span data-field="deal.valid_until" data-label="Valid Until">{{ longdate deal.valid_until }}</span>');
    expect(html).toContain('data-label="Opening Hours"');
    expect(html).toContain('<span data-field="custom.gone" data-label="custom.gone">{{ custom.gone }}</span>');
  });

  test("a chip's label cannot break out of its attribute", () => {
    const evil = wording.catalogOf([{ key: "x", label: '"><img src=x onerror=1>', field_type: "text" }], []);
    expect(wording.editorHtml("{{ custom.x }}", evil)).not.toContain("<img");
  });
});

describe("Tidy With AI's guard", () => {
  const before = "Deal Merchant Agreement\n\nBusiness Name: Eko Arts Fair\n\nValid until 26th November, 2026\n\n1. Event registration.\n2. Amplification.";

  test("the words outside the values it replaced must be the words that were sent", () => {
    const after = "## Deal Merchant Agreement\n\nBusiness Name: {{ partner.name }}\n\nValid until {{ longdate deal.valid_until }}\n\n1. Event registration.\n2. Amplification.";
    const replaced = ["Eko Arts Fair", "26th November, 2026"];
    expect(tidy.sameWords(before, after, replaced)).toBe(true);
    expect(tidy.sameWords(before, after.replace("Amplification", "Amplify"), replaced)).toBe(false);
    expect(tidy.sameWords(before, after.replace("Event registration.", ""), replaced)).toBe(false);
    expect(tidy.sameWords(before, `${after}\n\nThis agreement is binding.`, replaced)).toBe(false);
    // A value the model said it replaced but left in place is a changed word too.
    expect(tidy.sameWords(before, after.replace("{{ partner.name }}", "Eko Arts Fair"), replaced)).toBe(false);
  });

  test("a value broken over lines in the paste still matches, and numbered clauses are layout", () => {
    const pasted = "Business Name:  Eko\nArts   Fair\n\n3) Pay on time";
    expect(tidy.sameWords(pasted, "Business Name: {{ partner.name }}\n\n1. Pay on time", ["Eko Arts Fair"])).toBe(true);
  });

  test("every field the answer names must be a record field or an ask it declares", () => {
    const ok = {
      body_markdown: "{{ longdate today }} {{ partner.name }} {{ ask.opening_hours }}",
      fields: [{ found: "24hrs", field: "ask.opening_hours", source: "ask", label: "Opening Hours", ask_type: "text" }],
    };
    expect(tidy.fieldProblems(ok)).toEqual([]);
    expect(tidy.fieldProblems({ ...ok, body_markdown: "{{ partner.nickname }}" })).toHaveLength(1);
    expect(tidy.fieldProblems({ ...ok, body_markdown: "{{ ask.undeclared }}" })).toHaveLength(1);
    expect(tidy.fieldProblems({ ...ok, body_markdown: "{{ shout partner.name }}" })[0]).toMatch(/not a format/);
    expect(tidy.fieldProblems({ ...ok, fields: [{ ...ok.fields[0], ask_type: null }] })).toHaveLength(1);
  });

  test("the model's answer schema holds a draft to the contract", () => {
    const out = c.partner_pipeline.TemplateTidyOutput;
    expect(out.safeParse({ body_markdown: "x", fields: [] }).success).toBe(true);
    expect(out.safeParse({ body_markdown: "", fields: [] }).success).toBe(false);
    expect(out.safeParse({ body_markdown: "x", fields: [], extra: 1 }).success).toBe(false);
  });

  test("template-tidy is registered on Default, with personal data, chosen by JP", () => {
    expect(actions.of("template-tidy")).toMatchObject({ job: "default", personal_data: true, chosen_by: "JP", chosen_at: "2026-11-06", module: "partnerships", built: true });
  });
});

describe("Start From Tracker's reader", () => {
  async function workbook() {
    const wb = new ExcelJS.Workbook();
    const l = wb.addWorksheet("Lists");
    ["Prospect Identified", "Proposal Sent", "Partnership Signed", "Closed Lost"].forEach((v, i) => (l.getCell(i + 1, 1).value = v));
    l.getCell(5, 1).value = "prospect identified"; // a repeat in other letters is one value
    const ws = wb.addWorksheet("Master Tracker");
    ws.getRow(2).values = ["S/N", "Partner Name", "Partnership Type", "Partnership Stage", "Current Stage", "Potential Impact"];
    for (let r = 3; r <= 6; r += 1) {
      ws.getCell(`C${r}`).dataValidation = { type: "list", formulae: ['"Event,Hospitality,Ticketing (exclusive), 8% commission"'] };
      ws.getCell(`D${r}`).dataValidation = { type: "list", formulae: ["Lists!$A$1:$A$5"] };
      ws.getCell(`F${r}`).dataValidation = { type: "list", formulae: ['"Brand Visibility,Revenue Generation"'] };
      ws.getCell(`B${r}`).dataValidation = { type: "textLength", operator: "lessThan", formulae: [50] };
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  test("each dropdown column comes back with its header and its distinct values; other validations are ignored", async () => {
    const found = await readDropdowns({ buffer: await workbook() });
    const mine = found.filter((d) => d.sheet === "Master Tracker");
    expect(mine.map((d) => [d.column, d.header])).toEqual([["C", "Partnership Type"], ["D", "Partnership Stage"], ["F", "Potential Impact"]]);
    expect(mine[0].values).toEqual(["Event", "Hospitality", "Ticketing (exclusive)", "8% commission"]);
    expect(mine[1].values).toEqual(["Prospect Identified", "Proposal Sent", "Partnership Signed", "Closed Lost"]);
    expect(mine[2].values).toEqual(["Brand Visibility", "Revenue Generation"]);
  });

  test("a workbook that is not one is refused kindly", async () => {
    await expect(readDropdowns({ buffer: Buffer.from("not a workbook") })).rejects.toMatchObject({ code: "SHEET_UNREADABLE" });
  });

  test("a column is a stage, a type or an impact by its header; 'Current Stage' is none", () => {
    expect(["Partnership Stage", "Partnership Type", "Type", "Potential Impact", "Current Stage", "Status", null].map(setup.kindOf)).toEqual(["stages", "categories", "categories", "impact", null, null, null]);
  });

  test("MyCity's thirteen stages get the meanings the guide gives them; a stage the words do not place counts as the one before", () => {
    const labels = ["Prospect Identified", "Initial Contact", "Introductory Meeting Scheduled", "Introductory Meeting Held", "Proposal Sent", "Follow-up Ongoing", "Negotiation", "Verbal Approval", "Contract Review", "Partnership Signed", "Active Partnership", "Closed Lost", "On Hold"];
    expect(setup.suggestMeanings(labels).map((s) => s.meaning)).toEqual(["prospect", "contacted", "meeting", "meeting", "proposal", "proposal", "negotiation", "negotiation", "negotiation", "signed", "active", "closed_lost", "on_hold"]);
    expect(setup.suggestMeanings(["Prospect Identified", "Initial Contact", "Onboarding Call"]).map((s) => s.meaning)).toEqual(["prospect", "contacted", "contacted"]);
    expect(setup.suggestMeanings(["Mystery"])[0].meaning).toBe("prospect");
  });

  test("a type that carries a commission in its words is that category and that commission", () => {
    expect(setup.categoryOf("Ticketing (exclusive), 8% commission")).toEqual({ name: "Ticketing (exclusive)", default_commission_pct: "8" });
    expect(setup.categoryOf("Event")).toEqual({ name: "Event", default_commission_pct: undefined });
    expect(setup.categoryOf("Hotels 12.5% commission").default_commission_pct).toBe("12.5");
  });
});

describe("codes and keys made from names", () => {
  test("a stage's code and a custom field's key are made from the name, a letter first", () => {
    expect(lists.codeOf("Proposal Sent")).toBe("proposal_sent");
    expect(lists.codeOf("  Follow-up (ongoing)! ")).toBe("follow_up_ongoing");
    expect(lists.codeOf("24 Hour Review")).toBe("v_24_hour_review");
    expect(fields.keyOf("Ticket Model")).toBe("ticket_model");
    expect(fields.keyOf("2nd Venue")).toBe("f_2nd_venue");
    expect(fields.keyOf("Étage")).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});
