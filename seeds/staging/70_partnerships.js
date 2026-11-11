"use strict";
/**
 * Staging demonstration data: MyCity's partnerships as they look in use (docs/guides/partnerships.md
 * §4.3, §6.17, Appendix B; F13). A synthetic tracker: invented organisations and contacts in the real
 * tracker's shapes, owned by MyCity's real staff (seeds/staging/lib/staff.js). Production starts empty
 * (A5): MyCity imports its own tracker there.
 *
 *   partners     signed before the hub, each with a live deal, its options, months of returns and the
 *                latest contact; one quiet for 45 days, so Home raises Partner Inactivity and the
 *                follow-up job its task
 *   leads        one a stage of the pipeline, with their contacts and deals: a meeting logged, one
 *                Stalled with its blockers, one Closed Lost
 *   proposals    one sent (its link opens on a phone) and one in Draft, both filled from the record
 *                (Build by Hand: the seed never asks Claude)
 *   agreements   one Draft, one In Approval, and one approved through the Partner Agreement flow and
 *                recorded signed, which converts its lead and runs the daily job to Active
 *
 * Home's own demonstration rows in the M7 tables go first (removeHomeStagingRows, in this seed's
 * transaction; seeds/staging/lib/home-staging-rows.js). Categories, stages and the Events template
 * are 65_partnership_setup.js's. Everything else goes through the modules' services, as their screens
 * do. Run only by `scripts/db/seed.js --staging`. Idempotent: a record is found by its name, and a
 * second run adds nothing.
 */
const path = require("node:path");
const { realStaff } = require("./lib/staff");
const { removeHomeStagingRows } = require("./lib/home-staging-rows");

const src = (p) => require(path.join(__dirname, "..", "..", "src", p));

/** Home's tables in M7, children first (home-staging-rows.js DELETE_ORDER). */
const PARTNERSHIP_TABLES = [
  "partner_interaction",
  "partnership_agreement",
  "partnership_proposal",
  "partnership_opportunity",
  "partner",
];

/** A signed PDF, as a scan of a paper signature would arrive. */
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
);

const OPTIONS = [
  {
    position: 1,
    label: "Regular",
    original_price: "15000.00",
    discount_pct: "10",
    deal_price: "13500.00",
  },
  {
    position: 2,
    label: "VIP",
    original_price: "45000.00",
    discount_pct: "10",
    deal_price: "40500.00",
  },
  {
    position: 3,
    label: "VVIP",
    original_price: "120000.00",
    discount_pct: "5",
    deal_price: "114000.00",
  },
];

/**
 * The partners: signed before the hub. `returns` is months back from this one, each with downloads and
 * MyCity's commission; `contact` how many days ago they were last spoken to.
 */
const PARTNERS = Object.freeze([
  {
    name: "Lumen Arts Festival",
    category: "Event",
    owner: "head",
    industry: "Arts & Culture",
    value: "6500000.00",
    deal: "Lumen Arts Festival 2026",
    event: 40,
    options: OPTIONS,
    contact: 3,
    returns: [
      [5, 120, "48000.00"],
      [4, 210, "86000.00"],
      [3, 340, "121000.00"],
      [2, 280, "97500.00"],
      [1, 460, "152000.00"],
      [0, 190, "64000.00"],
    ],
  },
  {
    name: "Harbourline Hotels",
    category: "Hospitality",
    owner: "head_team:1",
    industry: "Hospitality",
    value: "2400000.00",
    deal: "Harbourline Weekend Packages",
    contact: 9,
    returns: [
      [3, 80, "36000.00"],
      [2, 95, "41000.00"],
      [1, 130, "52500.00"],
      [0, 60, "22000.00"],
    ],
  },
  {
    name: "Kora Street Kitchens",
    category: "Vendor",
    owner: "head_team:2",
    industry: "Food & Drink",
    value: "900000.00",
    deal: "Kora Street Listings",
    contact: 45,
    returns: [
      [2, 40, "9000.00"],
      [1, 35, "7500.00"],
    ],
  },
  {
    name: "Brightwave Radio",
    category: "Media",
    owner: "head",
    industry: "Media",
    value: "1800000.00",
    deal: "Brightwave Drive-Time Features",
    contact: 12,
    returns: [
      [2, 300, "0.00"],
      [1, 420, "0.00"],
      [0, 260, "0.00"],
    ],
  },
]);

