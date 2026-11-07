"use strict";
/**
 * M7's contract (packages/contract/schemas/{partner_pipeline,partners,leads,interactions,proposals,
 * agreements,partnership_analytics}.js; docs/guides/partnerships.md Appendix C): the design kit's
 * content, one schema a layout under one discriminated union, and the rules a request is held to
 * before any service sees it.
 */
const c = require("../../packages/contract");

const ID = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const OTHER = "3f2b1c9e-7d64-4e1a-9b2f-5c8d0e6a1b47";
const ok = (schema, value) => expect(schema.safeParse(value).success).toBe(true);
const no = (schema, value, path) => {
  const r = schema.safeParse(value);
  expect(r.success).toBe(false);
  if (path) expect(r.error.issues.map((i) => i.path.join("."))).toContain(path);
};

/** One valid section of each layout, as the kit's gallery would hold it. */
const SECTIONS = {
  cover: { title: "A Festival Lagos Remembers", prepared_for: "Eko Arts", date: "2026-11-05", reference: "PRO-0001", image_asset_id: null, partner_logo_asset_id: null },
  letter: { paragraphs: ["Thank you for your time on Tuesday.", "Here is what we heard."], signer_name: "Ada Obi", signer_title: "Growth Lead", signer_photo_asset_id: null },
  opportunity: { heading: "The Moment", paragraphs: ["December brings the city out."], pull_quote: null },
  why_mycity: { heading: "Why MyCity", points: [1, 2, 3].map((n) => ({ proof_point_id: null, value: `${n}0,000+`, label: "Downloads" })) },
  audience: { heading: "Who Comes", intro: null, stats: [{ value: "18 to 35", label: "Age" }], chart: { kind: "donut", title: "By City", unit: "%", series: [{ name: null, points: [{ label: "Lagos", value: 60 }, { label: "Abuja", value: 40 }] }] } },
  deliverables: { heading: "What We Do", items: [{ title: "Check-in on MyCityApp", detail: null, icon: "qr-code" }] },
  packages: { heading: "Packages", display: "cards", options: [{ label: "VIP", price: "25000.00", price_note: null, includes: ["Front row"], terms: null }] },
  timeline: { heading: "Timeline", phases: [{ name: "Build-up", starts_on: "2026-11-20", ends_on: null, detail: "Campaign starts" }] },
  proof: { heading: "Proof", logos: [{ proof_point_id: ID, label: "MTN Nigeria" }], results: [] },
  terms: { heading: "Terms", items: [{ label: "Validity", detail: "30 days from signing" }] },
  next_steps: { heading: "Next Steps", steps: ["Sign the agreement"], contact: { name: "Ada Obi", title: null, email: "ada@mycityapp.io", phone: null }, show_qr: true },
  closing: { message: null, image_asset_id: null },
  insight: { heading: "Downloads", takeaway: "Event weeks double downloads", chart: { kind: "line", title: "Downloads", unit: null, series: [{ name: null, points: [{ label: "Oct", value: 4100 }, { label: "Nov", value: 9200 }] }] }, note: null },
};
const section = (layout, extra = {}) => ({ key: layout, layout, ...SECTIONS[layout], ...extra });

