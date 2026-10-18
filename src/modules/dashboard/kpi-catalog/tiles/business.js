"use strict";
/**
 * Business cards: the partnership pipeline, active and quiet partners, value signed this
 * year and proposals out. Every one reads through the partners source adapter (M7), whose
 * header says what each word means until M7 settles its vocabularies, in the reader's
 * scope on `partnerships` (a partner, an opportunity or an agreement is its owner's).
 */
const partners = require("../../sources/partners.source");
const { cell, linkTo, plural, record, records } = require("../shared");

/** The reader's scope on partnerships. */
const scopeOf = (ctx) => ctx.scope("partnerships");

const ENTRIES = [
  {
    id: "partnership_pipeline",
    domain: "business",
    label: "Open Opportunities",
    unit: "count",
    module: "partnerships",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "partners",
    value: (client, g, ctx) => g.count(() => partners.pipelineCount(client, scopeOf(ctx))),
    detail: {
      title: "Open Opportunities",
      columns: [
        { key: "opportunity", label: "Opportunity" },
        { key: "partner", label: "Partner", phone: true },
        { key: "stage", label: "Stage", phone: true },
        { key: "owner", label: "Owner" },
        { key: "value", label: "Value", numeric: true },
        { key: "expected_close", label: "Expected Close" },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(await partners.pipelinePage(client, scopeOf(ctx), query), (r) =>
          record(
            r.partnership_opportunity_id,
            {
              opportunity: cell.text(r.title),
              partner: cell.text(r.partner),
              stage: cell.text(r.stage_label),
              owner: cell.person(r.owner),
              value: cell.money(r.estimated_value, r.currency),
              expected_close: cell.date(r.expected_close_on),
            },
            linkTo("partner_deal", r.partnership_opportunity_id),
          ),
        ),
    },
  },
  {
    id: "partnerships_active",
    domain: "business",
    label: "Active Partnerships",
    unit: "count",
    module: "partnerships",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "partners",
    value: (client, g, ctx) => g.count(() => partners.activeCount(client, scopeOf(ctx))),
    detail: {
      title: "Active Partnerships",
      columns: [
        { key: "partner", label: "Partner" },
        { key: "type", label: "Type" },
        { key: "owner", label: "Owner", phone: true },
        { key: "last_contact", label: "Last Contact", phone: true },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(await partners.activePage(client, scopeOf(ctx), query), (r) =>
          record(
            r.partner_id,
            {
              partner: cell.text(r.name),
              type: cell.text(r.partner_type),
              owner: cell.person(r.owner),
              last_contact: cell.time(r.last_contact_at),
            },
            linkTo("partner", r.partner_id),
          ),
        ),
    },
  },
  {
    id: "partnerships_signed_value",
    domain: "business",
    label: "Signed Value",
    unit: "money",
    module: "partnerships",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "partners",
    value: (client, g, ctx) =>
      g.money(async () => {
        const v = await partners.signedValue(client, { today: ctx.today }, scopeOf(ctx));
        return { amount: v.amount, agreements: v.n };
      }),
    caption: (f) => plural(f.agreements, "agreement"),
    detail: {
      title: "Signed This Year",
      columns: [
        { key: "agreement", label: "Agreement" },
        { key: "partner", label: "Partner", phone: true },
        { key: "starts_on", label: "Starts" },
        { key: "value", label: "Value", numeric: true, phone: true },
        { key: "owner", label: "Owner" },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(await partners.signedPage(client, { today: ctx.today }, scopeOf(ctx), query), (r) =>
          record(
            r.partnership_agreement_id,
            {
              agreement: cell.text(r.title || r.number),
              partner: cell.text(r.partner),
              starts_on: cell.date(r.starts_on),
              value: cell.money(r.value, r.currency),
              owner: cell.person(r.owner),
            },
            linkTo("agreement", r.partnership_agreement_id),
          ),
        ),
    },
  },
  {
    id: "partnerships_quiet_30d",
    domain: "business",
    label: "No Contact 30 Days",
    unit: "count",
    module: "partnerships",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: "warn",
    source: "partners",
    value: (client, g, ctx) => g.count(() => partners.quietCount(client, { today: ctx.today }, scopeOf(ctx))),
    detail: {
      title: "No Contact 30 Days",
      columns: [
        { key: "partner", label: "Partner" },
        { key: "owner", label: "Owner", phone: true },
        { key: "last_contact", label: "Last Contact", phone: true },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(await partners.quietPage(client, { today: ctx.today }, scopeOf(ctx), query), (r) =>
          record(
            r.partner_id,
            { partner: cell.text(r.name), owner: cell.person(r.owner), last_contact: cell.time(r.last_contact_at) },
            linkTo("partner", r.partner_id),
          ),
        ),
    },
  },
  {
    id: "proposals_out",
    domain: "business",
    label: "Proposals Out",
    unit: "count",
    module: "partnerships",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "partners",
    value: (client, g, ctx) => g.count(() => partners.proposalsOutCount(client, scopeOf(ctx))),
    detail: {
      title: "Proposals Out",
      columns: [
        { key: "proposal", label: "Proposal" },
        { key: "opportunity", label: "Opportunity" },
        { key: "partner", label: "Partner", phone: true },
        { key: "sent", label: "Sent", phone: true },
        { key: "value", label: "Value", numeric: true },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(await partners.proposalsOutPage(client, scopeOf(ctx), query), (r) =>
          record(
            r.partnership_proposal_id,
            {
              proposal: cell.text(r.number),
              opportunity: cell.text(r.opportunity),
              partner: cell.text(r.partner),
              sent: cell.time(r.sent_at),
              value: cell.money(r.value, r.currency),
            },
            linkTo("proposal", r.partnership_proposal_id),
          ),
        ),
    },
  },
];

module.exports = { ENTRIES };
