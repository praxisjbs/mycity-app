"use strict";
/**
 * Milestones 0 and 1, part 4 of 5: Home and Attendance. docs/runbooks/training-videos.md says how a
 * scene is written and filmed, and §8 the plan of the five.
 *
 * MyCity's own people by their real names (an internal video), on one real working day, Monday
 * 16/11/2026, never a faked clock (runbook §6.19). Filmed from a fresh staging seed of that morning,
 * run before anyone's seeded clock-in had come: Bassey Ekpe, a Content & Listing Associate (Aaron
 * Agama is on approved leave that week), starts his day from the clock on his phone before 09:00.
 * Once the team is in (`morning` below runs the seed's own attendance step again, which writes only the
 * punches whose time has come and leaves Bassey's own day alone), Cynthia Osakunih, Operations &
 * People, reads her Overview, Team, Alerts and Reports and the attendance register, and Ifeoma Mbonu,
 * the CEO, her Overview. Late in the morning Bassey leaves early for an appointment and clocks out; the
 * 17:00 prompt, Remind Me and the system clock-out are said, not shown (JBS Praxis chose not to wait).
 *
 *   node scripts/video/make.js m01-home-attendance-4 film --only=c02s01,c03s01      before 09:00
 *   node -e 'require("./scripts/video/scenes/m01-home-attendance-4").morning()'  after 10:00
 *   node scripts/video/make.js m01-home-attendance-4 film --only=<the day's shots>
 *   node scripts/video/make.js m01-home-attendance-4 film --only=c10s01              his clock-out
 */
const path = require("node:path");
const h = require("../helpers");

const src = (p) => require(path.join(__dirname, "..", "..", "..", "src", p));

const HOME = "/home?tab=overview";
const TEAM = "/home?tab=team";
const ALERTS = "/home?tab=alerts";
const REPORTS = "/home?tab=reports";
const REGISTER = "/people?tab=attendance";
const MINE = "/ess?tab=my-attendance";

/** The seed's own attendance step again, once the team's clock-ins have come (the filming database only). */
async function morning({ log = console.log } = {}) {
  const { config } = src("config/env");
  require("../people").guard(config);
  const { pool } = src("config/db");
  const requestContext = src("config/request-context");
  const { realStaff } = require("../../../seeds/staging/lib/staff");
  const { seedAttendance } = require("../../../seeds/staging/lib/attendance");
  const staff = await realStaff(pool);
  await requestContext.run({ requestId: "video-m01-4", surface: "script" }, () =>
    seedAttendance({ db: pool, people: staff.everyone, now: new Date(), log }),
  );
}

/** The clock's window, whatever it is called at the moment (Clock In, then the result). */
const clock = (s) => s.page.getByRole("dialog").last();
/** A card on the Overview: a button named by its title and figure. */
const card = (s, title) => s.page.getByRole("button", { name: new RegExp(`^${title}\\b`) }).first();