describe("the design kit's content", () => {
  test("every layout of the kit has its schema in the union, and nothing else does", () => {
    const union = c.proposals.Section._def.options.map((o) => o.shape.layout.value);
    expect(union.sort()).toEqual([...c.proposals.LayoutName.options].sort());
  });

  test.each(Object.keys(SECTIONS))("a %s section parses, with its defaults filled", (layout) => {
    const r = c.proposals.Section.safeParse(section(layout));
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ layout, hidden: false, sources: [], unconfirmed: [] });
  });

  test("a section is read by its layout: another layout's fields do not pass", () => {
    no(c.proposals.Section, { ...section("letter"), layout: "cover" });
    no(c.proposals.Section, { ...section("cover"), paragraphs: ["Not a cover's"] });
    no(c.proposals.Section, { key: "x", layout: "brochure", title: "No such layout" }, "layout");
  });

  test("each layout holds its limits: a letter is two or three paragraphs, why_mycity three to six points", () => {
    no(c.proposals.Section, section("letter", { paragraphs: ["One alone"] }), "paragraphs");
    no(c.proposals.Section, section("why_mycity", { points: SECTIONS.why_mycity.points.slice(0, 2) }), "points");
    no(c.proposals.Section, section("packages", { options: [] }), "options");
    no(c.proposals.Section, section("audience", { chart: { kind: "pie", title: "x", series: [] } }));
  });

  test("a chart is drawn from figures the kit can draw (TB, 07/11/2026)", () => {
    const pts = (...v) => v.map((value, i) => ({ label: `P${i + 1}`, value }));
    const chart = (kind, series) => ({ kind, title: "Reach", series });
    ok(c.proposals.ProposalChart, chart("stacked", [{ name: "2025", points: pts(1, 2) }, { name: "2026", points: pts(3, 4) }]));
    ok(c.proposals.ProposalChart, chart("progress", [{ points: pts(80, 45) }]));
    no(c.proposals.ProposalChart, chart("donut", [{ points: pts(1, 2) }, { points: pts(3, 4) }]), "series");
    no(c.proposals.ProposalChart, chart("donut", [{ points: pts(1) }]), "series");
    no(c.proposals.ProposalChart, chart("progress", [{ points: pts(120) }]), "series");
    no(c.proposals.ProposalChart, chart("stacked", [{ points: pts(1, 2) }]), "series");
    no(c.proposals.ProposalChart, chart("line", [{ points: pts(1) }]), "series");
    no(c.proposals.ProposalChart, chart("bar", [{ points: pts(1, 2) }, { points: [{ label: "Other", value: 1 }, { label: "P2", value: 2 }] }]), "series");
    // A chart and a drawing ride on the content layouts; an Insight page must have its chart.
    ok(c.proposals.Section, section("opportunity", { chart: SECTIONS.insight.chart, illustration: "stage" }));
    no(c.proposals.Section, section("opportunity", { illustration: "unicorn" }), "illustration");
    no(c.proposals.Section, section("insight", { chart: null }), "chart");
    no(c.proposals.Section, section("deliverables", { items: [{ title: "x", detail: null, icon: "<svg>" }] }));
  });

  test("a figure carries its source; a section lists what Claude could not source", () => {
    ok(c.proposals.Section, section("why_mycity", { sources: [{ figure: "10,000+", source: "proof_point", ref: ID }], unconfirmed: ["35% growth"] }));
    no(c.proposals.Section, section("why_mycity", { sources: [{ figure: "10,000+", source: "guess", ref: null }] }));
  });

  test("a proposal's content is its sections in order, each key once", () => {
    ok(c.proposals.ProposalContent, { sections: [section("cover"), section("letter"), section("closing")] });
    no(c.proposals.ProposalContent, { sections: [section("cover"), section("letter", { key: "cover" })] }, "sections");
    no(c.proposals.ProposalContent, { sections: [] });
  });

  test("an edit is one operation on one section", () => {
    const edit = c.proposals.ProposalContentEdit;
    ok(edit, { op: "move", key: "letter", direction: "up" });
    ok(edit, { op: "layout", key: "packages", layout: "terms" });
    ok(edit, { op: "section", key: "cover", section: section("cover") });
    ok(edit, { op: "image", key: "cover", field: "image_asset_id", document_id: ID, alt: "The festival at night" });
    no(edit, { op: "move", key: "letter", direction: "sideways" });
    no(edit, { op: "delete", key: "letter" });
  });

  test("nothing is sent without the person's confirmation, to at most five", () => {
    const send = { to: ["events@ekoarts.ng"], subject: "Our proposal", message: "As promised." };
    ok(c.proposals.ProposalSend, { ...send, confirm: true });
    no(c.proposals.ProposalSend, send, "confirm");
    no(c.proposals.ProposalSend, { ...send, confirm: false }, "confirm");
    no(c.proposals.ProposalSend, { ...send, to: [], confirm: true }, "to");
    no(c.proposals.ProposalSend, { ...send, to: Array(6).fill("a@b.ng"), confirm: true }, "to");
  });
});

