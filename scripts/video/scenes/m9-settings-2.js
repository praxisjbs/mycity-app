"use strict";
/**
 * Milestone 9 handover, part 2 of 2: Settings, Running the Hub. docs/runbooks/training-videos.md
 * says how a scene is written and filmed, and §8 the plan.
 *
 * Filmed on the database part 1 (`m9-settings-1.js`) leaves. MyCity's own people, by their real names
 * (TB, 14/11/2026). Cynthia Osakunih, Operations & People, enters the company's details and its logo,
 * reads the holidays and the working week, gives Leave Request's line manager a day instead of two,
 * sets the reminders, reads Appearance and the numbering, and imports MyCity's own staff list again
 * (every row unchanged). Bode Oluwasanmi, the CTO and System Administrator, tests the AI provider,
 * reads a failing connection, and works through the system's health after a real outage: the worker
 * stopped before Status is filmed and started again before the next shot, and Redis stopped for a
 * minute before Faults, so what the screens show happened (TB: "cause real faults", never invented).
 */
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");

const ORG = "/settings?tab=organisation";
const APPROVALS = "/settings?tab=approvals";
const NOTICES = "/settings?tab=notifications";
const LOOK = "/settings?tab=appearance";
const NUMBERING = "/settings?tab=documents-and-numbering";
const LINKS = "/settings?tab=integrations";
const STATUS = "/settings?tab=status";
const PERF = "/settings?tab=performance";
const FAULTS = "/settings?tab=faults";
const IMPORTS = "/settings?tab=imports";
const ROOT = path.resolve(__dirname, "..", "..", "..");
const LOGO = path.join(ROOT, "assets", "brand", "logo.png");
const STAFF_LIST = path.join(ROOT, "seeds", "staff", "staff-list.xlsx");

/** The dialog, sheet or confirmation on top. */
const dialog = (s) => s.page.locator("[role=dialog], [role=alertdialog]").last();
const named = (s, name) => s.page.getByRole("dialog", { name }).last();
const button = (s, name, within) => (within || s.page).getByRole("button", { name, exact: true }).first();
const text = (s, words) => s.page.getByText(words, { exact: true }).first();
const heading = (s, name) => s.page.getByRole("heading", { name, exact: true }).first();
/** A table's row holding every one of `words`. */
const row = (s, ...words) => words.reduce((r, w) => r.filter({ hasText: w }), s.page.getByRole("row")).first();

async function toastOf(s, start, seconds = 20) {
  await s.page.getByText(new RegExp(`^${start}`)).first().waitFor({ state: "visible", timeout: seconds * 1000 }).catch(() => null);
}

async function soft(s, loc, wait = 4000) {
  if (await loc.waitFor({ state: "visible", timeout: wait }).then(() => true, () => false)) await s.hover(loc);
}

async function readNotices(email) {
  const { pool } = require("../../../src/config/db");
  await require("../people").caughtUp(pool, email);
}

/** The worker, as the server's service runs it: stopped for a real outage, started again after it. */
const worker = {
  stop: () => execSync("pkill -f '^node src/worker.js' ; true"),
  start: () => spawn("node", ["src/worker.js"], { cwd: ROOT, detached: true, stdio: "ignore", env: process.env }).unref(),
};

/** The worker's heartbeat lasts 90 seconds (src/jobs/registry.js): Status reads it gone after that. */
const HEARTBEAT_S = 100;

/** Wait until the worker has grouped the faults reported (its five-minute roll-up), as Faults lists them. */
async function untilFaults(s, minutes = 7) {
  const { pool } = require("../../../src/config/db");
  const until = Date.now() + minutes * 60000;
  while (Date.now() < until) {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM error_group WHERE status = 'open'");
    if (rows[0].n > 0) return;
    await s.wait(10);
  }
}

