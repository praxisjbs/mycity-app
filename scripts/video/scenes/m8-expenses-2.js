"use strict";
/**
 * Milestone 8 handover, part 2 of 2: Expenses, paying and budgets. docs/runbooks/training-videos.md
 * says how a scene is written and filmed, and §8 the plan.
 *
 * Filmed on the database part 1 (`m8-expenses-1.js`) leaves, the same day: four requests approved
 * by Operations & People and waiting on Requisitions. MyCity's own people do the work. Cynthia
 * Osakunih, Operations & People, groups them into a requisition; Ifeoma Mbonu, the CEO, removes one
 * on her phone and approves the rest; Cynthia pays them, with the bank's reference and without it,
 * adds the missing reference, sets a project's budget, keeps the departments' budgets (examples,
 * A25, said so on camera) and the categories, and shows where the approval chain is set.
 */

const REQUISITIONS = "/expenses?tab=requisitions";
const DISBURSEMENTS = "/expenses?tab=disbursements";

/** The dialog, sheet or confirmation on top. */
const dialog = (s) => s.page.locator("[role=dialog], [role=alertdialog]").last();
/** A window by its name, never a help term's popup (runbook §6.16). */
const named = (s, name) => s.page.getByRole("dialog", { name }).last();
const inside = (s, name, label) => named(s, name).getByLabel(label, { exact: true }).first();
const text = (s, words) => s.page.getByText(words, { exact: true }).first();
const button = (s, name, within) => (within || s.page).getByRole("button", { name, exact: true }).first();
/** A KPI tile: a button named by its label and its figure ("Waiting to Pay 4"). */
const tile = (s, label) => s.page.getByRole("button", { name: new RegExp(`^${label}\\b`) }).first();
/** A table's row holding every one of `words`. */
const row = (s, ...words) => words.reduce((r, w) => r.filter({ hasText: w }), s.page.getByRole("row")).first();

/** Wait for a toast that starts with `start` (the branded Toaster's), up to `seconds`. */
async function toastOf(s, start, seconds = 20) {
  await s.page.getByText(new RegExp(`^${start}`)).first().waitFor({ state: "visible", timeout: seconds * 1000 }).catch(() => null);
}

/** Glide to `loc` when it shows within a few seconds. */
async function soft(s, loc, wait = 4000) {
  if (await loc.waitFor({ state: "visible", timeout: wait }).then(() => true, () => false)) await s.hover(loc);
}