/**
 * The leads: each at a stage of MyCity's pipeline (65's labels). `meeting` logs a meeting days ago;
 * `stalled` its blockers; `lost` its reason; `agreement` how far its agreement has gone.
 */
const LEADS = Object.freeze([
  {
    name: "Gidi Food Carnival",
    category: "Event",
    owner: "head",
    industry: "Food & Drink",
    stage: "Proposal Sent",
    value: "4200000.00",
    event: 55,
    options: OPTIONS,
    meeting: 8,
    proposal: "sent",
  },
  {
    name: "Oduduwa Craft Market",
    category: "Vendor",
    owner: "head_team:2",
    industry: "Crafts",
    stage: "Introductory Meeting Held",
    value: "650000.00",
    meeting: 4,
  },
  {
    name: "Niger Delta Film Week",
    category: "Event",
    owner: "head_team:1",
    industry: "Film",
    stage: "Negotiation",
    value: "3100000.00",
    event: 70,
    options: OPTIONS,
    stalled: "Waiting on the festival board to approve the ticket split",
    agreement: "draft",
  },
  {
    name: "Plateau Coffee Co",
    category: "Vendor",
    owner: "head",
    industry: "Food & Drink",
    stage: "Prospect Identified",
    value: "300000.00",
  },
  {
    name: "Savanna Ride Share",
    category: "Strategic",
    owner: "head",
    industry: "Mobility",
    stage: "Initial Contact",
    value: "5000000.00",
  },
  {
    name: "Coastline Boat Tours",
    category: "Tourism",
    owner: "head_team:3",
    industry: "Tourism",
    stage: "Introductory Meeting Scheduled",
    value: "750000.00",
    lost: "They chose to sell their tours only through their own website",
  },
  {
    name: "Lagoon Youth Fest",
    category: "Event",
    owner: "manager",
    industry: "Non-profit",
    stage: "Contract Review",
    value: "1200000.00",
    event: 30,
    options: OPTIONS,
    agreement: "approval",
  },
  {
    name: "Tallow Tech Summit",
    category: "Event",
    owner: "head_team:1",
    industry: "Technology",
    stage: "Contract Review",
    value: "5600000.00",
    event: 25,
    options: OPTIONS,
    meeting: 15,
    agreement: "signed",
    proposal: "draft",
  },
]);

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");

/** The person a slot names, as Home's seed reads posts (lib/forward-rows.js personOf). */
function personOf(staff, slot) {
  const [post, nth] = slot.split(":");
  if (post === "head_team")
    return staff.reportsOf(staff.head)[Number(nth) - 1] || staff.head;
  return staff[post] || null;
}

