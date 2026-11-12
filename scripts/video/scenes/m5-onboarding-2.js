"use strict";
/**
 * Milestone 5 handover, part 2 of 2: Documentation and Onboarding, from the contract to the hire's
 * login. docs/runbooks/training-videos.md says how a scene is written and filmed, and §8 the plan.
 *
 * Filmed on the database part 1 (m5-offers-1.js) leaves, the same day: Kunle Afolabi, an invented
 * candidate, has signed his offer, so he is an employee with no login and his case waits at
 * Documentation. Here MyCity signs his contract and he signs it on his phone, he sends his documents,
 * two guarantors, his home address and his BVN on his upload page, Cynthia Osakunih checks them, the
 * morning's run starts his onboarding plan on his start date (the filming day), the JBS Praxis Team,
 * his hiring manager, works through it, and Cynthia completes it. The chapters run in order.
 *
 * Needs address search (a Geoapify key, runbook §1): every address on the upload page is picked.
 * The hire's page allows 20 writes a minute from one address (RATE_LIMIT_PUBLIC_WRITES_PER_MIN), so
 * each phone shot that writes waits out the minute before the camera rolls (runbook §6).
 */
const fs = require("node:fs");
const path = require("node:path");
const mail = require("../mail");
const { sign } = require("../sign");

const ONBOARDING = "/recruitment?tab=onboarding";
const KUNLE = { name: "Kunle Afolabi", email: "kunle.afolabi@example.test", company: "kunle.afolabi@mycityapp.io" };
const G1 = { name: "Adaobi Nwosu", relationship: "Former line manager", organisation: "Sample Media Ltd", title: "Chief Commercial Officer", phone: "8031234567", born: "22/07/1975" };
const G2 = { name: "Tunde Bello", relationship: "Family friend", phone: "8059876543", years: "12", born: "03/02/1970" };

const OUT = () => process.env.VIDEO_OUT || "/tmp/video/m5-onboarding-2";
const SAMPLES = () => path.join(OUT(), "samples");

/** The dialog or sheet on top; the case's own window by its name (a help term's popup is a dialog too). */
const dialog = (s) => s.page.locator("[role=dialog], [role=alertdialog]").last();
const kase = (s) => s.page.getByRole("dialog", { name: KUNLE.name, exact: true });
const inDialog = (s, label) => dialog(s).getByLabel(label, { exact: true }).first();
const button = (s, name, within) => (within || dialog(s)).getByRole("button", { name, exact: true }).first();
const text = (s, words) => s.page.getByText(words, { exact: true }).first();
const caseRow = (s) => (s.phone ? text(s, KUNLE.name) : s.page.getByRole("row", { name: new RegExp(KUNLE.name) }).first());
const docRow = (s, title) => kase(s).getByRole("row", { name: new RegExp(`^${title}`) }).first();
const region = (s, name) => s.page.getByRole("region", { name, exact: true });
const listItem = (s, title) => region(s, "Your Documents").getByRole("listitem").filter({ hasText: title }).first();

/** Pick a file in the device's picker, as the hire does: the picker never shows on screen. */
async function choose(s, target, file) {
  const [chooser] = await Promise.all([s.page.waitForEvent("filechooser", { timeout: 15000 }), s.click(target)]);
  await chooser.setFiles(path.join(SAMPLES(), file));
  await s.wait(1.2);
  await s.settle();
}

/** Type a street into an address field and pick the first place the search offers (F27). */
async function place(s, field, words) {
  await s.type(field, words, { delay: 45 });
  const first = s.page.getByRole("option").first();
  await first.waitFor({ timeout: 15000 });
  await s.wait(0.4);
  await s.click(first);
}

