"use strict";
/**
 * Milestone 5 handover, part 1 of 2: Offers, from the shortlist to a signed offer.
 * docs/runbooks/training-videos.md says how a scene is written and filmed, and §8 the plan.
 *
 * Filmed on a development database with the staging seed (runbook §4.1), with the JBS Praxis Team
 * set as head of Implementation, the department of every seeded vacancy, so an offer's approval
 * shows both its stages. Kunle Afolabi, the seed's invented candidate at Shortlist for Head, Sales &
 * Revenue, is offered the role, approved, signed for MyCity by Cynthia Osakunih and signs it on his
 * phone. The chapters run in order, each on the one before; part 2 (m5-onboarding-2.js) follows him
 * to his first day.
 */
const mail = require("../mail");
const { sign } = require("../sign");

const OFFERS = "/recruitment?tab=offers";
const CANDIDATES = "/recruitment?tab=candidates";
const SALES = "Head, Sales & Revenue";
const KUNLE = { name: "Kunle Afolabi", email: "kunle.afolabi@example.test" };

/** The dialog or sheet on top, a confirmation (an alert dialog) included. */
const dialog = (s) => s.page.locator("[role=dialog], [role=alertdialog]").last();
const inDialog = (s, label) => dialog(s).getByLabel(label, { exact: true }).first();
/** The offer's own window, by its name: a help term's popup is a dialog too, and sits on top of it. */
const record = (s) => s.page.getByRole("dialog", { name: "Offer", exact: true });
const button = (s, name, within) => (within || dialog(s)).getByRole("button", { name, exact: true }).first();
const text = (s, words) => s.page.getByText(words, { exact: true }).first();
const card = (s, name) => s.page.locator("li").filter({ has: s.page.getByText(name, { exact: true }) }).first();
const column = (s, label) => s.page.getByRole("region", { name: "Board" }).getByRole("region", { name: label, exact: true });
/** Kunle's offer: a row of the list on desktop, a card on a phone. */
const offer = (s) => (s.phone ? text(s, KUNLE.name) : s.page.getByRole("row", { name: new RegExp(KUNLE.name) }).first());
const next = (s) => s.click(button(s, "Next"));
const pad = (s, within) => (within || dialog(s)).locator("canvas").first();

/**
 * Today in Lagos as a date field takes it (DD/MM/YYYY). Kunle starts on the filming day, so his
 * onboarding (part 2) begins that morning's run as it would, every date on screen the day it happened.
 */