module.exports = {
  id: "m9-settings-2",
  file: "MyCity-M9-Settings-Part-2-Running-the-Hub",
  meta: { title: "MyCity App · Settings, Part 2: Running the Hub (Milestone 9)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestone 9 Handover · Part 2",
    title: "Settings",
    subtitle: "The company, approvals, notifications and the system's health",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestone 9 · Settings · Part 2",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    cynthia: (staff) => staff.operations.work_email,
    bode: (staff) => staff.everyone.find((p) => p.job_title === "Chief Technology Officer").work_email,
  },
  chapters: [
    {
      name: "Welcome",
      shots: [
        {
          kind: "card",
          card: "opening",
          lines: [
            "Welcome to the second walkthrough of Settings and Governance, delivered in Milestone 9 of the MyCity hub.",
            "Part one covered logins, roles and security. This part covers how the hub is set up and kept well.",
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: ORG,
          setup: () => readNotices("cynthia@mycityapp.io"),
          lines: [
            { say: "Cynthia Osakunih, the Operations and People Lead, sets up the company, approvals and notifications.", do: (s) => s.hover(s.page.getByRole("tablist", { name: "Settings" })) },
            "Bode Oluwasanmi, the Chief Technology Officer, looks after the connections and the system's health.",
            "Every change here applies to everyone at once, with no new release.",
          ],
        },
      ],
    },
    {
      name: "Organisation",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: ORG,
          lines: [
            { say: "Organisation holds the company's details. Currency and Time Zone are fixed: Naira, and Lagos.", do: (s) => s.hover(heading(s, "Company")) },
            { say: "The details are still empty. Cynthia presses Edit Profile.", do: (s) => s.click(button(s, "Edit Profile")) },
            { say: "Legal Name, MyCity App Limited. Trading Name, MyCity App.", do: async (s) => { await s.type("Legal Name", "MyCity App Ltd", { delay: 45 }); await s.type("Trading Name", "MyCity App", { delay: 45 }); } },
            { say: "The Website, whole. RC Number and Tax ID wait for the company's papers: every field is optional.", do: (s) => s.type("Website", "https://mycityapp.io", { delay: 40 }) },
            "The Address is always picked from the search, or pinned on the map, never typed freely.",
            { say: "Save Profile.", do: async (s) => { await s.click(button(s, "Save Profile", dialog(s))); await toastOf(s, "Profile saved"); } },
            { say: "Brand holds the logo letters and the hub's own mail carry. She presses Upload Logo.", do: async (s) => { const chooser = s.page.waitForEvent("filechooser"); await s.click(button(s, "Upload Logo")); await (await chooser).setFiles(LOGO); await toastOf(s, "Logo updated"); } },
            "MyCity's own logo, a PNG with a clear background. White Logo and Icon work the same way.",
            { say: "Public Holidays shows the year's holidays, each Declared, or Expected until the government declares it.", do: (s) => s.hover(heading(s, "Public Holidays")) },
            { say: "Next year's are already listed. An Expected one is confirmed, or moved, once it's declared.", do: (s) => s.click(button(s, "2027")) },
            { say: "Working Week: weekdays nine to five, Saturdays nine to three. Leave and every deadline count from it.", do: (s) => soft(s, heading(s, "Working Week")) },
          ],
        },
      ],
    },
    {
      name: "Approvals",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: APPROVALS,
          lines: [
            { say: "Approvals decides who approves each kind of request, in which order, and how long each has.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Approvals" }).first()) },
            { say: "Flows, Open Requests, Overdue, and any flow that Needs Fixing.", do: (s) => s.hover(text(s, "Overdue")) },
            { say: "Cynthia opens Leave Request.", do: (s) => s.click(row(s, "Leave Request")) },
            "First the Line Manager, then Operations and People when the leave is over five days.",
            { say: "MyCity wants leave decided within a day. She presses Edit Stages.", do: (s) => s.click(button(s, "Edit Stages")) },
            { say: "The pencil opens the Line Manager stage. Approver, Applies When, and the Time Limit in hours.", do: async (s) => { await s.click(dialog(s).getByRole("button", { name: /^Edit Line Manager/ }).first()); } },
            { say: "She changes the Time Limit from 48 hours to 24, and presses Update Stage.", do: async (s) => { await s.type(dialog(s).getByLabel("Time Limit, Hours", { exact: true }), "24", { delay: 120 }); await s.click(button(s, "Update Stage", dialog(s))); } },
            { say: "Save Stages. Leave Request saved as version 2.", do: async (s) => { await s.click(button(s, "Save Stages", dialog(s))); await toastOf(s, "Leave Request saved as version"); } },
            "Requests already open keep the version they started on. New ones follow version 2.",
            { say: "New Flow builds a flow from scratch, for a developer to connect to a screen.", do: (s) => s.hover(button(s, "New Flow")) },
          ],
        },
      ],
    },
    {
      name: "Notifications",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: NOTICES,
          lines: [
            { say: "Notifications decides who is told about each event, how, and how urgently.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Notifications" }).first()) },
            { say: "Reminders: Approvals Waiting, Probation Ending, and a Daily Digest of what each person hasn't read.", do: (s) => s.hover(heading(s, "Reminders")) },
            { say: "Approvers are reminded every 24 hours. With leave now due in a day, Cynthia makes it every 8.", do: (s) => s.click(button(s, "Edit Reminders")) },
            { say: "Every How Many Hours: 8. Save Reminders.", do: async (s) => { await s.type(dialog(s).getByLabel("Every How Many Hours", { exact: true }), "8", { delay: 120 }); await s.click(button(s, "Save Reminders", dialog(s))); await toastOf(s, "Reminders saved"); } },
            "Reminders go out from eight in the morning to six in the evening, never at night.",
            { say: "Below, every notice: Who it goes to, its Channels and its Level. Security notices are Always On.", do: (s) => s.hover(s.page.getByRole("columnheader", { name: "Channels" })) },
            { say: "She searches for leave, and opens the notice that a leave request was cancelled.", do: async (s) => { await s.type(s.page.getByRole("searchbox", { name: "Notice" }), "leave", { delay: 70 }); await s.wait(1); await s.click(s.page.getByRole("row").nth(1)); } },
            { say: "Edit Notice: On, its Level, and In App, Email and Push for anyone who hasn't chosen their own.", do: (s) => soft(s, dialog(s).getByText("Push", { exact: true }).first()) },
            { say: "Add Roles and Add People send a copy to more people. She leaves it as it is.", after: (s) => s.click(button(s, "Cancel", dialog(s))) },
            "Each person still picks their own channels and quiet hours, under the bell's Notification Settings.",
          ],
        },
      ],
    },
    {
      name: "Appearance and Numbering",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: LOOK,
          lines: [
            { say: "Appearance sets the dark theme, the fonts, and the theme and density everyone starts with.", do: (s) => s.hover(heading(s, "Dark Theme")) },
            { say: "Deep Green is MyCity's own. Charcoal shows how another would look, in Preview.", do: (s) => s.click(button(s, "Charcoal")) },
            { say: "Contrast checks every text against its background, and adjusts any colour that would be hard to read.", do: (s) => s.hover(heading(s, "Contrast")) },
            { say: "She keeps Deep Green: Undo Changes.", do: (s) => s.click(button(s, "Undo Changes")) },
            { say: "Documents and Numbering sets how each document is numbered.", do: (s) => s.go(NUMBERING) },
            { say: "Each shows its Next Number, its Prefix, when it Starts Again, and how many are Issued.", do: (s) => soft(s, s.page.getByRole("columnheader", { name: "Next Number" })) },
            { say: "She opens Expense Request: prefix EXP, four digits, never starting again.", do: (s) => s.click(row(s, "Expense Request")) },
            { say: "Next shows the next number as it will look. A number already given never changes.", hold: 0.5, after: (s) => s.click(button(s, "Cancel", dialog(s))) },
          ],
        },
      ],
    },
    {
      name: "Integrations",
      shots: [
        {
          kind: "desktop",
          as: "bode",
          start: LINKS,
          setup: () => readNotices("bode@mycityapp.io"),
          lines: [
            { say: "Integrations is the IT team's: the mail servers, maps, the AI providers, exchange rates and push.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Integrations" }).first()) },
            { say: "Working, Failing and Not Set Up. All, Mail, Maps, AI, Finance and Notifications narrow the list.", do: (s) => s.hover(text(s, "Not Set Up")) },
            { say: "Gemini runs the hub's AI. Bode presses Test on its row.", do: async (s) => { await s.click(button(s, "Test", row(s, "Gemini"))); await toastOf(s, "Test (passed|failed)", 40); } },
            { say: "Test passed: it reads Working. He opens it.", do: (s) => s.click(row(s, "Gemini").getByText("Gemini", { exact: true })) },
            { say: "The API Key reads Saved, with its last four characters. Nobody reads the key itself.", do: (s) => soft(s, dialog(s).getByText("API Key", { exact: true })) },
            { say: "In Use says which model runs each job. Models lists all 33 the key may use.", do: (s) => soft(s, dialog(s).getByRole("heading", { name: "Models" })) },
            { say: "Open AI Control chooses which model each feature uses: Milestone 10's video covers it.", after: (s) => s.click(button(s, "Close", dialog(s))) },
            { say: "Staff Mail Server reads Failing: Not answering. The hub tests it by itself and says why.", do: (s) => s.hover(row(s, "Staff Mail Server")) },
            "Edit Settings changes a connection. Nothing is saved until its test passes.",
          ],
        },
      ],
    },
    {
      name: "Status",
      shots: [
        {
          kind: "desktop",
          as: "bode",
          start: STATUS,
          // A real outage: the worker, which runs the background jobs, stopped until Status reads it down.
          setup: async (s) => { worker.stop(); await s.wait(HEARTBEAT_S); await s.go(STATUS); },
          lines: [
            { say: "Status says whether every part of the hub is working. It refreshes itself every thirty seconds.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Status" }).first()) },
            "The worker, which runs the background jobs, has just stopped. Mail, PDFs and notices wait.",
            { say: "The pill reads Degraded. Checks lists every check that is not up: Worker, Not answering.", do: (s) => soft(s, s.page.getByRole("heading", { name: "Checks" })) },
            "Open Faults reads one, from the database restart. Staff Mail Server still fails, as on Integrations.",
            { say: "He presses Open on Worker: its Queues, what's Waiting, and the Newest Failure.", do: (s) => s.click(s.page.getByRole("button", { name: "Open", exact: true }).first()) },
            "Details beside each check says what it means, and where to look.",
            { say: "Download Brief saves one file describing the whole system, problems first, for whoever fixes it.", after: (s) => s.click(button(s, "Close", dialog(s))), do: (s) => soft(s, button(s, "Download Brief")) },
          ],
        },
        {
          kind: "desktop",
          as: "bode",
          start: STATUS,
          setup: async (s) => { worker.start(); await s.wait(45); await s.go(STATUS); },
          lines: [
            { say: "The server's administrator starts the worker again. Its check is up, and the jobs catch up.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Status" }).first()) },
            { say: "Show All lists every check: the database, Redis, the worker, mail, storage and the rest.", do: (s) => s.click(button(s, "Show All")) },
            "If the API itself is down, the server mails the same brief to the IT team every five minutes.",
          ],
        },
      ],
    },
    {
      name: "Performance",
      shots: [
        {
          kind: "desktop",
          as: "bode",
          start: PERF,
          lines: [
            { say: "Performance measures how fast the hub answers, how often it fails, and how busy the server is.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Performance" }).first()) },
            { say: "Window picks the Hour, Day, Week or Month.", do: (s) => s.hover(s.page.getByRole("radiogroup", { name: "Window" }).first()) },
            { say: "Availability, Response Time and Failed Requests turn green when MyCity's target is met, red when missed.", do: (s) => soft(s, text(s, "Availability")) },
            { say: "Processor, Memory and Disk read Normal, High or Critical. Full In says when the disk fills.", do: (s) => soft(s, text(s, "Processor")) },
            { say: "Charts follow, one a figure. Lower down, the Slowest Routes, the Database, Background Work and Processes.", do: (s) => s.scroll(900) },
            { say: "Edit Targets sets the levels, from Availability to when the disk turns amber and red.", do: (s) => soft(s, button(s, "Edit Targets")) },
          ],
        },
      ],
    },
    {
      name: "Faults",
      shots: [
        {
          kind: "desktop",
          as: "bode",
          start: FAULTS,
          setup: async (s) => { await untilFaults(s); await s.go(FAULTS); },
          lines: [
            { say: "Faults lists every error the hub reported, grouped, so one problem is one line with a count.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Faults" }).first()) },
            "The database restarted for a minute this evening, and five sign-ins failed meanwhile. Here they are.",
            { say: "Each says where it came from, how often Today, how many People it reached, and when it was Last Seen.", do: (s) => soft(s, s.page.getByRole("row").nth(1)) },
            { say: "Bode opens it: connect, refused, on POST auth login.", do: (s) => s.click(s.page.getByRole("row").nth(1)) },
            "What it probably means, Where it happened, First Seen and Last Seen, and How Often.",
            { say: "Take It On: it reads Being Handled, held by him, so nobody else starts on it.", do: async (s) => { await s.click(s.page.getByRole("button", { name: "Take It On", exact: true }).last()); await toastOf(s, "Marked being handled"); } },
            { say: "He writes what he found in Note.", do: (s) => s.type(s.page.getByRole("textbox", { name: "Note" }), "Database restarted at 18:41. Sign-ins answer again; nothing lost.", { delay: 22 }) },
            { say: "Mark Fixed. If it happens again, it comes back marked Came Back.", do: async (s) => { await s.click(s.page.getByRole("button", { name: "Mark Fixed", exact: true }).last()); await toastOf(s, "Marked fixed"); } },
            "Tick several to mark them together, or Download Brief for one file about them all.",
          ],
        },
      ],
    },
    {
      name: "Imports",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: IMPORTS,
          lines: [
            { say: "Imports brings in a spreadsheet of records, such as new staff, and can undo it.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Imports" }).first()) },
            { say: "Cynthia presses Start Import, and chooses Employees.", do: async (s) => { await s.click(button(s, "Start Import")); await s.pick("What To Import", "Employees"); } },
            { say: "Blank Sheet gives the right columns. She uses MyCity's own staff list.", do: async (s) => { const chooser = s.page.waitForEvent("filechooser"); await s.click(dialog(s).getByText(/Drop files here/).first()); await (await chooser).setFiles(STAFF_LIST); } },
            { say: "Next. Map matches each column to a field. Leave Out skips one.", do: (s) => s.click(button(s, "Next", dialog(s))) },
            { say: "Next. Preview shows what would happen. Nothing is saved yet.", do: (s) => s.click(button(s, "Next", dialog(s))) },
            { say: "Nine rows read Unchanged: already in the hub, so nothing is made twice.", do: (s) => soft(s, named(s, "Import Records").getByText("Unchanged").first()) },
            { say: "The rest say why, row by row. This copy has no phone numbers, and birthdays carry no year.", do: (s) => soft(s, named(s, "Import Records").getByRole("columnheader", { name: "Problem" })) },
            "Nothing is saved yet. Cynthia would put the file right, or commit the valid rows only.",
            { say: "She closes it. History keeps every import, with its error file, and Revert undoes a committed one.", after: (s) => s.click(button(s, "Close", named(s, "Import Records"))) },
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
          start: ORG,
          lines: [
            { say: "That's Settings, from the company's details to the system's health.", do: (s) => s.hover(s.page.getByRole("tablist", { name: "Settings" })) },
            "Together with part one, it's everything Milestone 9 delivers.",
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
