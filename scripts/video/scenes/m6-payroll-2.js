"use strict";
/**
 * Milestone 6 handover, part 2 of 2: Payroll, payslips and pay day. docs/runbooks/training-videos.md
 * says how a scene is written and filmed, and §8 the plan.
 *
 * Filmed on the database part 1 (`m6-payroll-1.js`) leaves, the same day: November 2026 approved by
 * Ifeoma Mbonu and its payslips published. MyCity's own people, by their real names, every salary an
 * example (said so in part 1). Cynthia Osakunih, Operations & People, reads the payslips, emails and
 * downloads them all, marks the run paid and shows Configurations, where Advanced Payroll stays off
 * (MyCity applies no statutory deduction yet; no figure is entered without its source). Aaron Agama
 * opens the payslip email on his phone and reads his payslip, with his advance, in My Payslips.
 */
const SLIPS = "/payroll?tab=payslips";
const RUNS = "/payroll?tab=payroll-runs";
const CONFIG = "/payroll?tab=configurations";

/** The dialog, sheet or confirmation on top. */
const dialog = (s) => s.page.locator("[role=dialog], [role=alertdialog]").last();
/** A window by its name, never a help term's popup (runbook §6.16). */
const named = (s, name) => s.page.getByRole("dialog", { name }).last();
const confirm = (s, name) => s.page.getByRole("alertdialog", { name }).last();
const inside = (s, name, label) => named(s, name).getByLabel(label, { exact: true }).first();
const button = (s, name, within) => (within || s.page).getByRole("button", { name, exact: true }).first();
const text = (s, words) => s.page.getByText(words, { exact: true }).first();
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

/** Wait until a payslip's PDF has loaded in its window (Preparing until the worker has made it). */
async function pdfIn(s, name = "Payslip") {
  await named(s, name).getByRole("document").first().waitFor({ state: "visible", timeout: 30000 }).catch(() => null);
}

/** Close the window on top (a payslip, a list), as a person would. */
const close = (s) => s.click(button(s, "Close", dialog(s)));