function today() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year}`;
}

/** The newest signing code mailed to Kunle, once one newer than `after` (a code) has arrived. */
async function codeFor(email, after) {
  for (let i = 0; i < 30; i++) {
    const got = await mail.message(email, "signature-code");
    if (String(got.data.code) !== String(after || "")) return String(got.data.code);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("No new signing code arrived");
}

module.exports = {
  id: "m5-offers-1",
  file: "MyCity-M5-Offers-and-Onboarding-Part-1-Offers",
  meta: { title: "MyCity App · Offers and Onboarding, Part 1: Offers (Milestone 5)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestone 5 Handover · Part 1",
    title: "Offers",
    subtitle: "From the shortlist to a signed offer",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestone 5 · Offers and Onboarding · Part 1",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    cynthia: (staff) => staff.operations.work_email,
    ceo: (staff) => staff.ceo.work_email,
    // The Implementation Team's account (create-admin --build-account): the hiring manager, and the
    // head of the vacancy's department on the filming database.
    team: (staff) => staff.everyone.find((p) => p.job_title === "Implementation Partner").work_email,
  },
  chapters: [
    {
      name: "Welcome",
      shots: [
        {
          kind: "card",
          card: "opening",
          lines: [
            "Welcome to the first walkthrough of Offers and Onboarding, delivered in Milestone 5 of the MyCity hub.",
            "It covers making an offer, approving it, and the candidate signing it on a phone.",
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: OFFERS,
          lines: [
            { say: "Offers and Onboarding are the fifth and sixth tabs of Recruitment.", do: (s) => s.hover(s.page.getByRole("tab", { name: "Onboarding", exact: true })) },
            { say: "Offers turns a shortlisted candidate into a signed offer.|Onboarding takes the new hire to their first day.", do: (s) => s.hover(s.page.getByRole("tab", { name: "Offers", exact: true })) },
            "Operations and People see every offer. A Head of Department sees the offers for their own vacancies.",
            { say: "Cynthia Osakunih, the Operations and People Lead, makes the offers and signs them for MyCity.", do: (s) => s.hover(button(s, "New Offer", s.page)) },
            "The JBS Praxis Team stands in as the hiring manager, and head of the hiring department.",
            "Ifeoma Mbonu, the CEO, gives the final approval.",
            "We follow Kunle Afolabi, an invented candidate shortlisted for Head, Sales & Revenue.",
          ],
        },
      ],
    },
    {
      name: "Offer Settings",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: OFFERS,
          lines: [
            { say: "Before the first offer, Cynthia presses Offer Settings. Only Operations and People see it.", do: (s) => s.click("Offer Settings") },
            { say: "Offer Signatory names who signs every offer, and every contract, for MyCity.", do: (s) => s.click(dialog(s).getByRole("row", { name: /Offer Signatory/ })) },
            { say: "She picks herself: MyCity's offer letter is signed by the Operations and People Lead.", do: (s) => s.pick(inDialog(s, "Signs for the Company"), "Cynthia Osakunih") },
            { say: "She presses Save Signatory. A signatory needs a login, as they sign in the hub.", do: (s) => s.click(button(s, "Save Signatory")), hold: 0.4 },
            { say: "Standard Offer Letter is the letter's wording, the same for every offer.", do: (s) => s.click(dialog(s).getByRole("row", { name: /Standard Offer Letter/ })) },
            { say: "The names in braces are filled from each offer: the role, the pay, the start date.", do: (s) => s.hover(inDialog(s, "Wording")) },
            "A change applies to offers approved from then on. Those already approved keep their wording.",
            { say: "She leaves it as it is, and presses Cancel.", do: async (s) => { await s.click(button(s, "Cancel")); await s.click(button(s, "Close")); } },
          ],
        },
      ],
    },
    {
      name: "Making an Offer",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: CANDIDATES,
          setup: (s) => s.pick("Vacancy", SALES),
          lines: [
            { say: "On the candidates board, Kunle sits at Shortlist. Cynthia opens him.", do: (s) => s.click(card(s, KUNLE.name).getByText(KUNLE.name, { exact: true })) },
            { say: "Make Offer opens New Offer with Kunle picked. Only a shortlisted candidate can get one.", do: (s) => s.click(button(s, "Make Offer")) },
            { say: "The form fills in from the vacancy:|the job title, the department, who he reports to, and the work pattern.", do: (s) => s.hover(inDialog(s, "Department")) },
            {
              say: "She adds the function and the scope, as MyCity's offer letter has them.",
              do: async (s) => {
                await s.type(inDialog(s, "Function"), "Commercial leadership", { delay: 30 });
                await s.type(inDialog(s, "Scope"), "Lagos and Abuja", { delay: 30 });
              },
            },
            { say: "On a hybrid pattern, the days a week in the office: two.", do: (s) => s.type(inDialog(s, "Office Days"), "2", { delay: 80 }) },
            { say: "Next is Monthly Pay. Pay is set by the month, line by line.", do: (s) => next(s) },
            {
              say: "The basic salary: ₦1,000,000 a month.",
              speech: "The basic salary: one million naira a month.",
              do: (s) => s.type(dialog(s).getByRole("textbox", { name: "Monthly Amount" }).nth(0), "1000000", { delay: 70 }),
            },
            {
              say: "Add Pay Line, for the internet and recharge allowance.",
              do: async (s) => {
                await s.click(button(s, "Add Pay Line"));
                await s.type(inDialog(s, "Line 2"), "Internet & Recharge Allowance", { delay: 25 });
                await s.type(dialog(s).getByRole("textbox", { name: "Monthly Amount" }).nth(1), "50000", { delay: 70 });
              },
            },
            {
              say: "And another, for transport.",
              do: async (s) => {
                await s.click(button(s, "Add Pay Line"));
                await s.type(inDialog(s, "Line 3"), "Transportation Allowance", { delay: 25 });
                await s.type(dialog(s).getByRole("textbox", { name: "Monthly Amount" }).nth(2), "150000", { delay: 70 });
              },
            },
            { say: "The Monthly Total adds them up. It sits within the vacancy's range, so no reason is asked.", do: (s) => s.hover(dialog(s).getByText("Monthly Total", { exact: true })) },
            "Outside the range, the form asks why, and the approvers read it.",
            { say: "Next, the terms. She types his start date.", do: async (s) => { await next(s); await s.type(inDialog(s, "Start Date"), today(), { delay: 70 }); } },
            { say: "Days to Sign is how long he has once it's sent: fifteen. Probation comes from the vacancy.", do: (s) => s.hover(inDialog(s, "Days to Sign")) },
            {
              say: "She types the annual leave and the working hours.",
              do: async (s) => {
                await s.type(inDialog(s, "Annual Leave Days"), "20", { delay: 80 });
                await s.type(inDialog(s, "Working Hours"), "09:00 to 17:00, Monday to Friday", { delay: 25 });
              },
            },
            { say: "Incentives point to MyCity's Incentive Plan.", do: (s) => s.type(inDialog(s, "Incentives"), "As MyCity's Incentive Plan sets for sales leads", { delay: 22 }) },
            { say: "Last, the letter. Schedule A is the job description, copied from the vacancy. She can change it.", do: async (s) => { await next(s); await s.hover(inDialog(s, "Schedule A")); } },
            { say: "Additional Terms are for this offer alone. There are none today.", do: (s) => s.hover(inDialog(s, "Additional Terms")) },
            { say: "She presses Draft Offer. It gets its number, OFF-0001, and shows as Draft.", do: (s) => s.click(button(s, "Draft Offer")), hold: 0.6 },
          ],
        },
      ],
    },
    {
      name: "Reading an Offer",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: OFFERS,
          lines: [
            { say: "The tiles count the offers with approval, those to send, with candidates, and accepted this month.", do: (s) => s.hover(text(s, "With Candidates")) },
            { say: "Each offer opens in a wide window.", do: (s) => s.click(offer(s)) },
            { say: "Score is Kunle's weighted total when the offer was made. It never changes after.", do: (s) => s.hover(button(s, "Score", record(s))) },
            { say: "Monthly Pay lists each line, the total and the year's pay, beside the vacancy's range.", do: (s) => s.hover(record(s).getByText("Monthly Total", { exact: true })) },
            { say: "View Letter shows the letter exactly as Kunle will read it.", do: (s) => s.click(button(s, "View Letter", record(s))) },
            { say: "The summary, the terms, the pay, and Schedule A.|No AI writes it: it is the standard wording, filled from the offer.", do: (s) => s.scroll(900, dialog(s).getByRole("heading", { name: "Offer of Employment" })), hold: 0.4 },
            { say: "A draft can still change, with Edit Offer.", do: async (s) => { await s.click(button(s, "Close")); await s.hover(button(s, "Edit Offer", record(s))); } },
          ],
        },
      ],
    },
    {
      name: "Approval",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: OFFERS,
          setup: (s) => s.click(offer(s)),
          lines: [
            { say: "Cynthia presses Submit for Approval. It shows as With Approval.", do: (s) => s.click(button(s, "Submit for Approval", record(s))), hold: 0.3 },
            { say: "The Head of Department approves first, then the CEO. Each is told when it waits for them.", do: (s) => s.hover(record(s).getByRole("list", { name: "Approval route" })) },
            "It needs a department, a start date, and an Offer Signatory first.",
          ],
        },
        {
          kind: "desktop",
          as: "team",
          start: OFFERS,
          lines: [
            { say: "The JBS Praxis Team, head of the hiring department, opens it. It is also on My Approvals.", do: (s) => s.click(offer(s)) },
            { say: "The approver reads the pay against the range, and the letter.", do: (s) => s.hover(record(s).getByText("Monthly Total", { exact: true })) },
            { say: "Approve Offer. Reject Offer would send it back as a draft, with the reason.", do: (s) => s.click(button(s, "Approve Offer", record(s))), hold: 0.5 },
          ],
        },
        {
          kind: "phone",
          as: "ceo",
          start: OFFERS,
          label: { eyebrow: "On the CEO's phone", title: "Approve Offer", subtitle: "Ifeoma Mbonu approves Kunle's offer" },
          lines: [
            { say: "Ifeoma Mbonu, the CEO, approves on her phone. The offer opens in a sheet.", do: (s) => s.click(offer(s)) },
            { say: "She presses Approve Offer, and the offer is Approved.", do: (s) => s.click(button(s, "Approve Offer", record(s))), hold: 0.6 },
            "The letter is now fixed with the wording in force, and Cynthia is told to sign it.",
          ],
        },
      ],
    },
    {
      name: "Signing and Sending",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: OFFERS,
          lines: [
            { say: "Signers shows MyCity first and Kunle second. MyCity signs before the candidate.", do: async (s) => { await s.click(offer(s)); await s.hover(record(s).getByRole("heading", { name: "Signers" })); } },
            { say: "Cynthia presses Sign for Company. She is signed in, so no code is asked for.", do: (s) => s.click(button(s, "Sign for Company", record(s))) },
            { say: "Her full name and title are filled in.", do: (s) => s.hover(inDialog(s, "Title")) },
            { say: "She draws her signature in the box. Type would let her type it instead.", do: (s) => sign(s, pad(s)) },
            { say: "She ticks Agree to Sign Electronically.", do: (s) => s.click(dialog(s).getByRole("checkbox", { name: "Agree to Sign Electronically" })) },
            { say: "And presses Sign Offer. Signers shows her as signed.", do: (s) => s.click(button(s, "Sign Offer")), hold: 0.4 },
            { say: "Now Send Offer. Kunle gets an email with his own signing link.", do: (s) => s.click(button(s, "Send Offer", record(s))), hold: 0.4 },
            { say: "It shows as With Candidate, and expires in fifteen days.", do: (s) => s.hover(record(s).getByText("Expires", { exact: true })) },
            { say: "Resend Offer sends a new link and stops the old one. Change Email corrects a wrong address.", do: (s) => s.hover(button(s, "Resend Offer", record(s))) },
            { say: "Withdraw Offer ends it, with a reason, before he signs.", do: (s) => s.hover(button(s, "Withdraw Offer", record(s))) },
            {
              say: "On the board, his card has moved to Offer.",
              do: async (s) => {
                await s.click(button(s, "Close", record(s)));
                await s.click(s.page.getByRole("tab", { name: "Candidates", exact: true }));
                await s.pick("Vacancy", SALES);
                await s.hover(column(s, "Offer").getByText(KUNLE.name, { exact: true }));
              },
              hold: 0.6,
            },
          ],
        },
      ],
    },
    {
      name: "Signing on a Phone",
      shots: [
        {
          kind: "phone",
          site: "go",
          start: "/jobs",
          label: { eyebrow: "In the candidate's inbox", title: "Your Offer", subtitle: "The email the hub sends, with Kunle's own link" },
          setup: async (s) => {
            const got = await mail.message(KUNLE.email, "offer-sent");
            await s.page.setContent(got.html);
          },
          lines: [
            "Kunle's email names the role and the offer's reference, with his own link.",
            { say: "It works until the offer expires, and only for him.", hold: 0.4 },
          ],
        },
        {
          kind: "phone",
          site: "go",
          start: "/jobs",
          label: { eyebrow: "On the candidate's phone", title: "Sign Offer", subtitle: "Kunle reads and signs his offer" },
          setup: async (s) => {
            const got = await mail.message(KUNLE.email, "offer-sent");
            await s.page.goto(got.data.sign_url);
            await s.settle();
          },
          lines: [
            { say: "The page shows the role and when it expires, then the letter, exactly as its PDF reads.", do: (s) => s.scroll(700) },
            { say: "He reads the terms and the pay, down to Schedule A.", do: (s) => s.scroll(2600) },
            { say: "Signers shows MyCity's signature already in, and his own waiting.", do: (s) => s.click(s.page.getByRole("region", { name: "Signers" }).getByRole("heading", { name: "Signers" })) },
            { say: "To confirm it's him, he presses Send Code. A six-digit code goes to his email.", do: (s) => s.click("Send Code") },
            {
              say: "He types the code. It works for ten minutes.",
              do: async (s) => {
                const code = await codeFor(KUNLE.email);
                await s.click(s.page.getByRole("textbox", { name: "Digit 1 of 6" }));
                await s.page.keyboard.type(code, { delay: 180 });
                await s.page.getByRole("region", { name: "Sign Below" }).waitFor({ timeout: 15000 });
              },
            },
            { say: "Under Sign Below, his full name is filled in. A title is optional.", do: (s) => s.click(s.page.getByRole("region", { name: "Sign Below" }).getByRole("heading", { name: "Sign Below" })) },
            { say: "He draws his signature with a finger.", do: (s) => sign(s, pad(s, s.page)) },
            { say: "He ticks Agree to Sign Electronically.", do: (s) => s.click(s.page.getByRole("checkbox", { name: "Agree to Sign Electronically" })) },
            { say: "And presses Accept and Sign. Signing it is accepting it.", do: (s) => s.click("Accept and Sign"), hold: 0.6 },
            { say: "The page says Offer Signed. A signed offer is locked.", do: (s) => s.page.getByRole("heading", { name: "Offer Signed" }).waitFor({ timeout: 20000 }) },
            "Before signing, Decline the Offer would end it, with his reason.",
          ],
        },
      ],
    },
    {
      name: "What Signing Does",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: OFFERS,
          lines: [
            { say: "Back in the hub, the offer is Accepted, and locked.", do: (s) => s.hover(text(s, "Accepted This Month")) },
            { say: "Both signatures are in. History lists each step, from made to signed.", do: async (s) => { await s.click(offer(s)); await s.hover(record(s).getByRole("heading", { name: "Signers" })); } },
            {
              say: "View Letter now opens the sealed PDF, with both signatures.",
              do: async (s) => {
                await s.click(button(s, "View Letter", record(s)));
                await dialog(s).getByRole("document").waitFor({ timeout: 20000 });
              },
            },
            { say: "Every page carries a QR code, which opens the check that it's genuine.", hold: 0.6 },
            {
              say: "Signing also made Kunle an employee record, with no login yet, and opened his onboarding case.",
              do: async (s) => {
                await s.click(button(s, "Close"));
                await s.click(button(s, "Close", record(s)));
                await s.click(s.page.getByRole("tab", { name: /^Onboarding/ }));
                await s.hover(s.page.getByRole("row", { name: new RegExp(KUNLE.name) }).first());
              },
            },
            "His contract is made too, waiting for MyCity's signature. That's the second walkthrough.",
          ],
        },
      ],
    },
    {
      name: "Verify a Document",
      shots: [
        {
          kind: "phone",
          site: "go",
          start: "/jobs",
          label: { eyebrow: "In the candidate's inbox", title: "Your Signed Offer", subtitle: "The signed copy, with a link to check it" },
          setup: async (s) => {
            const got = await mail.message(KUNLE.email, "offer-signed");
            await s.page.setContent(got.html);
          },
          lines: [
            { say: "Kunle receives the signed copy by email, with a link to check it.", hold: 0.4 },
          ],
        },
        {
          kind: "phone",
          site: "go",
          start: "/verify",
          label: { eyebrow: "On anyone's phone", title: "Verify a Document", subtitle: "go.mycityapp.io checks a signed document" },
          lines: [
            "Verify a Document checks anything MyCity has signed. Anyone can use it, by reference or by QR code.",
            {
              say: "Kunle's reference is OFF-0001. He types it and presses Verify.",
              do: async (s) => {
                await s.type("Reference", "OFF-0001", { delay: 90 });
                await s.click("Verify");
              },
            },
            { say: "Document Verified means it is genuine and unchanged. It shows who signed, and when.", do: (s) => s.scroll(380) },
            { say: "Content Hash checks the record, and Artifact Hash the stored file. Each reads Matches or Differs.", do: (s) => s.scroll(400) },
            { say: "It never shows what the letter says.", hold: 0.6 },
          ],
        },
      ],
    },
    {
      name: "Wrapping Up",
      shots: [
        {
          kind: "card",
          card: "closing",
          extra: 1.6,
          lines: [
            "That's Offers, from the shortlist to a signed offer.",
            "Every step is also written up in the User Guide, in the Knowledge Hub.",
            "Thank you for watching.",
          ],
        },
      ],
    },
  ],
};