describe("the rules a request is held to", () => {
  const deal = { title: "December Festival", owner_id: ID };

  test("a deal is on a lead or a partner, never both, never neither", () => {
    ok(c.partner_pipeline.DealCreate, { ...deal, lead_id: ID });
    ok(c.partner_pipeline.DealCreate, { ...deal, partner_id: ID, validity: { days: 30 } });
    no(c.partner_pipeline.DealCreate, deal, "partner_id");
    no(c.partner_pipeline.DealCreate, { ...deal, lead_id: ID, partner_id: OTHER }, "partner_id");
  });

  test("a deal's validity is 30 days, 60 days or a date; its event ends after it starts; five options at most", () => {
    no(c.partner_pipeline.DealCreate, { ...deal, lead_id: ID, validity: { days: 45 } }, "validity");
    ok(c.partner_pipeline.DealCreate, { ...deal, lead_id: ID, validity: { until: "2026-11-26" } });
    no(c.partner_pipeline.DealCreate, { ...deal, lead_id: ID, event_starts_on: "2026-12-05", event_ends_on: "2026-12-04" }, "event_ends_on");
    const option = (position) => ({ position, label: `Tier ${position}`, deal_price: "5000.00" });
    no(c.partner_pipeline.DealCreate, { ...deal, lead_id: ID, options: [1, 2, 3, 4, 5, 5].map(option) }, "options");
    no(c.partner_pipeline.DealOptionInput, { position: 6, label: "Sixth" }, "position");
    no(c.partner_pipeline.DealOptionInput, { position: 1, label: "VIP", discount_pct: "120" }, "discount_pct");
  });

  test("Stalled needs its blockers; a reason, when given, is at least ten characters", () => {
    ok(c.partner_pipeline.HealthSet, { health: "follow_up_required" });
    no(c.partner_pipeline.HealthSet, { health: "stalled" }, "blockers");
    ok(c.partner_pipeline.HealthSet, { health: "stalled", blockers: "Waiting on the venue's quote" });
    ok(c.partner_pipeline.StageMove, { stage: "proposal_sent", reason: "" });
    no(c.partner_pipeline.StageMove, { stage: "on_hold", reason: "Paused" }, "reason");
    no(c.partner_pipeline.StageMove, { stage: "Proposal Sent" }, "stage");
  });

  test("a pick custom field needs its choices; a list's stage needs no meaning to be refused, only a known one", () => {
    no(c.partner_pipeline.FieldCreate, { label: "Ticketing", field_type: "pick", applies_to: "deal" }, "options");
    ok(c.partner_pipeline.FieldCreate, { label: "Ticketing", field_type: "pick", options: ["Exclusive", "Shared"], applies_to: "deal" });
    ok(c.partner_pipeline.ListValueCreate, { label: "Verbal Approval", meaning: "negotiation" });
    no(c.partner_pipeline.ListValueCreate, { label: "Won", meaning: "won" }, "meaning");
  });

  test("a region of cities has a city; a new partner is signed, with its copy or before the hub", () => {
    no(c.partners.RegionInput, { scope: "cities" }, "cities");
    ok(c.partners.RegionInput, { scope: "national" });
    const partner = {
      name: "Eko Arts",
      partner_category_id: ID,
      region: { scope: "national" },
      owner_id: ID,
      contact: { first_name: "Bola", last_name: "Ade", phones: ["0803 123 4567"] },
      deal: { ...deal, stage: "partnership_signed" },
    };
    ok(c.partners.PartnerCreate, { ...partner, signed_before_hub: true });
    ok(c.partners.PartnerCreate, { ...partner, signed_copy_document_id: ID });
    no(c.partners.PartnerCreate, partner, "signed_copy_document_id");
    no(c.partners.PartnerCreate, { ...partner, signed_copy_document_id: ID, signed_before_hub: true }, "signed_copy_document_id");
    expect(c.partners.PartnerCreate.parse({ ...partner, signed_before_hub: true }).contact.phones).toEqual(["+2348031234567"]);
  });

  test("a lead comes with its contact and its first deal", () => {
    const lead = { name: "Kano Fair", partner_category_id: ID, region: { scope: "national" }, owner_id: ID, contact: { first_name: "Musa", last_name: "Bello" }, deal };
    ok(c.leads.LeadCreate, lead);
    no(c.leads.LeadCreate, { ...lead, deal: undefined }, "deal");
    no(c.leads.LeadCreate, { ...lead, deal: { ...deal, lead_id: ID } });
    no(c.leads.LeadLose, { reason: "No" }, "reason");
  });

  test("an interaction and a thread link name one record; the Workspace link a partner or a lead", () => {
    const interaction = { interaction_type: "visit", occurred_at: "2026-11-05T10:00:00+01:00", subject: "Venue walk", summary: "Walked the venue with their team" };
    ok(c.interactions.InteractionCreate, { ...interaction, lead_id: ID });
    no(c.interactions.InteractionCreate, interaction, "partner_id");
    no(c.interactions.InteractionCreate, { ...interaction, partner_id: ID, summary: "Short" }, "summary");
    no(c.interactions.ThreadPartnerBind, { partner_id: ID, lead_id: OTHER }, "partner_id");
    ok(c.partners.PartnerLink, {});
    ok(c.partners.PartnerLink, { lead_id: ID, deal_id: OTHER });
    no(c.partners.PartnerLink, { partner_id: ID, lead_id: OTHER }, "lead_id");
    no(c.partners.PartnerLink, { deal_id: ID }, "partner_id");
  });

  test("signing is a six-digit code, a drawn or typed signature, and consent", () => {
    ok(c.agreements.SignCodeVerify, { code: "042917" });
    no(c.agreements.SignCodeVerify, { code: "42917" }, "code");
    const sign = { full_name: "Bola Ade", method: "draw", signature_png: "data:image/png;base64,iVBORw0KGgo=", consent: true };
    ok(c.agreements.SignSubmit, sign);
    no(c.agreements.SignSubmit, { ...sign, signature_png: undefined }, "signature_png");
    no(c.agreements.SignSubmit, { ...sign, signature_png: "data:image/svg+xml;base64,PHN2Zz4=" }, "signature_png");
    no(c.agreements.SignSubmit, { ...sign, method: "type" }, "typed");
    no(c.agreements.SignSubmit, { ...sign, consent: false }, "consent");
    no(c.agreements.AgreementSend, { signers: [{ name: "Bola Ade", email: "bola@ekoarts.ng", side: "partner" }] }, "confirm");
  });

  test("a custom period has its dates; lists take a page and a sort, never a size", () => {
    no(c.partnership_analytics.AnalyticsQuery, { period: "custom" }, "from");
    ok(c.partnership_analytics.AnalyticsQuery, { period: "custom", from: "2026-10-01", to: "2026-12-31" });
    expect(c.partnership_analytics.AnalyticsQuery.parse({}).period).toBe("month");
    ok(c.partner_pipeline.DealListQuery, { page: "2", sort: "-expected_close_on", custom: '{"ticketing":"Exclusive"}' });
    no(c.partner_pipeline.DealListQuery, { custom: "[1,2]" }, "custom");
    no(c.partner_pipeline.DealListQuery, { limit: "100" });
    no(c.leads.LeadListQuery, { sort: "-owner_id" }, "sort");
  });
});