async function seed({ pool, actor: seedActor, log = () => {} }) {
  const lagos = src("shared/time/lagos");
  const { atomically } = src("shared/db/tx");
  const grants = src("shared/rbac/grants-cache");
  const lists = src("modules/partner_pipeline/partner_pipeline.lists");
  const leads = src("modules/leads/leads.service");
  const partners = src("modules/partners/partners.service");
  const stages = src("modules/partner_pipeline/partner_pipeline.stages");
  const health = src("modules/partner_pipeline/partner_pipeline.health");
  const returns = src("modules/partner_pipeline/partner_pipeline.returns");
  const interactions = src("modules/interactions/interactions.service");
  const proposals = src("modules/proposals/proposals.service");
  const send = src("modules/proposals/proposals.send");
  const agreements = src("modules/agreements/agreements.service");
  const lifecycle = src("modules/agreements/agreements.lifecycle");
  const renewals = src("modules/agreements/agreements.renewals");
  const documents = src("modules/documents/documents.service");
  const workflow = src("shared/workflow/engine");

  // 1. Home's own rows in these tables go first, with the alerts Home raised about them.
  const client = await pool.connect();
  try {
    const gone = await atomically(client, () =>
      removeHomeStagingRows(client, PARTNERSHIP_TABLES),
    );
    log(
      `partnerships: removed Home's ${gone.rows} demonstration rows (${gone.alerts} alerts)`,
    );
  } finally {
    client.release();
  }

  // 2. The people: MyCity's real staff. The writes are Operations & People's, who sees everything and the money.
  const staff = await realStaff(pool);
  const login = async (person) =>
    person && person.user_id
      ? {
          ...(await grants.getAuthUser(pool, person.user_id)),
          employee_id: person.employee_id,
        }
      : null;
  const ops = await login(staff.operations || staff.ceo);
  if (!ops)
    return log(
      "partnerships: no Operations & People login on the register; nothing written",
    );
  const all = { scope: "all", scope_ids: null, employee_id: ops.employee_id };
  const actor = { ...ops, source: (seedActor && seedActor.source) || "seed" };
  const ownerOf = (slot) =>
    (personOf(staff, slot) || staff.operations || staff.ceo).employee_id;

  const { rows: cats } = await pool.query(
    "SELECT partner_category_id, name FROM partner_category WHERE active",
  );
  const category = (name) =>
    (cats.find((c) => c.name === name) || cats[0] || {}).partner_category_id;
  if (!cats.length)
    return log(
      "partnerships: no categories yet (65_partnership_setup.js); nothing written",
    );
  const stage = (label) => lists.stageCodeOf(pool, label);
  const exists = async (name) =>
    (
      await pool.query(
        "SELECT 1 FROM lead WHERE name = $1 UNION ALL SELECT 1 FROM partner WHERE name = $1 LIMIT 1",
        [name],
      )
    ).rows.length > 0;
  const today = lagos.today();
  const ago = (days, hm = "10:00") =>
    lagos.instant(lagos.addDays(today, -days), hm).toISOString();
  const monthBack = (n) =>
    lagos.addMonths(`${today.slice(0, 7)}-01`, -n).slice(0, 7);
  const contactOf = (name, first, last) => ({
    first_name: first,
    last_name: last,
    job_title: "Head of Partnerships",
    email: `${slug(first)}@${slug(name)}.example.test`,
    phones: ["+2348030000000"],
    signatory: true,
  });
  const eventDates = (inDays) =>
    inDays
      ? {
          event_title: undefined,
          event_starts_on: lagos.addDays(today, inDays),
          event_ends_on: lagos.addDays(today, inDays + 2),
        }
      : {};
  const FIRST = [
    "Adaeze",
    "Tobi",
    "Halima",
    "Kunle",
    "Ifeoma",
    "Sani",
    "Bisola",
    "Chinedu",
    "Zara",
    "Femi",
    "Ngozi",
    "Yusuf",
  ];
  const LAST = [
    "Okon",
    "Bello",
    "Eze",
    "Adeyemi",
    "Musa",
    "Nwosu",
    "Ogundipe",
    "Danladi",
    "Obi",
    "Lawal",
    "Okafor",
    "Ibrahim",
  ];
  let made = 0;

  // 3. Partners, signed before the hub.
  for (const [i, p] of PARTNERS.entries()) {
    if (await exists(p.name)) continue;
    try {
      const owner = ownerOf(p.owner);
      const r = await partners.create(actor, all, {
        name: p.name,
        partner_category_id: category(p.category),
        region: { scope: "national" },
        industry: p.industry,
        owner_id: owner,
        contact: contactOf(p.name, FIRST[i], LAST[i]),
        deal: {
          title: p.deal,
          owner_id: owner,
          estimated_value: p.value,
          ...eventDates(p.event),
          ...(p.event ? { event_title: p.deal } : {}),
          ...(p.options ? { options: p.options } : {}),
        },
        signed_before_hub: true,
      });
      const dealId = r.deals[0].deal_id;
      for (const [back, downloads, commission] of p.returns) {
        const gross = (Number(commission) * 12.5).toFixed(2);
        await returns.save(actor, all, dealId, monthBack(back), {
          downloads,
          units_sold: Math.round(downloads / 3),
          gross_sales: gross,
          mycity_commission: commission,
          paid_to_partner: (Number(gross) - Number(commission)).toFixed(2),
        });
      }
      await interactions.create({ ...actor, employee_id: owner }, all, {
        partner_id: r.partner.partner_id,
        deal_id: dealId,
        interaction_type: "call",
        occurred_at: ago(p.contact, "11:30"),
        subject: "Monthly check-in",
        summary:
          "Went through the month's downloads and the next activation together.",
      });
      made += 1;
    } catch (err) {
      log(
        `partnerships: ${p.name} stopped (${err.code || err.name}: ${err.message})`,
      );
    }
  }

  // 4. Leads, each moved to its stage through the stage switcher.
  for (const [n, l] of LEADS.entries()) {
    if (await exists(l.name)) continue;
    try {
      const i = n + PARTNERS.length;
      const owner = ownerOf(l.owner);
      const r = await leads.create(actor, all, {
        name: l.name,
        partner_category_id: category(l.category),
        region: { scope: "national" },
        industry: l.industry,
        owner_id: owner,
        identified_on: lagos.addDays(today, -(20 + n * 6)),
        contact: contactOf(
          l.name,
          FIRST[i % FIRST.length],
          LAST[i % LAST.length],
        ),
        deal: {
          title: `${l.name} Partnership`,
          owner_id: owner,
          estimated_value: l.value,
          expected_close_on: lagos.addDays(today, 30 + n * 5),
          ...eventDates(l.event),
          ...(l.event ? { event_title: l.name } : {}),
          ...(l.options ? { options: l.options } : {}),
        },
      });
      const leadId = r.lead.lead_id;
      const dealId = r.deal.deal_id;
      const code = await stage(l.stage);
      if (code && code !== r.deal.stage)
        await stages.move(actor, all, dealId, { stage: code });
      if (l.meeting)
        await interactions.create({ ...actor, employee_id: owner }, all, {
          lead_id: leadId,
          deal_id: dealId,
          interaction_type: "meeting",
          occurred_at: ago(l.meeting, "14:00"),
          subject: "Introductory meeting",
          summary:
            "Met their team and walked through ticketing and check-in on MyCityApp.",
        });
      if (l.stalled)
        await health.set(actor, all, dealId, {
          health: "stalled",
          blockers: l.stalled,
        });
      if (l.lost) await leads.lose(actor, all, leadId, { reason: l.lost });
      if (l.proposal) await proposalFor(dealId, l);
      if (l.agreement) await agreementFor(dealId, l);
      made += 1;
    } catch (err) {
      log(
        `partnerships: ${l.name} stopped (${err.code || err.name}: ${err.message})`,
      );
    }
  }

  /** A proposal filled from the record (Build by Hand); `sent` sends it to the lead's contact. */
  async function proposalFor(dealId, l) {
    const p = await proposals.start(
      actor,
      {
        deal_id: dealId,
        notes: `${l.name}: three sold-out nights, VIP tables named for their sponsors, and check-in on MyCityApp at the gate.`,
      },
      all,
      { byHand: true },
    );
    const drafted = await proposals.requestDraft(
      actor,
      p.partnership_proposal_id,
      all,
      { byHand: true },
    );
    if (l.proposal !== "sent") return;
    const { rows } = await pool.query(
      "SELECT email::text AS email FROM partner_contact WHERE lead_id = (SELECT lead_id FROM partnership_opportunity WHERE partnership_opportunity_id = $1) AND email IS NOT NULL LIMIT 1",
      [dealId],
    );
    if (!rows[0]) return;
    await send.send(
      actor,
      drafted.partnership_proposal_id,
      {
        to: [rows[0].email],
        subject: `${l.name}: our proposal`,
        message:
          "Thank you for your time last week. Our proposal is attached, with a link you can open on your phone.",
        confirm: true,
      },
      all,
    );
  }

  /** An agreement from the category's default template: Draft, In Approval, or approved and signed on paper. */
  async function agreementFor(dealId, l) {
    const a = await agreements.generate(actor, all, {
      deal_id: dealId,
      asks: { expected_attendees: "2,500 across the event", about_event: `${l.name} brings creators, fans and businesses together for a weekend in Lagos.`, merchant_pictures: "Yes" },
    });
    const starts = lagos.addDays(today, l.agreement === "signed" ? -20 : 14);
    await agreements.update(actor, all, a.partnership_agreement_id, {
      starts_on: starts,
      ends_on: lagos.addDays(lagos.addMonths(starts, 12), -1),
      fields: { "partner.headquarters": "Victoria Island, Lagos", "deal.valid_until": lagos.addDays(starts, 30) },
    });
    if (l.agreement === "draft") return;
    const submitted = await agreements.submit(
      actor,
      all,
      a.partnership_agreement_id,
    );
    if (l.agreement === "approval") return;
    // The Partner Agreement flow, each stage decided by whoever it waits on, as My Approvals would.
    const people = [
      staff.head,
      staff.ceo,
      staff.operations,
      ...staff.management,
    ].filter((x) => x && x.user_id);
    for (let step = 0; step < 4; step += 1) {
      const instance = await workflow.getInstance(
        pool,
        submitted.workflow_instance_id,
      );
      if (!instance || instance.state !== "pending") break;
      let decider = null;
      for (const person of people) {
        const user = await login(person);
        const waiting = await workflow.waitingOn(pool, user, { page: 1 });
        if (
          waiting.data.some(
            (w) => w.workflow_instance_id === instance.workflow_instance_id,
          )
        ) {
          decider = user;
          break;
        }
      }
      if (!decider)
        return log(
          `partnerships: nobody on the register to approve ${a.number}; left In Approval`,
        );
      const c = await pool.connect();
      let after;
      try {
        after = await atomically(c, () =>
          workflow.act(c, {
            instance_id: instance.workflow_instance_id,
            actor: decider,
            decision: "approve",
          }),
        );
      } finally {
        c.release();
      }
      // What the worker's outbox does next, done here so the agreement reads right at once; both are safe to run again.
      if (after.state === "approved")
        await lifecycle.settleApproval(a.partnership_agreement_id, {
          state: "approved",
          reason: null,
          instance_id: instance.workflow_instance_id,
        });
      else
        await lifecycle.advanced(
          a.partnership_agreement_id,
          instance.workflow_instance_id,
        );
    }
    const scan = await documents.stage(
      {
        buffer: PDF,
        originalname: `${l.name} signed.pdf`,
        mimetype: "application/pdf",
        size: PDF.length,
      },
      { purpose: "attachment" },
      actor,
    );
    const signer = await pool.query(
      "SELECT first_name || ' ' || last_name AS name FROM partner_contact WHERE lead_id = (SELECT lead_id FROM partnership_opportunity WHERE partnership_opportunity_id = $1) LIMIT 1",
      [dealId],
    );
    await agreements.signedCopy(actor, all, a.partnership_agreement_id, {
      document_id: scan.document_id,
      signed_on: lagos.addDays(today, -21),
      signed_by_name: (signer.rows[0] || {}).name || "Partner",
      signed_by_title: "Head of Partnerships",
    });
    await renewals.sweep();
  }

  log(
    `partnerships: ${made} demonstration records written (${PARTNERS.length} partners, ${LEADS.length} leads)`,
  );
}

module.exports = seed;
module.exports.PARTNERS = PARTNERS;
module.exports.LEADS = LEADS;
module.exports.PARTNERSHIP_TABLES = PARTNERSHIP_TABLES;