module.exports = {
  id: "m01-home-attendance-4",
  file: "MyCity-M0-M1-Part-4-Home-and-Attendance",
  meta: { title: "MyCity App · Getting Started, Part 4: Home and Attendance (Milestones 0 and 1)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestones 0 and 1 · Part 4 of 5",
    title: "Home and Attendance",
    subtitle: "The dashboards, and clocking in and out",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestones 0 and 1 · Part 4 · Home and Attendance",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  morning,
  people: {
    bassey: (staff) => staff.everyone.find((p) => p.first_name === "Bassey" && p.job_title === "Content & Listing Associate").work_email,
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
            "Welcome to part four of five on Milestones 0 and 1 of the MyCity hub.",
            "This part is one working Monday: clocking in, the dashboards on Home, the attendance register, and clocking out.",
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: HOME,
          lines: [
            { say: "Home is the first item in the menu. Its tabs are Overview, Team, Alerts and Reports.", do: (s) => h.tour(s, ["Overview", "Team", "Alerts", "Reports"].map((t) => h.tab(s, t))) },
            "Each person's Home is built for their role, so two colleagues see different Overviews.",
            "We follow Bassey Ekpe, a Content and Listing Associate, Cynthia Osakunih, and Ifeoma Mbonu, the CEO.",
          ],
        },
      ],
    },
    {
      name: "Starting the Day",
      shots: [
        {
          kind: "phone",
          as: "bassey",
          clock: true,
          start: HOME,
          geolocation: { latitude: 6.5244, longitude: 3.3792 },
          label: { eyebrow: "On Bassey's phone", title: "Start Your Day", subtitle: "Bassey Ekpe clocks in" },
          lines: [
            "It's Monday morning. Bassey opens the hub on his phone, and the clock opens by itself: Start Your Day.",
            { say: "His Shift is 09:00 to 17:00. His Work Arrangement is Remote.", do: (s) => h.soft(s, clock(s).getByText("Work Arrangement").first()) },
            { say: "Clock Location reads Not Checked: MyCity does not check where its remote staff work.", do: (s) => h.soft(s, clock(s).getByText("Not Checked").first()) },
            "An office worker's clock would match them to their office, from their phone's location, read once at that moment.",
            { say: "He taps Clock In.", do: (s) => s.click(h.button(s, "Clock In", clock(s))) },
            { say: "Clocked in, with the time. It counts, and the day is his.", do: (s) => h.soft(s, clock(s).getByText(/Clocked In/).first(), 10000) },
            { say: "Done.", do: (s) => s.click(h.button(s, "Done", clock(s))) },
            "If the hub ever can't place him, the clock says why, and Clock In Anyway sends the punch to People to check.",
          ],
        },
      ],
    },
    {
      name: "A Staff Member's Home",
      shots: [
        {
          kind: "phone",
          as: "bassey",
          start: HOME,
          label: { eyebrow: "On Bassey's phone", title: "Home", subtitle: "His day at a glance" },
          lines: [
            { say: "Bassey's Overview starts with Your Day: his Shift Today, his Clock-In, and his Status.", do: (s) => h.soft(s, s.page.getByRole("list", { name: "Your Day" })) },
            { say: "Then four cards: numbers that matter to him, such as My Attendance and My Overdue Tasks.", do: (s) => s.scroll(400) },
            { say: "Each card opens the records it counts, so he can check the number himself.", do: async (s) => { await s.click(card(s, "My Attendance")); await s.wait(1.4); } },
            { say: "Then My Goals This Quarter, Upcoming Leave, and Your Week, with what is due each day.", do: async (s) => { await s.click(h.button(s, "Close", s.page.getByRole("dialog").last())); await s.scroll(700); } },
            "On his first sign-in of each working day, the hub asks him to clock in before he sees it.",
          ],
        },
      ],
    },
    {
      name: "The Operations Overview",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: HOME,
          lines: [
            { say: "Cynthia's Overview is built for Operations and People. The greeting line counts who is in today.", do: (s) => h.soft(s, s.page.getByText(/clocked in/).first()) },
            { say: "Her cards: Clocked In Today, Overdue Tasks, Expenses Awaiting Approval and Active Partnerships.", do: (s) => h.soft(s, card(s, "Clocked In Today")) },
            { say: "She opens Clocked In Today. The line at the top sums it up.", do: (s) => s.click(card(s, "Clocked In Today")) },
            { say: "The chips split it: On Site, Remote, Field, Late, Not In and On Leave.", do: (s) => s.click(s.page.getByRole("dialog").last().getByRole("button", { name: /^Late/ }).first()) },
            { say: "Each row opens its person.", do: (s) => s.click(h.button(s, "Close", s.page.getByRole("dialog").last())) },
            { say: "Attendance, 14 Working Days: present against expected. The dips are Saturdays, a half day.", do: (s) => h.soft(s, h.heading(s, "Attendance, 14 Working Days")) },
            { say: "On Time is this month's ring: on time, late and absent.", do: (s) => h.soft(s, h.heading(s, "On Time")) },
            { say: "Need You lists the requests waiting for her decision, oldest first.", do: async (s) => { await s.scroll(600); await h.soft(s, h.heading(s, "Need You")); } },
            { say: "Choose Cards picks up to four cards from those her role may see. Export saves the Overview as a PDF or a spreadsheet.", do: async (s) => { await s.scroll(-1200); await h.soft(s, h.button(s, "Choose Cards")); } },
          ],
        },
      ],
    },
    {
      name: "The CEO's Overview",
      shots: [
        {
          kind: "desktop",
          as: "ifeoma",
          start: HOME,
          lines: [
            { say: "Ifeoma's Overview is the CEO's: the organisation's goals, how they stand, and who is in.", do: (s) => s.wait(0.5) },
            { say: "Organisational Goals shows each goal's progress this quarter.", do: (s) => h.soft(s, s.page.getByRole("heading", { name: /Organisational Goals|Goals/ }).first()) },
            { say: "The Org KPI ring gives each department's score.", do: (s) => h.soft(s, s.page.getByRole("heading", { name: /Org KPI/ }).first()) },
            { say: "And the Partnership Pipeline: how many partners at each stage.", do: async (s) => { await s.scroll(600); await h.soft(s, h.heading(s, "Partnership Pipeline")); } },
            "A Head of Department sees their department's signed value and pipeline; a member of staff, their own day.",
          ],
        },
      ],
    },
    {
      name: "Team",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: TEAM,
          lines: [
            { say: "Team shows who is in today. Cynthia sees the whole organisation; a manager, their own team.", do: (s) => h.soft(s, card(s, "Present Today")) },
            { say: "Present Today, On Site, Remote, and Flags: anyone late, or with no clock-out yesterday.", do: (s) => h.tour(s, [card(s, "Present Today"), card(s, "On Site"), card(s, "Remote"), card(s, "Flags")]) },
            { say: "The chips filter the Team Roster. Late shows who came in after their start.", do: (s) => s.click(s.page.getByRole("button", { name: "Late", exact: true })) },
            { say: "Everyone again. Each row shows the person's status, Clock-In, KPI and Open Tasks.", do: (s) => s.click(s.page.getByRole("button", { name: "Everyone", exact: true })) },
            { say: "Attendance This Month gives each person's on time, late, absent and leave days.", do: async (s) => { await s.scroll(800); await h.soft(s, h.heading(s, "Attendance This Month")); } },
          ],
        },
      ],
    },
    {
      name: "Alerts and Reports",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: ALERTS,
          lines: [
            { say: "Alerts holds what needs clearing: a rule broken, a deadline passed. Each is raised by a rule.", do: (s) => h.soft(s, h.heading(s, "Open Alerts")) },
            { say: "Alert Rules lists the rules. Attendance's come from MyCity's Attendance Policy.", do: async (s) => { await s.click(h.button(s, "Alert Rules")); await s.wait(1.2); } },
            { say: "Reports are the reports she receives, by email and here, on a schedule.", do: (s) => s.go(REPORTS) },
            { say: "Run Now runs Daily Attendance at once, as a PDF or a spreadsheet.", do: async (s) => { await s.click(h.button(s, "Run Now")); await s.click("Run as PDF"); await s.wait(1.5); } },
            { say: "Recent Runs lists each file, numbered, with Download.", do: (s) => h.soft(s, h.heading(s, "Recent Runs")) },
            "New Report builds another: what it covers, who receives it, how often, as a PDF or a spreadsheet.",
          ],
        },
      ],
    },
    {
      name: "The Attendance Register",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: REGISTER,
          lines: [
            { say: "The register itself is in People, on the Attendance tab: everyone's day, for any date.", do: (s) => h.soft(s, h.heading(s, "Register")) },
            { say: "Expected, then Present, Late, Absent, On Leave and Not In.", do: (s) => h.soft(s, h.button(s, "Present", s.page.locator("main")).or(s.page.getByRole("button", { name: /^Present \d/ })).first()) },
            { say: "Each row gives the Clock In and Clock Out, the hours, and the status.", do: (s) => s.scroll(400) },
            { say: "Exceptions lists the days that need a decision: a missing clock-out, a punch to check.", do: (s) => s.click(s.page.getByRole("radio", { name: "Exceptions" })) },
            "People and Operations decide each one: accept it, correct the time, or uphold it. The person is told.",
            { say: "Deductions and Overtime hold the pay a day earns or loses, for payroll.", do: (s) => s.click(s.page.getByRole("radio", { name: "Deductions" })) },
          ],
        },
      ],
    },
    {
      name: "My Attendance",
      shots: [
        {
          kind: "desktop",
          as: "bassey",
          start: MINE,
          lines: [
            { say: "Bassey's own attendance is in Self-Service, on My Attendance.", do: (s) => h.soft(s, h.heading(s, "My Attendance")) },
            { say: "Today shows his clock-in, his location, and the button to clock out.", do: (s) => h.soft(s, h.heading(s, "Today")) },
            { say: "Days Present, Late Days, Absent and Hours Worked this month.", do: (s) => h.soft(s, s.page.getByRole("button", { name: /^Days Present/ })) },
            { say: "Open Exceptions lists any day he should explain, such as a missing clock-out.", do: (s) => h.soft(s, h.heading(s, "Open Exceptions")) },
            { say: "My Days lists every day of the month. Pressing one opens it: its punches, its result, any deduction.", do: async (s) => { await s.scroll(500); await h.soft(s, h.heading(s, "My Days")); } },
            "Export Month saves the month as a file.",
          ],
        },
      ],
    },
    {
      name: "Finishing the Day",
      shots: [
        {
          kind: "phone",
          as: "bassey",
          clock: true,
          start: HOME,
          label: { eyebrow: "On Bassey's phone", title: "Finish Your Day", subtitle: "Bassey Ekpe clocks out" },
          lines: [
            "Late in the morning, Bassey has an appointment, and leaves early.",
            { say: "He opens Quick Actions, and the clock.", do: async (s) => { await s.click(h.button(s, "Quick Actions")); await s.click(s.page.getByRole("button", { name: /Clock Out/ }).last()); } },
            { say: "Finish Your Day, with when he clocked in and his Shift, 09:00 to 17:00.", do: (s) => h.soft(s, clock(s).getByText("Shift").first()) },
            { say: "He taps Clock Out.", do: (s) => s.click(h.button(s, "Clock Out", clock(s))) },
            { say: "Clocked Out, with the time. His day keeps the time he left.", do: (s) => h.soft(s, clock(s).getByText(/Clocked Out/).first(), 10000) },
            "Whether leaving early counts against a day is a rule in MyCity's Attendance Policy. Today it is off.",
            { say: "On an ordinary day, the clock opens by itself at 17:00 with Finish Your Day, and Remind Me asks again later.", do: (s) => s.click(h.button(s, "Done", clock(s))) },
            "Forget to clock out, and the hub reminds him every 30 minutes, then clocks him out itself about 90 minutes after the end.",
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
          start: HOME,
          lines: [
            { say: "That's Home and Attendance, from Start Your Day to Finish Your Day.", do: (s) => s.wait(0.4) },
            "Part 5 is Staff Community and Mailbox.",
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