/** The newest signing code mailed to Kunle once one other than `before` has arrived. */
async function codeAfter(before) {
  for (let i = 0; i < 30; i++) {
    const got = await mail.message(KUNLE.email, "signature-code");
    if (String(got.data.code) !== String(before || "")) return String(got.data.code);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("No new signing code arrived");
}

/** The hire's page allows 20 writes a minute: a shot that writes starts in a fresh minute. */
const freshMinute = () => new Promise((r) => setTimeout(r, 61000));

/**
 * The files Kunle sends: one page each, plainly marked SAMPLE, naming no real organisation. PDFs
 * printed by Chromium; the passport photographs drawn silhouettes, not faces.
 */
async function samples() {
  if (fs.existsSync(path.join(SAMPLES(), "passport-photo-2.png"))) return;
  fs.mkdirSync(SAMPLES(), { recursive: true });
  const sheet = (title, rows, note = "") => `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Helvetica,Arial,sans-serif;margin:0;padding:56px 64px;color:#18181b}
.band{border:2px dashed #b45309;color:#b45309;font-weight:700;letter-spacing:.12em;text-align:center;padding:8px;margin-bottom:36px;font-size:13px}
h1{font-size:26px;margin:0 0 6px}.sub{color:#52525b;margin:0 0 28px;font-size:14px}
table{border-collapse:collapse;width:100%;font-size:15px}td{padding:10px 8px;border-bottom:1px solid #e4e4e7}td:first-child{color:#52525b;width:38%}
.note{margin-top:28px;font-size:13px;color:#52525b}.sig{margin-top:56px;border-top:1px solid #18181b;width:240px;padding-top:6px;font-size:13px;color:#52525b}
</style></head><body><div class="band">SAMPLE DOCUMENT · FOR DEMONSTRATION ONLY</div><h1>${title}</h1><p class="sub">Kunle Afolabi · invented candidate</p>
<table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>${note ? `<p class="note">${note}</p>` : ""}<div class="sig">Signature</div></body></html>`;
  const docs = {
    "proof-of-address.pdf": sheet("Proof of Residential Address", [["Document", "Utility bill (sample)"], ["Name", "Kunle Afolabi"], ["Address", "Admiralty Way, Lekki Phase 1, Lagos"], ["Billing month", "October 2026"]]),
    "valid-id.pdf": sheet("Valid ID", [["Document", "National identity card (sample)"], ["Name", "Kunle Afolabi"], ["Date of birth", "14/03/1988"], ["Number", "SAMPLE-0000-0000"]]),
    "certificates.pdf": sheet("Educational and Professional Certificates", [["Degree", "B.Sc. Marketing (sample)"], ["Class", "Second Class Upper"], ["Year", "2010"], ["NYSC", "Discharge certificate, 2011 (sample)"]]),
    "separation.pdf": sheet("Evidence of Separation", [["Document", "Letter of release (sample)"], ["Previous employer", "Sample Media Ltd (invented)"], ["Role", "Sales Director"], ["Last day", "31/10/2026"]]),
    "birth-certificate.pdf": sheet("Birth Certificate", [["Document", "Birth certificate (sample)"], ["Name", "Kunle Afolabi"], ["Date of birth", "14/03/1988"], ["Place of birth", "Lagos"]]),
    "employee-data-form.pdf": sheet("Employee Data Form", [["Full name", "Kunle Afolabi"], ["Phone", "0803 100 0000"], ["Next of kin", "Sample next of kin"], ["Emergency contact", "0803 100 0001"]], "Filled in by the hire, as MyCity's Employee Data Form asks."),
    "account-opening-form.pdf": sheet("Account Opening Form", [["Document", "Salary account opening form (sample)"], ["Account name", "Kunle Afolabi"], ["Account type", "Salary"], ["Bank", "Sample Bank (invented)"]]),
    "guarantor-form-1.pdf": sheet("Guarantor Form", [["Guarantor", `${G1.name} (invented)`], ["For", "Kunle Afolabi"], ["Relationship", G1.relationship], ["Organisation", G1.organisation]], "Signed by the guarantor (sample)."),
    "guarantor-id-1.pdf": sheet("Guarantor's ID", [["Document", "Identity card (sample)"], ["Name", `${G1.name} (invented)`], ["Number", "SAMPLE-1111-1111"]]),
    "guarantor-form-2.pdf": sheet("Guarantor Form", [["Guarantor", `${G2.name} (invented)`], ["For", "Kunle Afolabi"], ["Relationship", G2.relationship], ["Known for", `${G2.years} years`]], "Signed by the guarantor (sample)."),
    "guarantor-id-2.pdf": sheet("Guarantor's ID", [["Document", "Identity card (sample)"], ["Name", `${G2.name} (invented)`], ["Number", "SAMPLE-2222-2222"]]),
  };
  const photo = (ground, label) => `<!doctype html><html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="600" height="750" viewBox="0 0 600 750">
<rect width="600" height="750" fill="${ground}"/><circle cx="300" cy="300" r="130" fill="#8a9aa6"/><path d="M90 750 C 110 520, 490 520, 510 750 Z" fill="#8a9aa6"/>
<text x="300" y="60" font-family="Helvetica" font-size="28" font-weight="700" fill="#b45309" text-anchor="middle" letter-spacing="3">${label}</text></svg></body></html>`;
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ executablePath: process.env.MYCITY_CHROMIUM || undefined });
  try {
    const p = await browser.newPage();
    for (const [file, html] of Object.entries(docs)) {
      await p.setContent(html);
      await p.pdf({ path: path.join(SAMPLES(), file), format: "A4", printBackground: true });
    }
    await p.setViewportSize({ width: 600, height: 750 });
    // The first photograph is taken against a patterned wall; the second on a plain ground.
    await p.setContent(photo("#c9a27e", "SAMPLE"));
    await p.screenshot({ path: path.join(SAMPLES(), "passport-photo.png") });
    await p.setContent(photo("#f4f4f5", "SAMPLE"));
    await p.screenshot({ path: path.join(SAMPLES(), "passport-photo-2.png") });
  } finally {
    await browser.close();
  }
}

