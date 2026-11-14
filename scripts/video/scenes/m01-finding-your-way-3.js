"use strict";
/**
 * Milestones 0 and 1, part 3 of 5: Finding Your Way. docs/runbooks/training-videos.md says how a
 * scene is written and filmed, and §8 the plan of the five.
 *
 * MyCity's own people by their real names (an internal video). Aaron Agama, the Social Media
 * Manager, finds his way round the hub on a computer and on his phone: the menu, search,
 * notifications, his display, his own record and the Org Chart, and the User Guide. Cynthia
 * Osakunih, Operations & People, searches for a colleague. Bode Oluwasanmi, the Chief Technology
 * Officer, shows the Settings an administrator keeps: the company, its working week, roles, sign-in
 * rules, the look, and the audit log. Filmed on the same database as parts 1 and 2, after them. The
 * guide's answer is the filming stand-in's (runbook §6.30): the words are written for the video,
 * the screen and its sources are the hub's own.
 */
const fs = require("node:fs");
const h = require("../helpers");

const HOME = "/home?tab=overview";
const PROFILE = "/ess?tab=my-profile";
const ORG = "/ess?tab=org-chart";
const GUIDE = "/knowledge?tab=user-guide";

/** The search window, opened with Ctrl and K. */
const searchBox = (s) => s.page.locator('input[aria-label="Search"]').first();
async function openSearch(s) {
  await s.page.keyboard.press("Control+k");
  await searchBox(s).waitFor({ state: "visible", timeout: 5000 });
}

/**
 * The answer the guide gives for "How do I request leave?": the stand-in's words (runbook §6.30), each
 * sentence taken from passage 1 the hub sends, My Leave › Request leave, as its prompt requires.
 */
const ANSWER = [
  {
    match: "How do I request leave",
    delay: 2.5,
    reply: {
      answered: true,
      sentences: [
        { text: "Press Request Leave at the top right of My Leave, then pick the Leave Type.", sources: [1] },
        { text: "Choose the First Day and the Last Day, add a Note for your manager if it helps, and press Send Request.", sources: [1] },
        { text: "Your request reads Pending until your line manager decides, and you are told when they do.", sources: [1] },
      ],
    },
  },
];