module.exports = {
  id: "m8-expenses-2",
  file: "MyCity-M8-Expenses-Part-2-Paying-and-Budgets",
  meta: { title: "MyCity App · Expenses, Part 2: Paying and Budgets (Milestone 8)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestone 8 Handover · Part 2",
    title: "Expenses",
    subtitle: "Requisitions, payments and budgets",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestone 8 · Expenses · Part 2",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    cynthia: (staff) => staff.operations.work_email,
    ifeoma: (staff) => staff.ceo.work_email,
  },
  chapters: [
    {
      name: "Welcome",
      shots: [
        {
          kind: "card",
          card: "opening",
          lines: [
            "Welcome to the second walkthrough of Expenses, delivered in Milestone 8 of the MyCity hub.",
            "Part one raised requests and approved them. This part pays them, and keeps every budget.",
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: REQUISITIONS,
          lines: [
            { say: "Part one ended here, on Requisitions. Four requests are approved, waiting for the CEO.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Approved Requests" })) },
            { say: "Bode's JBS Praxis payment and Aaron's Instagram boosts are among them.", do: (s) => s.hover(row(s, "JBS Praxis invoice")) },
            "We follow Cynthia Osakunih, the Operations and People Lead, and Ifeoma Mbonu, the Chief Executive Officer.",
            "Grouping, paying, budgets and categories need Expenses Finance. Operations and People and the CEO hold it.",
          ],
        },
      ],
    },
    {
      name: "Grouping a Requisition",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: REQUISITIONS,
          lines: [
            "Requests don't go to the CEO one at a time. Operations and People group them into a requisition.",
            { say: "Cynthia ticks the approved requests she wants paid together, up to 25 at a time.", do: async (s) => { for (let n = 1; n <= 4; n++) { await s.click(s.page.getByRole("checkbox", { name: `Select row ${n}`, exact: true })); await s.wait(0.25); } } },
            { say: "She presses Create Requisition. It goes to the CEO as one record.", do: async (s) => { await s.click(button(s, "Create Requisition")); await toastOf(s, "REQ-\\d+"); } },
            { say: "REQ-0002 holds the four requests, 629,000 naira in all. It reads With the CEO.", do: (s) => soft(s, row(s, "REQ-0002")), hold: 0.3 },
            "Until a request is paid, Operations and People can still take it back: Withdraw, with a reason. Its requester is told.",
          ],
        },
      ],
    },
    {
      name: "The CEO Decides",
      shots: [
        {
          kind: "phone",
          as: "ifeoma",
          start: REQUISITIONS,
          label: { eyebrow: "On the CEO's phone", title: "Requisitions", subtitle: "Ifeoma Mbonu decides REQ-0002" },
          lines: [
            { say: "Ifeoma Mbonu is told in the bell. On her phone, she opens Expenses, then Requisitions.", do: (s) => s.wait(0.6) },
            { say: "She opens REQ-0002: each request, its purpose and its amount.", do: (s) => s.click(text(s, "REQ-0002")) },
            "Any request in it opens in full, with its lines, its invoice and its history.",
            { say: "The MyLagosApp flyers can wait until the launch date is fixed. She presses Remove beside them.", do: (s) => s.click(named(s, "Requisition").getByRole("listitem").filter({ hasText: "MyLagosApp launch flyers" }).getByRole("button", { name: "Remove", exact: true })) },
            { say: "She writes why, and presses Remove Request.", do: async (s) => { await s.type(inside(s, "Remove EXP-0006", "Reason"), "Hold until the launch date is fixed.", { delay: 26 }); await s.click(button(s, "Remove Request", named(s, "Remove EXP-0006"))); } },
            { say: "The flyers go back to Operations and People, with her reason in their history.", hold: 0.3 },
            { say: "Then Approve. Every request left in it is authorised, ready to be paid.", do: async (s) => { await s.click(button(s, "Approve", named(s, "Requisition"))); await s.wait(1); } },
            "Reject would send every request back to Operations and People, to regroup, or to reject one by one.",
          ],
        },
      ],
    },
    {
      name: "Paying",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: DISBURSEMENTS,
          lines: [
            { say: "Disbursements lists what the CEO authorised. Waiting to Pay counts them.", do: (s) => s.hover(tile(s, "Waiting to Pay")) },
            "Each request is paid to its own payee, by bank transfer from MyCity's account.",
            { say: "Cynthia makes the transfer to JBS Praxis in the bank, then opens Bode's request.", do: (s) => s.click(row(s, "JBS Praxis invoice")) },
            { say: "She presses Record Disbursement.", do: (s) => s.click(button(s, "Record Disbursement", dialog(s))) },
            { say: "The Bank Reference is the transaction ID on the bank's transfer. It ties the payment to the statement.", do: (s) => s.type(inside(s, "Pay EXP-0012", "Bank Reference"), "NIP-261113-7741265", { delay: 55 }) },
            { say: "Paid On is today. The bank's receipt can be attached too.", do: (s) => s.hover(inside(s, "Pay EXP-0012", "Paid On")) },
            { say: "Record Disbursement. Bode is told it's paid, and it moves to Paid.", do: async (s) => { await s.click(button(s, "Record Disbursement", named(s, "Pay EXP-0012"))); await toastOf(s, "DSB-\\d+|EXP-0012"); }, hold: 0.4 },
            { say: "Aaron's boosts were paid from the bank's app. The reference isn't to hand.", do: async (s) => { await s.click(row(s, "Instagram boosts, Detty December")); await s.click(button(s, "Record Disbursement", dialog(s))); } },
            { say: "With no reference and no receipt, the screen asks: Save Without Reference?", do: (s) => s.click(button(s, "Record Disbursement", named(s, "Pay EXP-0011"))) },
            { say: "Save Anyway records it, flagged Reference Missing. Add Reference would go back to the field.", do: async (s) => { await s.click(button(s, "Save Anyway", s.page.getByRole("alertdialog", { name: "Save Without Reference?" }))); await toastOf(s, "DSB-\\d+|EXP-0011"); }, hold: 0.4 },
          ],
        },
      ],
    },
    {
      name: "Missing References",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: DISBURSEMENTS,
          lines: [
            { say: "Reference Missing counts payments saved without one. Pressing it lists them.", do: async (s) => { await s.click(tile(s, "Reference Missing")); await s.wait(1.4); } },
            { say: "Aaron's is there, and an earlier lunch for the Providus Bank team.", do: (s) => soft(s, named(s, "Reference Missing").getByRole("row").filter({ hasText: "Aaron Agama" }).first()), after: async (s) => { await s.click(button(s, "Close", named(s, "Reference Missing"))); } },
            { say: "The statement has arrived. Cynthia opens Aaron's payment under Paid.", do: (s) => s.click(row(s, "Aaron Agama", "Reference Missing")) },
            { say: "She presses Add Reference, and types the bank's reference.", do: async (s) => { await s.click(button(s, "Add Reference", named(s, "Disbursement"))); await s.type(inside(s, "Add Reference", "Bank Reference"), "NIP-261113-7745902", { delay: 55 }); } },
            { say: "Add Reference. The flag clears.", do: async (s) => { await s.click(button(s, "Add Reference", named(s, "Add Reference"))); await s.wait(1); }, hold: 0.4 },
            { say: "Paid keeps every transfer: its payee, the day, and its bank reference. Open Receipt shows a receipt that was attached.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Paid", exact: true })) },
            "Each step is also in the request's history, from raised to paid, with who took it.",
          ],
        },
      ],
    },
    {
      name: "Projects",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: "/expenses?tab=projects",
          lines: [
            "Projects shows each project's budget, and what's committed, spent and left.",
            { say: "Committed is approved but not yet paid. Spent is paid.", do: (s) => s.hover(s.page.getByRole("button", { name: "Committed", exact: true })) },
            { say: "Website Ticket Payments has 900,000 naira. Both JBS Praxis payments are spent against it.", do: (s) => s.hover(row(s, "Website Ticket Payments")) },
            { say: "Detty December Campaign has no budget yet. Cynthia opens it. Aaron's boosts are already counted.", do: (s) => s.click(row(s, "Detty December Campaign")) },
            { say: "She presses Set Budget, and gives it three million naira.", do: async (s) => { await s.click(button(s, "Set Budget", named(s, "Project"))); await s.type(inside(s, "Set Budget", "Budget"), "3,000,000", { delay: 70 }); } },
            { say: "Set Budget.", do: async (s) => { await s.click(button(s, "Set Budget", named(s, "Set Budget"))); await s.wait(1); }, hold: 0.4 },
            { say: "Whoever runs a project raises its requests from here. New Request opens with the project filled.", do: (s) => soft(s, button(s, "New Request", named(s, "Project"))) },
          ],
        },
      ],
    },
    {
      name: "Budgets",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: "/expenses?tab=budgets",
          lines: [
            "Budgets holds each department's budget for the year, by category.",
            { say: "MyCity sets its first budgets in January. The figures here are examples for this walkthrough.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Departments" })) },
            { say: "Year picks the year. Each department shows Allocated, Committed, Spent and Remaining.", do: (s) => s.hover(s.page.getByRole("combobox", { name: "Year" })) },
            { say: "She opens Branding and Marketing. Each category is a line of its own.", do: (s) => s.click(row(s, "Branding & Marketing")) },
            "A request over what its line has left is flagged Over Budget, before anyone approves it.",
            "At 90 percent used, the department's head and Operations and People are warned, once.",
            { say: "Edit Budget changes an amount. Cynthia raises Advertising and Media to two million naira.", do: async (s) => { await s.click(button(s, "Edit Budget", named(s, "Budget"))); await s.type(named(s, "Edit Budget").getByRole("textbox", { name: "Amount" }).first(), "2,000,000", { delay: 70 }); } },
            { say: "Save Budget. The department's head is told of the change.", do: async (s) => { await s.click(button(s, "Save Budget", named(s, "Edit Budget"))); await s.wait(1); } },
            { say: "Budget History shows every change: the line, before and after, who made it, and when.", do: async (s) => { if (!(await button(s, "Budget History").isVisible().catch(() => false))) await s.click(row(s, "Branding & Marketing")); await s.click(button(s, "Budget History")); await s.wait(1.2); }, after: async (s) => { for (let i = 0; i < 3 && (await dialog(s).isVisible().catch(() => false)); i++) { await s.click(button(s, "Close", dialog(s))); await s.wait(0.5); } } },
            { say: "New Budget sets one for a department that has none. General Management, for its partner lunches.", do: async (s) => { await s.click(button(s, "New Budget")); await s.pick(inside(s, "New Budget", "Department"), "General Management"); await s.pick(inside(s, "New Budget", "Category 1"), "Accommodation and Meals"); await s.type(named(s, "New Budget").getByRole("textbox", { name: "Amount" }).first(), "400,000", { delay: 70 }); } },
            { say: "Set Budget. Every change to a budget is logged.", do: async (s) => { await s.click(button(s, "Set Budget", named(s, "New Budget"))); await s.wait(1); }, hold: 0.4 },
          ],
        },
      ],
    },
    {
      name: "Categories",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: "/expenses?tab=categories",
          lines: [
            "Categories are what requests are for. Each shows its Type, this month's spend, and how many requests use it.",
            { say: "Capital is equipment kept for years. Everything else is Operating.", do: (s) => s.hover(s.page.getByRole("button", { name: "Type", exact: true })) },
            { say: "New Category adds one. Cynthia adds Software and Hosting, an Operating category.", do: async (s) => { await s.click(button(s, "New Category")); await s.type(inside(s, "New Category", "Name"), "Software and Hosting", { delay: 40 }); await s.pick(inside(s, "New Category", "Type"), "Operating"); } },
            { say: "Add Category.", do: async (s) => { await s.click(button(s, "Add Category", named(s, "New Category"))); await s.wait(1); }, hold: 0.3 },
            { say: "One no longer used is deactivated, never deleted. Its past requests keep it.", do: async (s) => { await s.click(row(s, "Prizes and Giveaways")); await s.click(button(s, "Deactivate", named(s, "Edit Category"))); } },
            { say: "Deactivate. It's no longer offered on new requests. Offer Again brings it back.", do: async (s) => { await s.click(button(s, "Deactivate", s.page.getByRole("alertdialog", { name: "Deactivate Category" }))); await s.wait(1); }, hold: 0.3 },
            "On a new hub, Add Suggested Categories adds twelve in one press, drawn from MyCity's own expenditure.",
          ],
        },
      ],
    },
    {
      name: "The Approval Chain",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: "/settings?tab=approvals",
          lines: [
            { say: "Who approves is set in Settings, under Approvals. Nothing is fixed in the code.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Approval Flows" })) },
            { say: "Expense Request: the Line Manager, then Operations and People, each with 48 hours.", do: (s) => s.click(row(s, "Expense Request")) },
            { say: "The line manager's stage applies only when the requester manages no one. Bode's skipped it.", do: (s) => soft(s, named(s, "Expense Request").getByRole("button", { name: "Applies When" }).first()) },
            { say: "Edit Stages changes the chain, without a new release. A request keeps the chain it started on.", do: (s) => soft(s, button(s, "Edit Stages", named(s, "Expense Request"))) },
            "Requisitions have a flow of their own: the CEO, with 72 hours.",
          ],
        },
      ],
    },
    {
      name: "Wrapping Up",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: DISBURSEMENTS,
          lines: [
            { say: "That's Expenses, from a request raised on a phone to the money in the payee's account.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Paid", exact: true })) },
            "Every request has one road, every payment its reference, and every budget its history.",
          ],
        },
        {
          kind: "card",
          card: "closing",
          lines: ["Every step is also written up in the User Guide, in the Knowledge Hub. Thank you for watching."],
        },
      ],
    },
  ],
};