module.exports = {
  id: "m6-payroll-2",
  file: "MyCity-M6-Payroll-Part-2-Payslips-and-Pay-Day",
  meta: { title: "MyCity App · Payroll, Part 2: Payslips and Pay Day (Milestone 6)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestone 6 Handover · Part 2",
    title: "Payroll",
    subtitle: "Payslips, pay day and My Payslips",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestone 6 · Payroll · Part 2",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    cynthia: (staff) => staff.operations.work_email,
    aaron: (staff) => staff.everyone.find((p) => p.job_title === "Social Media Manager").work_email,
  },
  chapters: [
    {
      name: "Welcome",
      shots: [
        {
          kind: "card",
          card: "opening",
          lines: [
            "Welcome to the second walkthrough of Payroll, delivered in Milestone 6 of the MyCity hub.",
            "Part one ran November, and the CEO approved it. This part follows the payslips.",
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: SLIPS,
          lines: [
            { say: "We follow Cynthia Osakunih, the Operations and People Lead, on Payslips.", do: (s) => s.hover(s.page.getByRole("tab", { name: "Payslips", exact: true })) },
            "Then Aaron Agama, the Social Media Manager, who reads his payslip on his phone.",
            "As in part one, every salary here is an example, set for the walkthrough.",
          ],
        },
      ],
    },
    {
      name: "Payslips",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: SLIPS,
          lines: [
            { say: "Payslips lists a month's payslips. The Month picks it: November 2026.", do: (s) => s.hover(s.page.getByRole("combobox", { name: "Month" })) },
            { say: "Payslips, Gross, Deductions and Net, for the month.", do: (s) => s.hover(s.page.getByRole("list", { name: "Payslip figures" })) },
            { say: "Visible to Staff reads Published. Until the CEO approves, payslips are a Preview no one else sees.", do: (s) => s.hover(text(s, "Visible to Staff")) },
            { say: "Each person's Gross, Deductions and Net. Search finds anyone by name.", do: (s) => s.hover(s.page.getByRole("searchbox", { name: "Search people" })) },
            { say: "Cynthia presses Aaron's. His payslip opens: the PDF the hub made when the run was approved.", do: async (s) => { await s.click(row(s, "Aaron Agama")); await pdfIn(s); } },
            { say: "Monthly Pay, then Deductions: Salary Advance Repayment, one of two, 50,000 naira.", hold: 0.3 },
            { say: "Net Pay is 300,000 naira. Download PDF saves it.", do: (s) => s.hover(button(s, "Download PDF", named(s, "Payslip"))) },
            { say: "A role that doesn't see pay reads Restricted in place of each amount.", after: (s) => close(s) },
          ],
        },
      ],
    },
    {
      name: "Email and Download All",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: SLIPS,
          lines: [
            { say: "Email All Payslips sends each person their own, to their work email, with the PDF attached.", do: async (s) => { await s.click(button(s, "Email All Payslips")); await toastOf(s, "Payslips are being emailed"); } },
            "Each person was already told in the hub that their payslip is ready.",
            { say: "Pressed again, everyone has had theirs. Email Again would send them all again. Cynthia presses Not Now.", do: async (s) => { await s.click(button(s, "Email All Payslips")); await s.wait(1.2); await s.click(button(s, "Not Now", confirm(s, "Email Again"))); } },
            { say: "Download All makes one PDF with every payslip, a page each.", do: async (s) => { await s.click(button(s, "Download All")); await toastOf(s, "Payslips downloaded"); } },
            "On a phone, both are under the three dots at the top.",
          ],
        },
      ],
    },
    {
      name: "Mark Paid",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: RUNS,
          lines: [
            "The CEO sends the money by bank transfer, outside the hub. For this walkthrough, it went today.",
            { say: "Cynthia presses Mark Paid.", do: (s) => s.click(button(s, "Mark Paid")) },
            { say: "Paid On is the day it left the bank. It can never be a day still to come.", do: (s) => s.hover(inside(s, "Mark Paid", "Paid On")) },
            { say: "The Payment Reference, from the bank's transfer, ties the run to the statement.", do: (s) => s.type(inside(s, "Mark Paid", "Payment Reference"), "NIP-261114-8830417", { delay: 55 }) },
            { say: "Mark Paid. The run reads Paid, the last of its five steps.", do: async (s) => { await s.click(button(s, "Mark Paid", named(s, "Mark Paid"))); await toastOf(s, "Run marked paid"); await soft(s, s.page.getByRole("list", { name: "November 2026 run" })); } },
            { say: "It leaves Home's Payroll In Progress card. A month left unpaid stays on it, however old.", do: (s) => soft(s, text(s, "Paid On")) },
          ],
        },
      ],
    },
    {
      name: "Configurations",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: CONFIG,
          lines: [
            { say: "Configurations holds how payroll works for everyone. Operations and People and the CEO can change it.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Payroll Options" })) },
            { say: "Pay Day is the 30th until changed. In a shorter month, the month's last day is paid.", do: (s) => s.hover(s.page.getByRole("button", { name: "Pay Day", exact: true })) },
            { say: "Set Pay Day picks 1 to 30, or Last Day of Month, from a day. MyCity keeps the 30th.", do: async (s) => { await s.click(button(s, "Set Pay Day")); await s.click(named(s, "Set Pay Day").getByRole("combobox", { name: "Pay Day" })); await s.wait(1.6); await s.page.keyboard.press("Escape"); await s.wait(0.4); await s.click(button(s, "Cancel", named(s, "Set Pay Day"))); } },
            { say: "With Bank Details Required on, a person with no bank details stops Submit for Approval.", do: (s) => s.hover(s.page.getByRole("switch", { name: "Bank Details Required" })) },
            "Advanced Payroll brings in PAYE, pension, NHF, ITF and NSITF. MyCity applies none yet, so it's Off.",
            { say: "Statutory Items lists each one. Every figure reads Not Set.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Statutory Items" })) },
            { say: "Operations and People enter each figure when MyCity starts. Cynthia opens Employee Pension to show how.", do: (s) => s.click(text(s, "Employee Pension")) },
            { say: "The Rate, its Base, and the day it takes effect.", do: (s) => s.hover(inside(s, "Set Employee Pension", "Rate")) },
            { say: "Then where it comes from: the law's title, its Section, a Link or the Document, and the day it was checked.", do: (s) => s.hover(inside(s, "Set Employee Pension", "Source")) },
            { say: "A company rule with no law behind it is ticked No Legal Source, and given a reason.", do: async (s) => { await s.click(named(s, "Set Employee Pension").getByRole("checkbox", { name: "No Legal Source" })); await s.wait(1.4); } },
            { say: "No figure is entered without its source, and nothing changes one by itself.", after: (s) => s.click(button(s, "Cancel", named(s, "Set Employee Pension"))) },
            { say: "Switching Advanced Payroll on asks the day it starts.", do: (s) => s.click(s.page.getByRole("switch", { name: "Advanced Payroll" })) },
            { say: "With no figure in force that day, Switch On is refused.", do: async (s) => { await s.click(button(s, "Switch On", named(s, "Switch On Advanced Payroll"))); await s.wait(1.2); } },
            { say: "Once on, runs from that day compute each item, and locked runs never change.", after: (s) => s.click(button(s, "Cancel", named(s, "Switch On Advanced Payroll"))) },
          ],
        },
      ],
    },
    {
      name: "My Payslips",
      shots: [
        {
          kind: "phone",
          as: "aaron",
          start: "/home",
          label: { eyebrow: "On the employee's phone", title: "My Payslips", subtitle: "Aaron Agama reads his November payslip" },
          setup: async (s) => {
            const mail = require("../mail");
            const staff = await require("../people").posts();
            const m = await mail.message(staff.everyone.find((p) => p.job_title === "Social Media Manager").work_email, "payslip-ready");
            await s.page.setContent(m.html);
          },
          lines: [
            "Aaron Agama's payslip email has arrived: Your payslip for November 2026, with the PDF attached.",
            { say: "He taps Open My Payslips.", do: async (s) => { await s.click(s.page.getByRole("link", { name: "Open My Payslips" })); await pdfIn(s); } },
            { say: "My Payslips opens on November's payslip, in Employee Self-Service.", do: (s) => s.wait(0.5) },
            { say: "Download PDF saves it. Email a Copy sends it again to his work email.", do: async (s) => { await s.click(button(s, "Email a Copy", named(s, "Payslip"))); await toastOf(s, "Sent to your work email"); } },
            { say: "He closes it. My Payslips shows the year: Net Received, his payslips, and his deductions.", do: (s) => close(s) },
            { say: "November reads Paid with a deduction.", do: (s) => soft(s, text(s, "Paid with a deduction")) },
            { say: "View Details opens Salary Deductions: each month's deduction, its reason, and any query it came from.", do: async (s) => { await s.click(s.page.getByRole("button", { name: /View Details/ }).first()); await s.wait(1); } },
            { say: "His advance: 50,000 naira deducted in November, and 50,000 scheduled for December.", hold: 0.4, after: (s) => close(s) },
            "Download All gives him the whole year's payslips in one PDF. The arrows change the year.",
            "Nobody else's payslip ever shows here. Each person sees only their own.",
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
          start: RUNS,
          lines: [
            { say: "That's Payroll, from New Run to a payslip on a phone.", do: (s) => s.hover(s.page.getByRole("list", { name: "November 2026 run" })) },
            "Each month is computed, checked, approved by the CEO, locked, paid and published.",
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