module.exports = {
  id: "m01-finding-your-way-3",
  file: "MyCity-M0-M1-Part-3-Finding-Your-Way",
  meta: { title: "MyCity App · Getting Started, Part 3: Finding Your Way (Milestones 0 and 1)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestones 0 and 1 · Part 3 of 5",
    title: "Finding Your Way",
    subtitle: "The menu, search, notifications and Settings",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestones 0 and 1 · Part 3 · Finding Your Way",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    aaron: (staff) => staff.everyone.find((p) => p.job_title === "Social Media Manager").work_email,
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
            "Welcome to part three of five on Milestones 0 and 1 of the MyCity hub.",
            "This part finds your way around: on a computer, on a phone, and in Settings.",
          ],
        },
        {
          kind: "desktop",
          as: "aaron",
          start: HOME,
          lines: [
            "The hub is laid out differently on a computer and on a phone, so each feels natural.",
            "Everything you can do on one, you can do on the other.",
            "We follow Aaron Agama, Cynthia Osakunih, and Bode Oluwasanmi, who looks after Settings.",
          ],
        },
      ],
    },
    {
      name: "On a Computer",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: HOME,
          lines: [
            { say: "The dark menu on the left lists the modules Aaron can open. Home, My Workspace and Self-Service come first.", do: (s) => s.hover(h.link(s, "Home")) },
            { say: "The rest are grouped under Work, People, Business and System.", do: (s) => s.hover(h.link(s, "Staff Community")) },
            "Each person sees only the modules their roles open. Cynthia's menu is longer than Aaron's.",
            { say: "A number beside a module counts what waits for him there.", do: (s) => s.hover(s.page.getByRole("link", { name: /^Employee Self-Service \d/ })) },
            { say: "He opens Employee Self-Service. Its screens are tabs along the top, each with its own share of the count.", do: (s) => s.click(s.page.getByRole("link", { name: /^Employee Self-Service/ })) },
            { say: "Collapse Menu makes the menu narrow, to give the page more room. Expand Menu widens it again.", do: async (s) => { await s.click(h.button(s, "Collapse Menu")); await s.wait(0.8); await s.click(h.button(s, "Expand Menu")); } },
            { say: "Refresh reloads the numbers on the screen and keeps his place.", do: (s) => s.hover(h.button(s, "Refresh")) },
            { say: "Search Anything finds any screen, action or record.", do: (s) => s.hover(s.page.getByRole("button", { name: /^Search Anything/ })) },
            { say: "The clock sits at the top right. Today it reads On Leave Today: Aaron's leave is approved.", do: (s) => s.hover(s.page.getByRole("button", { name: /^(Clock In|Done For Today|On Leave Today)$/ }).first()) },
            { say: "The bell holds his notifications. And his name at the foot of the menu opens his account menu.", do: (s) => s.hover(h.button(s, "Notifications")) },
          ],
        },
      ],
    },
    {
      name: "On a Phone",
      shots: [
        {
          kind: "phone",
          as: "aaron",
          start: HOME,
          label: { eyebrow: "On Aaron's phone", title: "The Hub on a Phone", subtitle: "Built for the thumb, not shrunk" },
          setup: (s) => h.clearOffers(s),
          lines: [
            "On his phone, the hub is a phone app, not a smaller copy of the computer.",
            { say: "The bar at the bottom opens Home, Workspace, Community, Self-Service and More.", do: (s) => s.wait(0.4) },
            { say: "The round button with a plus is Quick Actions: this screen's own actions, Praxis AI and Help.", do: (s) => s.click(h.button(s, "Quick Actions")) },
            { say: "Help opens the User Guide at the section about the screen he is on. Hide Here tucks the button away.", do: async (s) => { await s.wait(1.2); await s.click(h.button(s, "Quick Actions")); } },
            { say: "A module's screens are tabs under its name. He opens Self-Service, and swipes them sideways.", do: (s) => s.click(s.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Self-Service/ })) },
            { say: "His picture at the top opens More: every other module as a tile, his display, and Sign Out.", do: (s) => s.click(h.button(s, "Your Account")) },
            { say: "Tiles use short names: Knowledge is the Knowledge Hub, Assistant is Praxis AI.", do: (s) => s.hover(s.page.getByRole("link", { name: "Knowledge" })) },
            { say: "Pulling a page down refreshes it. His phone's own Back gesture goes back a screen.", do: (s) => s.page.keyboard.press("Escape") },
          ],
        },
      ],
    },
    {
      name: "Search",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: HOME,
          lines: [
            { say: "Search finds every screen, action and record he may open. Ctrl and K opens it from anywhere.", do: (s) => openSearch(s) },
            { say: "With nothing typed, it lists what waits on him first, then the screens and actions he can open.", do: (s) => s.wait(0.5) },
            { say: "He types leave.", do: (s) => s.type(searchBox(s), "leave", { delay: 90 }) },
            { say: "Results come in groups: Screens, Actions, his own records, and the User Guide.", do: (s) => h.soft(s, s.page.getByText("Screens", { exact: true }).first()) },
            { say: "Some actions happen at once, wherever he is. He types change password.", do: (s) => s.type(searchBox(s), "change password", { delay: 70 }) },
            { say: "One typing slip is forgiven. Escape closes it.", do: async (s) => { await s.wait(0.8); await s.page.keyboard.press("Escape"); } },
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: HOME,
          lines: [
            { say: "Cynthia may see everyone, so her search finds people too. She types Bassey.", do: async (s) => { await openSearch(s); await s.type(searchBox(s), "Bassey", { delay: 90 }); } },
            { say: "Bassey Ekpe comes first, then his three latest attendance days, each with its status.", do: (s) => h.soft(s, s.page.getByRole("option", { name: /Bassey Ekpe/ }).first()) },
            { say: "Starting with a word narrows the search: guide leave finds only the User Guide's parts about leave.", do: async (s) => { await s.type(searchBox(s), "guide leave", { delay: 70 }); await s.wait(0.8); } },
            { say: "Escape closes it.", do: (s) => s.page.keyboard.press("Escape") },
          ],
        },
      ],
    },
    {
      name: "Notifications",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: HOME,
          lines: [
            { say: "The bell tells Aaron when something needs him. A dot means something is unread.", do: (s) => s.click(h.button(s, "Notifications")) },
            { say: "Unread shows only what he hasn't read. All shows everything, grouped Today, Yesterday and Earlier.", do: (s) => h.soft(s, s.page.getByRole("radio", { name: "All" }).or(s.page.getByRole("button", { name: "All", exact: true })).first()) },
            "Pressing a notification opens what it is about, and marks it read.",
            { say: "Mark All Read marks everything read at once, on all his devices.", do: (s) => s.hover(h.button(s, "Mark All Read")) },
            { say: "The cog, Notification Settings, chooses how he is told.", do: (s) => s.click(h.button(s, "Notification Settings")) },
            { say: "This Device says whether this computer gets notifications. Turn On asks the browser.", do: (s) => h.soft(s, s.page.getByText("This Device", { exact: true }).first()) },
            { say: "Under Notice Categories, In App, Email and Push for each kind of notice. Security is always on.", do: (s) => h.soft(s, s.page.getByText("Notice Categories", { exact: true }).first()) },
            { say: "And Quiet Hours holds back pushes overnight. Urgent notices still come.", do: async (s) => { await s.scroll(500, s.page.getByText("Notice Categories", { exact: true }).first()); await h.soft(s, s.page.getByText("Quiet Hours", { exact: true }).first()); } },
            "An urgent notice also stays in a red bar across the top of every screen until he opens it.",
          ],
        },
      ],
    },
    {
      name: "Your Display",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: HOME,
          lines: [
            { say: "His display is his own, kept on this device. It's in his account menu.", do: (s) => h.accountMenu(s) },
            { say: "Dark Theme.", do: async (s) => { await s.click(s.page.getByRole("menuitem", { name: "Dark Theme" })); await s.wait(1.2); } },
            "The dark theme is built on MyCity's own deep green. Every colour keeps its text readable.",
            { say: "Back to the light theme.", do: async (s) => { await h.accountMenu(s); await s.click(s.page.getByRole("menuitem", { name: "Light Theme" })); await s.wait(0.6); } },
            { say: "Compact Density fits more on the screen. Comfortable gives everything more room.", do: async (s) => { await h.accountMenu(s); await s.hover(s.page.getByRole("menuitem", { name: /Density$/ })); } },
            { say: "Text Size picks Small, Default, Large or Largest, and applies at once.", do: async (s) => { await s.click(s.page.getByRole("menuitem", { name: "Text Size" })); await s.wait(1); } },
            { say: "Install App, where the browser allows it, adds the hub to his computer or phone like any app.", do: (s) => s.page.keyboard.press("Escape") },
          ],
        },
      ],
    },
    {
      name: "Your Record and the Org Chart",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: PROFILE,
          lines: [
            { say: "My Profile, in Self-Service, shows Aaron's record as People keep it.", do: (s) => s.hover(h.heading(s, "My Profile")) },
            { say: "Personal, then Employment: his job, department, line manager and start date.", do: (s) => h.soft(s, h.heading(s, "Employment")) },
            { say: "His Work Schedule sets the hours the hub measures lateness against.", do: async (s) => { await s.scroll(500); await h.soft(s, h.heading(s, "Work Schedule")); } },
            "Bank Details shows only the last four digits. Next of Kin is who to call in an emergency.",
            "Edit Profile lets him correct his phone, home address, next of kin and bank. A bank change tells People.",
            "Only People change his job, his manager and his schedule. Record History lists every change, and who made it.",
          ],
        },
        {
          kind: "desktop",
          as: "aaron",
          start: ORG,
          lines: [
            { say: "The Org Chart shows who works at MyCity, and who reports to whom, from the CEO down.", do: (s) => s.wait(0.6) },
            { say: "He types Chinyere in Name or role.", do: (s) => s.type(s.page.getByRole("searchbox").first(), "Chinyere", { delay: 90 }) },
            { say: "Her card is outlined. He opens it: her department, who she reports to, and her team.", do: async (s) => { await s.click(s.page.getByRole("button", { name: /Chinyere Elechi/ }).first()); await s.wait(0.8); } },
            "Send Message writes to her in Staff Community. Download PDF saves the whole chart.",
          ],
        },
      ],
    },
    {
      name: "The User Guide",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: GUIDE,
          setup: () => fs.writeFileSync(process.env.VIDEO_AI_REPLIES, JSON.stringify(ANSWER)),
          lines: [
            { say: "The User Guide lives in the Knowledge Hub. He sees only the parts about what he can open.", do: (s) => s.hover(h.tab(s, "User Guide")) },
            { say: "Quick Start has short illustrated cards. Full Guide has every chapter in full.", do: (s) => s.hover(s.page.getByRole("radio", { name: "Full Guide" })) },
            { say: "He asks it a question in his own words: How do I request leave?", do: (s) => s.type(s.page.getByRole("searchbox").first(), "How do I request leave?", { delay: 55 }) },
            { say: "The results appear as he types, the best first, with the step that answers it.", do: (s) => h.soft(s, s.page.getByRole("list", { name: "Guide Results" })) },
            { say: "Get Answer writes a short answer from the guide.", do: (s) => s.click(h.button(s, "Get Answer")) },
            { say: "Each sentence names its source. Pressing a source opens the guide at that step.", do: (s) => h.soft(s, s.page.getByRole("list", { name: "Sources" }), 15000) },
            "Steps name each button exactly as the screen reads it. A link opens the screen, with Back to Guide to return.",
          ],
        },
      ],
    },
    {
      name: "Settings for Administrators",
      shots: [
        {
          kind: "desktop",
          as: "bode",
          start: "/settings?tab=organisation",
          lines: [
            { say: "Settings is where the hub is set up. Bode, as System Administrator, keeps it.", do: (s) => s.hover(s.page.getByRole("link", { name: /^Settings/ })) },
            { say: "Organisation holds the company's details. Naira and Lagos time are fixed for the hub.", do: (s) => h.soft(s, h.heading(s, "Company")) },
            { say: "The Working Week: Monday to Friday, 09:00 to 17:00, and Saturday, 09:00 to 15:00.", do: async (s) => { await s.scroll(500); await h.soft(s, h.heading(s, "Working Week")); } },
            "Attendance, leave and every deadline count from it. Edit Week changes any day, with no new release.",
            { say: "Roles and Permissions: what each role opens, how much it can do, and over whose records.", do: (s) => s.click(h.tab(s, "Roles & Permissions")) },
            { say: "Each module reads No Access, View, Add, Edit or Full, over All, Team or Own records.", do: (s) => s.wait(0.6) },
          ],
        },
        {
          kind: "desktop",
          as: "bode",
          start: "/settings?tab=security",
          lines: [
            { say: "Security sets how long a session lasts, the idle lock, and the shortest password allowed.", do: (s) => h.soft(s, h.heading(s, "Sessions and Passwords")) },
            { say: "Two-Step by Role can require an authenticator app for a whole role. Its people set it up at their next sign-in.", do: (s) => h.soft(s, h.heading(s, "Two-Step by Role")) },
            { say: "Failed Sign-Ins lists the week's refused sign-ins, and why.", do: async (s) => { await s.scroll(700); await h.soft(s, h.heading(s, "Failed Sign-Ins")); } },
            { say: "Appearance picks the dark theme's colours, the fonts, and the theme everyone starts with.", do: (s) => s.click(h.tab(s, "Appearance")) },
            { say: "And the Audit Log records who did what, when, to which record. Nobody can change it.", do: (s) => s.click(h.tab(s, "Audit Log")) },
          ],
        },
      ],
    },
    {
      name: "Wrapping Up",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: HOME,
          lines: [
            { say: "That's finding your way, from the menu to Settings.", do: (s) => s.hover(h.link(s, "Home")) },
            "Part 4 is Home, the dashboards, and clocking in and out.",
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