/** The morning's onboarding-dispatch, as its scheduler runs it at 06:43: a hire whose start date has come begins. */
async function morningRun() {
  await require("../../../src/config/redis").initRedis().catch(() => null);
  await require("../../../src/modules/onboarding/onboarding.service").dispatch();
}

module.exports = {
  id: "m5-onboarding-2",
  file: "MyCity-M5-Offers-and-Onboarding-Part-2-Documentation-and-Onboarding",
  meta: { title: "MyCity App · Offers and Onboarding, Part 2: Documentation and Onboarding (Milestone 5)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestone 5 Handover · Part 2",
    title: "Onboarding",
    subtitle: "From the contract to the first day",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestone 5 · Offers and Onboarding · Part 2",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    cynthia: (staff) => staff.operations.work_email,
    // The Implementation Team's account: Kunle's hiring manager, so his case's owner.
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
            "Welcome to the second walkthrough of Offers and Onboarding, delivered in Milestone 5 of the MyCity hub.",
            "It covers the contract, the new hire's documents, and their first month.",
          ],
          setup: () => samples(),
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: ONBOARDING,
          setup: () => samples(),
          lines: [
            { say: "Onboarding is the sixth tab of Recruitment. Each hire has a case here from the moment they sign.", do: (s) => s.hover(s.page.getByRole("tab", { name: /^Onboarding/ })) },
            { say: "The tiles count the cases at Documentation, Pre-Onboarding and Onboarding, and those hired this month.", do: (s) => s.hover(text(s, "Hired This Month")) },
            "Operations and People check every case. A Head of Department follows their own hires.",
            { say: "In the first walkthrough, Kunle Afolabi signed his offer. His case waits at Documentation.", do: (s) => s.hover(caseRow(s)) },
            "Cynthia Osakunih checks what he sends. The JBS Praxis Team, his hiring manager, owns his case.",
          ],
        },
      ],
    },
    {
      name: "Onboarding Settings",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: ONBOARDING,
          lines: [
            { say: "Cynthia presses Onboarding Settings. Only Operations and People see it.", do: (s) => s.click("Onboarding Settings") },
            { say: "Checklist is MyCity's New Joiner list: the documents every hire sends.", do: (s) => s.click(dialog(s).getByRole("row", { name: /^Checklist/ })) },
            { say: "Each is a file, a typed value, or both, required or optional. Add Document adds another.", do: (s) => s.hover(button(s, "Add Document")) },
            { say: "Onboarding Plans lists each department's plan. Company Default is for a department without one.", do: async (s) => { await s.click(button(s, "Back")); await s.click(dialog(s).getByRole("row", { name: /^Onboarding Plans/ })); } },
            { say: "Your First 30 Days has four steps, each with an owner and a due day from the start date.", do: (s) => s.click(dialog(s).getByRole("row", { name: /Company Default/ })) },
            { say: "She links the HR Induction step to MyCity's New Employee Onboarding SOP.", do: (s) => s.pick(dialog(s).getByLabel("SOP", { exact: true }).first(), "SOP-0009") },
            { say: "Save Plan. A case keeps the steps it was given, so this reaches hires from now on.", do: (s) => s.click(button(s, "Save Plan")), hold: 0.4 },
            { say: "Standard Contract is the contract's wording. Contracts already made keep theirs.", do: async (s) => { await s.click(button(s, "Back")); await s.click(dialog(s).getByRole("row", { name: /^Standard Contract/ })); } },
            { say: "She leaves it as it is.", do: async (s) => { await s.click(button(s, "Cancel")); await s.click(button(s, "Close")); } },
          ],
        },
      ],
    },
    {
      name: "The Contract",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: ONBOARDING,
          lines: [
            { say: "Cynthia opens Kunle's case. His contract was made when he signed his offer.", do: (s) => s.click(caseRow(s)) },
            { say: "It is made from the offer and the standard wording. MyCity signs first, then Kunle.", do: (s) => s.hover(kase(s).getByRole("heading", { name: "Contract" })) },
            { say: "As Offer Signatory, she presses Sign for Company.", do: (s) => s.click(button(s, "Sign for Company", kase(s))) },
            { say: "She draws her signature and ticks Agree to Sign Electronically.", do: async (s) => { await sign(s, dialog(s).locator("canvas").first()); await s.click(dialog(s).getByRole("checkbox", { name: "Agree to Sign Electronically" })); } },
            { say: "Sign Contract. Now Kunle gets an email with his own link to sign it.", do: (s) => s.click(button(s, "Sign Contract")), hold: 0.5 },
            { say: "He has fifteen days. Resend Contract sends a fresh link, and stops the old one.", do: (s) => s.hover(button(s, "Resend Contract", kase(s))) },
            "If he declines, or lets it lapse, Reissue Contract makes a new one.",
          ],
        },
      ],
    },
    {
      name: "Signing the Contract",
      shots: [
        {
          kind: "phone",
          site: "go",
          start: "/jobs",
          label: { eyebrow: "On the new hire's phone", title: "Sign Contract", subtitle: "Kunle signs his employment contract" },
          setup: async (s) => {
            const got = await mail.message(KUNLE.email, "contract-sent");
            await s.page.goto(got.data.sign_url);
            await s.settle();
          },
          lines: [
            { say: "The contract opens as the offer did: the terms, the job, and Schedule A.", do: (s) => s.scroll(1800) },
            {
              say: "He confirms it's him with Send Code, and types the code from his email.",
              do: async (s) => {
                const before = (await mail.message(KUNLE.email, "signature-code")).data.code;
                await s.click("Send Code");
                const code = await codeAfter(before);
                await s.click(s.page.getByRole("textbox", { name: "Digit 1 of 6" }));
                await s.page.keyboard.type(code, { delay: 180 });
                await region(s, "Sign Below").waitFor({ timeout: 15000 });
              },
            },
            { say: "He signs with a finger, ticks Agree to Sign Electronically, and presses Accept and Sign.", do: async (s) => { await sign(s, s.page.locator("canvas").first()); await s.click(s.page.getByRole("checkbox", { name: "Agree to Sign Electronically" })); await s.click("Accept and Sign"); } },
            { say: "Contract Signed. Both sides get the sealed copy by email.", do: (s) => s.page.getByRole("heading", { name: "Contract Signed" }).waitFor({ timeout: 20000 }), hold: 0.6 },
          ],
        },
      ],
    },
    {
      name: "Upload Documents",
      shots: [
        {
          kind: "phone",
          site: "go",
          start: "/jobs",
          label: { eyebrow: "In the new hire's inbox", title: "Your Documents", subtitle: "The email the hub sends, with Kunle's own link" },
          setup: async (s) => {
            const got = await mail.message(KUNLE.email, "onboarding-documents");
            await s.page.setContent(got.html);
          },
          lines: [
            "When Kunle signed his offer, a second email brought his link to Upload Documents.",
          ],
        },
        {
          kind: "phone",
          site: "go",
          start: "/jobs",
          label: { eyebrow: "On the new hire's phone", title: "Upload Documents", subtitle: "Kunle sends what MyCity needs before day one" },
          setup: async (s) => {
            await freshMinute();
            const got = await mail.message(KUNLE.email, "onboarding-documents");
            await s.page.goto(got.data.documents_url);
            await s.settle();
          },
          lines: [
            { say: "The page shows his role and start date. Nothing can be sent before he reads the Privacy Notice.", do: (s) => s.scroll(260) },
            { say: "It says what MyCity keeps, who sees it, and why. He ticks it and presses Accept Notice.", do: async (s) => { await s.click(s.page.getByRole("checkbox", { name: "I Have Read the Notice" })); await s.click("Accept Notice"); } },
            {
              say: "Under Your Documents, he presses Choose a File and picks a PDF or a photo. Each is sent at once.",
              do: async (s) => {
                await choose(s, listItem(s, "Proof of Residential Address").getByRole("button", { name: "Choose a File" }), "proof-of-address.pdf");
                await choose(s, listItem(s, "Valid ID").getByRole("button", { name: "Choose a File" }), "valid-id.pdf");
              },
            },
            {
              say: "His certificates with his NYSC, his release letter, his birth certificate, and the Employee Data Form.",
              do: async (s) => {
                await choose(s, listItem(s, "Educational and Professional Certificates").getByRole("button", { name: "Choose a File" }), "certificates.pdf");
                await choose(s, listItem(s, "Evidence of Separation").getByRole("button", { name: "Choose a File" }), "separation.pdf");
                await choose(s, listItem(s, "Birth Certificate").getByRole("button", { name: "Choose a File" }), "birth-certificate.pdf");
                await choose(s, listItem(s, "Employee Data Form").getByRole("button", { name: "Choose a File" }), "employee-data-form.pdf");
              },
            },
            {
              say: "The MyLagosApp Wallet ID is typed, then Save Value.",
              do: async (s) => {
                const item = listItem(s, "MyLagosApp Wallet ID");
                await s.type(item.getByRole("textbox", { name: "Value" }), "MLA-4829-1730", { delay: 60 });
                await s.click(item.getByRole("button", { name: "Save Value" }));
              },
            },
            {
              say: "Last, his passport photograph and the bank's account opening form.",
              do: async (s) => {
                await choose(s, listItem(s, "Passport Photograph").getByRole("button", { name: "Choose a File" }), "passport-photo.png");
                await choose(s, listItem(s, "Account Opening Form").getByRole("button", { name: "Choose a File" }), "account-opening-form.pdf");
              },
            },
            { say: "Each now reads Sent. Up to 15 megabytes a file.", do: (s) => s.scroll(-300), hold: 0.4 },
          ],
        },
      ],
    },
    {
      name: "Guarantors, Address and BVN",
      shots: [
        {
          kind: "phone",
          site: "go",
          start: "/jobs",
          label: { eyebrow: "On the new hire's phone", title: "Your Guarantors", subtitle: "Two guarantors, as MyCity's Guarantor Form asks" },
          setup: async (s) => {
            await freshMinute();
            const got = await mail.message(KUNLE.email, "onboarding-documents");
            await s.page.goto(got.data.documents_url);
            await s.settle();
            await region(s, "Your Guarantors").scrollIntoViewIfNeeded();
          },
          lines: [
            "Two guarantors, not related to him: a previous employer, and someone who has known him four years or more.",
            {
              say: "The first is his former line manager. Her name, the relationship, and her organisation.",
              do: async (s) => {
                const g = region(s, "Previous Employer");
                await s.type(g.getByLabel("Full Name", { exact: true }), G1.name, { delay: 35 });
                await s.type(g.getByLabel("Relationship", { exact: true }), G1.relationship, { delay: 30 });
                await s.type(g.getByLabel("Organisation", { exact: true }), G1.organisation, { delay: 30 });
              },
            },
            {
              say: "Her phone and date of birth, as on her Guarantor Form.",
              do: async (s) => {
                const g = region(s, "Previous Employer");
                await s.type(g.getByLabel("Phone", { exact: true }), G1.phone, { delay: 50 });
                await s.type(g.getByLabel("Date of Birth", { exact: true }), G1.born, { delay: 60 });
              },
            },
            {
              say: "Both her addresses are picked from the search, never typed.",
              do: async (s) => {
                const g = region(s, "Previous Employer");
                await place(s, g.getByRole("combobox", { name: "Contact Address" }), "Adeola Odeku Street");
                await place(s, g.getByRole("combobox", { name: "Residential Address" }), "Bourdillon Road");
              },
            },
            {
              say: "Never convicted, and she recommends him.",
              do: async (s) => {
                const g = region(s, "Previous Employer");
                await s.click(g.getByRole("radiogroup", { name: "Ever Convicted" }).getByRole("radio", { name: "No" }));
                await s.click(g.getByRole("radiogroup", { name: "Recommends You" }).getByRole("radio", { name: "Yes" }));
              },
            },
            {
              say: "Her signed Guarantor Form and a copy of her ID, then Save Guarantor.",
              do: async (s) => {
                const g = region(s, "Previous Employer");
                await choose(s, g.getByRole("button", { name: "Choose the Form" }), "guarantor-form-1.pdf");
                await choose(s, g.getByRole("button", { name: "Choose the Copy" }), "guarantor-id-1.pdf");
                await s.click(g.getByRole("button", { name: "Save Guarantor" }));
              },
            },
            {
              say: "The second is a family friend of twelve years, entered the same way.",
              do: async (s) => {
                const g = region(s, "Personal Guarantor");
                await s.type(g.getByLabel("Full Name", { exact: true }), G2.name, { delay: 30 });
                await s.type(g.getByLabel("Relationship", { exact: true }), G2.relationship, { delay: 25 });
                await s.type(g.getByLabel("Phone", { exact: true }), G2.phone, { delay: 40 });
                await s.type(g.getByLabel("Years Known", { exact: true }), G2.years, { delay: 80 });
                await s.type(g.getByLabel("Date of Birth", { exact: true }), G2.born, { delay: 50 });
                await place(s, g.getByRole("combobox", { name: "Contact Address" }), "Allen Avenue");
                await place(s, g.getByRole("combobox", { name: "Residential Address" }), "Ozumba Mbadiwe Avenue");
                await s.click(g.getByRole("radiogroup", { name: "Ever Convicted" }).getByRole("radio", { name: "No" }));
                await s.click(g.getByRole("radiogroup", { name: "Recommends You" }).getByRole("radio", { name: "Yes" }));
                await choose(s, g.getByRole("button", { name: "Choose the Form" }), "guarantor-form-2.pdf");
                await choose(s, g.getByRole("button", { name: "Choose the Copy" }), "guarantor-id-2.pdf");
                await s.click(g.getByRole("button", { name: "Save Guarantor" }));
              },
            },
            { say: "Each reads Being Checked, until MyCity calls them.", hold: 0.4 },
            {
              say: "Under Your Address, he picks his home address, and presses Save Address.",
              do: async (s) => {
                const a = region(s, "Your Address");
                await place(s, a.getByRole("combobox", { name: "Home Address" }), "Admiralty Way");
                await s.click(a.getByRole("button", { name: "Save Address" }));
              },
            },
            {
              say: "Last, the eleven digits of his BVN, then Save BVN. It is kept masked, and never shown again.",
              do: async (s) => {
                const b = region(s, "Your BVN");
                await s.type(b.getByRole("textbox", { name: "BVN" }), "22212345678", { delay: 70 });
                await s.click(b.getByRole("button", { name: "Save BVN" }));
              },
              hold: 0.4,
            },
          ],
        },
      ],
    },
    {
      name: "Checking What He Sent",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: ONBOARDING,
          lines: [
            { say: "In the hub, the tile shows documents to verify. Cynthia opens Kunle's case.", do: async (s) => { await s.hover(text(s, "Documentation")); await s.click(caseRow(s)); } },
            { say: "Every file was scanned for viruses as it arrived. She presses View File on his ID.", do: async (s) => { await s.scroll(520, kase(s).getByRole("heading", { name: "Contract" })); await s.click(button(s, "View File", docRow(s, "Valid ID"))); } },
            { say: "It's right, so she closes it and presses Verify.", do: async (s) => { await s.click(button(s, "Close")); await s.click(button(s, "Verify", docRow(s, "Valid ID"))); } },
            { say: "The passport photograph needs a plain background. She presses Reject.", do: (s) => s.click(button(s, "Reject", docRow(s, "Passport Photograph"))) },
            { say: "The reason goes back to Kunle, beside the document on his page.", do: async (s) => { await s.type(inDialog(s, "Reason"), "Please send a photograph on a plain, light background.", { delay: 18 }); await s.click(button(s, "Reject Document")); } },
            {
              say: "She verifies the rest. Each is verified on his record too, under People.",
              do: async (s) => {
                for (let i = 0; i < 8; i++) {
                  const v = kase(s).getByRole("button", { name: "Verify", exact: true }).first();
                  if (!(await v.isVisible().catch(() => false))) break;
                  await s.click(v);
                  await s.wait(0.3);
                }
              },
            },
            { say: "Pre-Onboarding says what the case still waits on.", do: (s) => s.hover(button(s, "Pre-Onboarding", kase(s))) },
          ],
        },
        {
          kind: "phone",
          site: "go",
          start: "/jobs",
          label: { eyebrow: "On the new hire's phone", title: "Send Again", subtitle: "Kunle sends another photograph" },
          setup: async (s) => {
            const got = await mail.message(KUNLE.email, "onboarding-documents");
            await s.page.goto(got.data.documents_url);
            await s.settle();
            await listItem(s, "Passport Photograph").scrollIntoViewIfNeeded();
          },
          lines: [
            "On Kunle's page, the photograph reads Send Again, with Cynthia's reason under it.",
            { say: "He presses Send Another File, and picks a new photograph.", do: (s) => choose(s, listItem(s, "Passport Photograph").getByRole("button", { name: "Send Another File" }), "passport-photo-2.png"), hold: 0.4 },
          ],
        },
      ],
    },
    {
      name: "Reference Checks",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: ONBOARDING,
          setup: (s) => s.click(caseRow(s)),
          lines: [
            { say: "Cynthia verifies the new photograph.", do: async (s) => { await s.scroll(520, kase(s).getByRole("heading", { name: "Contract" })); await s.click(button(s, "Verify", docRow(s, "Passport Photograph"))); } },
            { say: "Under Guarantors, each shows what their form says: born when, both addresses, convicted, recommends.", do: (s) => s.scroll(700, kase(s).getByRole("heading", { name: "Documents" })) },
            { say: "View Form and View ID open what Kunle sent. She calls each guarantor on the number given.", do: (s) => s.hover(button(s, "View Form", kase(s).getByRole("region", { name: G1.name }))) },
            {
              say: "Then Record Check: Passed, with a note.",
              do: async (s) => {
                await s.click(button(s, "Record Check", kase(s).getByRole("region", { name: G1.name })));
                await s.type(inDialog(s, "Note"), "Called; she confirmed her form.", { delay: 20 });
                await s.click(button(s, "Record Check"));
              },
            },
            "A guarantor can't pass without the signed form and the ID copy.",
            {
              say: "The second passes too.",
              do: async (s) => {
                await s.click(button(s, "Record Check", kase(s).getByRole("region", { name: G2.name })));
                await s.type(inDialog(s, "Note"), "Called; he confirmed his form.", { delay: 20 });
                await s.click(button(s, "Record Check"));
              },
              hold: 0.4,
            },
            {
              say: "Every document is verified, both guarantors have passed, and the contract is signed.|So the case moves to Pre-Onboarding by itself.",
              do: (s) => s.scroll(-1400, kase(s).getByRole("heading", { name: "Guarantors" })),
              hold: 0.6,
            },
            "From then, his upload page takes nothing more. Nothing starts before this.",
          ],
        },
      ],
    },
    {
      name: "The First Day",
      shots: [
        {
          kind: "phone",
          as: "team",
          start: ONBOARDING,
          label: { eyebrow: "On the hiring manager's phone", title: "Onboarding Plan", subtitle: "The JBS Praxis Team works through Kunle's first month" },
          setup: () => morningRun(),
          lines: [
            "Early on his start date, the case moves to Onboarding, and his department's plan is copied onto it.",
            { say: "His department has no plan of its own, so Your First 30 Days applies.", do: (s) => s.click(caseRow(s)) },
            { say: "Each step names its owner. On a computer, its due day and its SOP show too.", do: (s) => s.click(s.page.getByRole("heading", { name: "Onboarding Plan" })) },
            "Each owner is told. A step past its day shows as Overdue, and its owner is reminded once.",
            {
              say: "As the JBS Praxis Team finishes each step, it presses Mark Step Done.",
              do: async (s) => {
                for (let i = 0; i < 4; i++) {
                  const b = kase(s).getByRole("button", { name: "Mark Step Done", exact: true }).first();
                  if (!(await b.isVisible().catch(() => false))) break;
                  await s.click(b);
                  await s.wait(0.6);
                }
              },
              hold: 0.6,
            },
          ],
        },
      ],
    },
    {
      name: "Complete Onboarding",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: ONBOARDING,
          setup: (s) => s.click(caseRow(s)),
          lines: [
            { say: "With every step done, Cynthia presses Complete Onboarding.", do: (s) => s.click(button(s, "Complete Onboarding", kase(s))) },
            { say: "She types his Company Email. It becomes his work email, and the login he is invited on.", do: (s) => s.type(inDialog(s, "Company Email"), KUNLE.company, { delay: 40 }) },
            { say: "Complete Onboarding. The case is Completed, and Kunle is hired.", do: (s) => s.click(button(s, "Complete Onboarding")), hold: 0.6 },
            "His invitation goes to his new email. His seat on the Organogram is filled, and the vacancy closes when its openings are.",
            {
              say: "On People, his record's Documents tab holds his signed offer, his contract, and the documents he sent.",
              do: async (s) => {
                await s.go(`/people?tab=employees`);
                await s.type(s.page.getByRole("searchbox").first(), "Kunle", { delay: 60 });
                await s.click(text(s, KUNLE.name));
                await s.click(s.page.getByRole("tab", { name: /^Documents/ }));
              },
              hold: 0.8,
            },
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
            "That's Onboarding, from the contract to the first day.",
            "Every step is also written up in the User Guide, in the Knowledge Hub.",
            "Thank you for watching.",
          ],
        },
      ],
    },
  ],
};
