"use strict";
/**
 * Milestone 9 handover, part 1 of 2: Settings, People and Access. docs/runbooks/training-videos.md
 * says how a scene is written and filmed, and §8 the plan.
 *
 * MyCity's own people, by their real names (TB, 14/11/2026: an internal video, as real as it can be),
 * on a development database with the roster and the staging seed. Cynthia Osakunih, Operations &
 * People, sends the staff their invitations, reads a role, creates Regional Lead and gives it to
 * Tochukwu Ifeanyi, Marketing Lead in Abuja, who opens the hub on her phone and finds pay and
 * personal details masked. Bode Oluwasanmi, the CTO and System Administrator, requires two-step
 * sign-in for Management; Ifeoma Mbonu, the CEO, sets hers up on her phone and reads My Security;
 * Bode ends a session and reads the Audit Log. The chapters run in order, each on the one before.
 */
const USERS = "/settings?tab=users";
const ROLES = "/settings?tab=roles-and-permissions";
const SECURITY = "/settings?tab=security";
const AUDIT = "/settings?tab=audit-log";
const ROLE = "Regional Lead";

/** The dialog, sheet or confirmation on top. */
const dialog = (s) => s.page.locator("[role=dialog], [role=alertdialog]").last();
/** A window by its name, never a help term's popup (runbook §6.16). */
const named = (s, name) => s.page.getByRole("dialog", { name }).last();
const confirm = (s, name) => s.page.getByRole("alertdialog", { name }).last();
const button = (s, name, within) => (within || s.page).getByRole("button", { name, exact: true }).first();
const text = (s, words) => s.page.getByText(words, { exact: true }).first();
const tab = (s, name) => s.page.getByRole("tab", { name: new RegExp(`^${name}( \\d+)?$`) }).first();
/** A table's row holding every one of `words`. */
const row = (s, ...words) => words.reduce((r, w) => r.filter({ hasText: w }), s.page.getByRole("row")).first();
/** A level or records choice on a role's Access: the radio `choice` in the group "<Module> Level". */
const level = (s, module, kind, choice) => s.page.getByRole("radiogroup", { name: `${module} ${kind}` }).getByRole("radio", { name: choice, exact: true });

/** Wait for a toast that starts with `start` (the branded Toaster's), up to `seconds`. */
async function toastOf(s, start, seconds = 20) {
  await s.page.getByText(new RegExp(`^${start}`)).first().waitFor({ state: "visible", timeout: seconds * 1000 }).catch(() => null);
}

/** Glide to `loc` when it shows within a few seconds. */
async function soft(s, loc, wait = 4000) {
  if (await loc.waitFor({ state: "visible", timeout: wait }).then(() => true, () => false)) await s.hover(loc);
}

/** Read the notices waiting for the person a shot is filmed as, as they would before a demonstration. */
async function readNotices(email) {
  const { pool } = require("../../../src/config/db");
  await require("../people").caughtUp(pool, email);
}

module.exports = {
  id: "m9-settings-1",
  file: "MyCity-M9-Settings-Part-1-People-and-Access",
  meta: { title: "MyCity App · Settings, Part 1: People and Access (Milestone 9)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestone 9 Handover · Part 1",
    title: "Settings",
    subtitle: "Logins, roles, two-step sign-in and the audit log",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestone 9 · Settings · Part 1",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    cynthia: (staff) => staff.operations.work_email,
    bode: (staff) => staff.everyone.find((p) => p.job_title === "Chief Technology Officer").work_email,
    ifeoma: (staff) => staff.ceo.work_email,
    tochukwu: (staff) => staff.everyone.find((p) => p.job_title === "Marketing Lead - Abuja").work_email,
  },
  chapters: [
    {
      name: "Welcome",
      shots: [
        {
          kind: "card",
          card: "opening",
          lines: [
            "Welcome to the walkthrough of Settings and Governance, delivered in Milestone 9 of the MyCity hub.",
            "This first part covers who can sign in, what each person can open, and how the hub keeps a record.",
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: USERS,
          lines: [
            { say: "Settings is at the foot of the menu, under System.", do: (s) => s.hover(s.page.getByRole("link", { name: "Settings", exact: true })) },
            { say: "Its tabs depend on your role. Operations and People sees ten of them.", do: (s) => s.hover(s.page.getByRole("tablist", { name: "Settings" })) },
            "Status, Performance, Faults and Integrations are the IT team's. Most staff see no Settings at all.",
            "We follow Cynthia Osakunih, the Operations and People Lead, and Bode Oluwasanmi, the Chief Technology Officer.",
            "Then Tochukwu Ifeanyi, Marketing Lead in Abuja, and Ifeoma Mbonu, the CEO, on their phones.",
          ],
        },
      ],
    },
    {
      name: "Users",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: USERS,
          lines: [
            { say: "Users lists every login to the hub: Users, Signed In Now, Invited and Suspended.", do: (s) => s.hover(text(s, "Signed In Now")) },
            { say: "Each row shows the person, their Roles, when they were Last Seen, and whether Two-Step is on.", do: (s) => s.hover(s.page.getByRole("columnheader", { name: "Two-Step" })) },
            { say: "MyCity's staff list made a login for everyone. Each reads Not Sent until it's emailed.", do: (s) => s.hover(row(s, "Aaron Agama")) },
            { say: "Cynthia presses Invite All Pending. Every one of them is emailed a link to choose a password.", do: async (s) => { await s.click(button(s, "Invite All Pending")); await toastOf(s, "\\d+ invitations? sent"); } },
            { say: "The link works once, for 72 hours. Each row now reads Invited.", do: (s) => soft(s, row(s, "Aaron Agama", "Invited")) },
            { say: "Invite User gives a login to someone new, once People has added them as an employee.", do: (s) => s.hover(button(s, "Invite User")) },
            "No one has a login without an employee record.",
            { say: "She opens Aaron Agama's login.", do: (s) => s.click(row(s, "Aaron Agama")) },
            { say: "Roles lists what he holds: Staff. Five roles at most.", do: (s) => s.hover(named(s, "Aaron Agama").getByRole("searchbox", { name: "Roles" })) },
            { say: "Resend Invitation emails a fresh link. Once he's active, Send Reset Link takes its place.", do: (s) => soft(s, named(s, "Aaron Agama").getByRole("button", { name: /Invitation/ }).first()) },
            { say: "Suspend ends every session at once, with a reason. Reactivate lets the person back in.", do: (s) => s.hover(button(s, "Suspend", named(s, "Aaron Agama"))) },
            { say: "Your own login opens read only, so nobody can lock themselves out.", after: (s) => s.click(button(s, "Close", named(s, "Aaron Agama"))) },
          ],
        },
      ],
    },
    {
      name: "Roles & Permissions",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: ROLES,
          lines: [
            { say: "A role decides which modules its holders open, how much they can do, and over whose records.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Roles & Permissions" })) },
            { say: "The hub came with seven roles. Cynthia opens Staff, which twelve people hold.", do: (s) => s.click(row(s, "Staff")) },
            { say: "Access shows each module's level: No Access, View, Add, Edit or Full.", do: (s) => soft(s, s.page.getByText("Partnerships", { exact: true }).last()) },
            "Then whose records: All, Team, or Own. Approve and Export are separate.",
            { say: "Details holds the Sensitive Fields: salary and pay, bank details, personal details, tax and pension numbers.", do: (s) => s.click(tab(s, "Details")) },
            { say: "For Staff, each one reads Masked. A person always sees their own.", do: (s) => soft(s, text(s, "Masked")) },
            { say: "People lists who holds the role.", do: (s) => s.click(tab(s, "People")) },
            { say: "Matrix shows every role against every module, side by side.", do: (s) => s.click(s.page.getByRole("radio", { name: "Matrix", exact: true })) },
            { say: "T marks team records, O own records, A approves, and X exports.", hold: 0.6, after: (s) => s.click(s.page.getByRole("radio", { name: "Roles", exact: true })) },
          ],
        },
      ],
    },
    {
      name: "A New Role",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: ROLES,
          lines: [
            "MyCity's regional marketing leads look after partners and growth officers in their region.",
            "No built-in role fits, so Cynthia makes one.",
            { say: "She presses New Role and types its name: Regional Lead.", do: async (s) => { await s.click(button(s, "New Role")); await s.type("Role Name", ROLE, { delay: 70 }); } },
            { say: "Start From copies a role to begin with. She picks Staff.", do: (s) => s.click(s.page.getByRole("option", { name: /^Staff/ })) },
            { say: "Next. Every module's level now reads as Staff has it.", do: (s) => s.click(button(s, "Next")) },
            { say: "People goes from No Access to View, over All records: she'll see every colleague.", do: async (s) => { await s.click(level(s, "People", "Level", "View")); await s.click(level(s, "People", "Records", "All")); } },
            { say: "Partnerships stays at Edit, but over her Team's records, not only her own.", do: (s) => s.click(level(s, "Partnerships", "Records", "Team")) },
            { say: "Next. What It Is For, in a line.", do: async (s) => { await s.click(button(s, "Next")); await s.type("What It Is For", "Leads a region's growth officers and partners.", { delay: 30 }); } },
            { say: "Her Home is Partnerships: her pipeline first.", do: (s) => s.click(s.page.getByRole("radiogroup", { name: "Home" }).getByRole("radio", { name: "Partnerships", exact: true })) },
            { say: "Sensitive Fields stay unticked. Salary, bank and personal details are masked for this role.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Sensitive Fields" })) },
            { say: "Review Role lists everything the role gains.", do: (s) => s.click(button(s, "Review Role")) },
            { say: "People: View, over All. Partnerships: Edit, over Team.", do: (s) => soft(s, s.page.getByText("No Access → View · All").first()) },
            { say: "Create Role. It reads Custom, beside the seven Built-In ones.", do: async (s) => { await s.click(button(s, "Create Role")); await toastOf(s, `${ROLE} created`); } },
            "A change that would take away your own Settings access is refused, so nobody locks themselves out.",
          ],
        },
      ],
    },
    {
      name: "Giving It to Someone",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: USERS,
          setup: () => readNotices("cynthia@mycityapp.io"),
          lines: [
            { say: "Roles are given on Users. Cynthia opens Tochukwu Ifeanyi's login.", do: (s) => s.click(row(s, "Tochukwu Ifeanyi")) },
            { say: "She picks Regional Lead under Roles.", do: (s) => s.click(named(s, "Tochukwu Ifeanyi").getByRole("option", { name: /^Regional Lead/ })) },
            { say: "And removes Staff: everything Staff opens, the new role opens too.", do: (s) => s.click(button(s, "Remove Staff", named(s, "Tochukwu Ifeanyi"))) },
            { say: "Save Roles. Her new access applies at once, on every device.", do: async (s) => { await s.click(button(s, "Save Roles", named(s, "Tochukwu Ifeanyi"))); await toastOf(s, "Roles saved"); } },
            { say: "Users by Role counts the logins in each. Regional Lead has one.", do: (s) => soft(s, s.page.getByRole("heading", { name: "Users by Role" })) },
            "Any change to a role or a person's roles is a security event. Bode and Cynthia are told.",
          ],
        },
      ],
    },
    {
      name: "What She Sees",
      shots: [
        {
          kind: "phone",
          as: "tochukwu",
          start: "/home",
          label: { eyebrow: "On the employee's phone", title: "A Regional Lead", subtitle: "Tochukwu Ifeanyi opens the hub with her new role" },
          lines: [
            "Tochukwu opens the hub on her phone. Home opens on Partnerships, as her role says.",
            { say: "People now has an Employees tab: every colleague, as View over All allows.", do: (s) => s.go("/people?tab=employees") },
            { say: "She taps Aaron Agama.", do: (s) => s.click(s.page.getByRole("button", { name: /^Aaron Agama/ }).first()) },
            "His name, title and work email show. His date of birth and personal details read Restricted.",
            { say: "Job holds his Pay and Bank. Gross monthly, bank and account all read Restricted.", do: async (s) => { await s.click(tab(s, "Job")); await s.wait(0.8); await s.page.getByRole("heading", { name: "Pay and Bank" }).scrollIntoViewIfNeeded().catch(() => null); } },
            "She can't change his record, and Settings isn't in her menu. Exactly what the role grants.",
          ],
        },
      ],
    },
    {
      name: "Security",
      shots: [
        {
          kind: "desktop",
          as: "bode",
          start: SECURITY,
          lines: [
            { say: "Security is where Bode, as System Administrator, sets the sign-in rules.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Security", exact: true })) },
            { say: "The red bar is the notice of Tochukwu's new role. Every change to access is told at once.", do: (s) => soft(s, s.page.getByText(/^Access change/).first()) },
            { say: "Signed In Now, Two-Step On, and Failed Sign-Ins over the last seven days.", do: (s) => s.hover(text(s, "Failed Sign-Ins")) },
            { say: "Session Minutes ends a session after two hours, whatever the person is doing.", do: (s) => s.hover(s.page.getByRole("textbox", { name: "Session Minutes" })) },
            { say: "Idle Lock Minutes locks the screen after half an hour unused. Password Minimum is eight.", do: (s) => s.hover(s.page.getByRole("textbox", { name: "Idle Lock Minutes" })) },
            "They can only be made stricter than the server's own limits. Save Rules keeps a change.",
            { say: "Two-Step by Role says, for each role, how many people have set up an authenticator app.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Two-Step by Role" })) },
            { say: "Bode switches on Management: the CEO, himself and the Program Manager.", do: (s) => s.click(s.page.getByRole("switch", { name: "Management" })) },
            { say: "Everyone with Management sets it up at their next sign-in. He presses Require Two-Step.", do: async (s) => { await s.click(button(s, "Require Two-Step", confirm(s, "Require Two-Step"))); await toastOf(s, "Management now needs"); } },
            "It saves at once. A passkey counts as both steps.",
          ],
        },
      ],
    },
    {
      name: "The CEO's Two-Step",
      shots: [
        {
          kind: "phone",
          start: "/login",
          label: { eyebrow: "On the CEO's phone", title: "Two-Step Sign-In", subtitle: "Ifeoma Mbonu signs in after the change" },
          lines: [
            { say: "Ifeoma Mbonu signs in on her phone with her email and password.", do: async (s) => { await s.type("Email", "ifeoma@mycityapp.io", { delay: 45 }); await s.type("Password", process.env.VIDEO_PASSWORD || process.env.SEED_PASSWORD, { delay: 45 }); } },
            { say: "She taps Sign In. Her role now needs two-step, so the hub asks her to set it up.", do: (s) => s.click(button(s, "Sign In")) },
            { say: "She scans the square code with her authenticator app, or types the key under it.", do: async (s) => { await s.page.getByRole("heading", { name: "Set Up Two-Step" }).waitFor(); s.key = (await s.page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/).first().innerText()).replace(/\s+/g, ""); } },
            { say: "The app shows six digits. She types them in Code From App, and it turns on.", do: (s) => s.typeCode(s.page.getByRole("group", { name: "Code From App" }), require("../../../src/modules/security/security.mfa").codeAt(s.key)) },
            { say: "Ten Recovery Codes, shown this once. Each signs her in once without her phone.", do: (s) => s.page.getByRole("heading", { name: "Recovery Codes" }).waitFor({ timeout: 20000 }) },
            { say: "She presses Copy Codes and keeps them somewhere safe, away from her phone.", do: async (s) => { await s.click(button(s, "Copy Codes")); await s.wait(0.8); } },
            { say: "Continue, and she's in.", do: (s) => s.click(button(s, "Continue")) },
            "From now on, after her password the hub asks for the code her app shows.",
            "A lost phone? Use Recovery Code at sign-in, or an administrator's Reset Two-Step on her login.",
          ],
        },
      ],
    },
    {
      name: "My Security",
      shots: [
        {
          kind: "desktop",
          as: "ifeoma",
          start: "/ess?tab=my-security",
          lines: [
            { say: "Everyone manages their own sign-in on My Security, in Employee Self-Service.", do: (s) => s.hover(s.page.getByRole("heading", { name: "My Security" }).first()) },
            { say: "Ifeoma's Two-Step Sign-In reads On, with ten recovery codes left.", do: (s) => soft(s, s.page.getByRole("heading", { name: "Two-Step Sign-In" })) },
            { say: "Ask for a Code chooses how often this device asks: every sign-in, once a day, or once a month.", do: (s) => soft(s, s.page.getByRole("button", { name: /Ask for a Code|Every Sign-In|Once a/ }).first()) },
            "Turn Off isn't offered: her role requires two-step.",
            { say: "Change Password, a four-digit PIN, and Passkeys: a fingerprint or face instead of a password.", do: (s) => soft(s, s.page.getByRole("heading", { name: "Passkeys" })) },
            { say: "Signed In lists her devices. Sign Out signs one out; Sign Out Others, all but this one.", do: (s) => soft(s, s.page.getByRole("heading", { name: "Signed In" })) },
            { say: "Recent Sign-Ins shows each sign-in and its Method: Password and Code.", do: (s) => soft(s, s.page.getByRole("heading", { name: "Recent Sign-Ins" })) },
            "One she doesn't recognise? She changes her password at once, and tells IT.",
          ],
        },
      ],
    },
    {
      name: "Ending a Session",
      shots: [
        {
          kind: "desktop",
          as: "bode",
          start: SECURITY,
          setup: () => readNotices("bode@mycityapp.io"),
          lines: [
            "Bode signed in again since the change, so he set up his own two-step first.",
            { say: "Two-Step by Role now reads two of three for Management. Etudor Edidiong sets his up next.", do: (s) => soft(s, text(s, "Management")) },
            { say: "Signed In lists every session: the person, the device, the method and when it was last active.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Signed In" })) },
            { say: "Say Tochukwu's phone goes missing. Bode searches for her.", do: (s) => s.type(s.page.getByRole("searchbox", { name: "Name or device" }), "Tochukwu", { delay: 70 }) },
            { say: "Chrome on Android. He presses End Session, then End Session again to confirm.", do: async (s) => { await s.click(button(s, "End Session", row(s, "Tochukwu Ifeanyi"))); await s.wait(0.8); await s.click(button(s, "End Session", confirm(s, "End Session"))); await toastOf(s, "Tochukwu Ifeanyi is signed out"); } },
            "That phone is signed out at once. She signs in again on her new one.",
            { say: "Failed Sign-Ins lists refused sign-ins and why. Many from one address may mean someone is guessing.", do: (s) => soft(s, s.page.getByRole("heading", { name: "Failed Sign-Ins" })) },
            "On a person's login, Sign Out Everywhere ends all their sessions, and Reset Two-Step clears a lost app.",
          ],
        },
      ],
    },
    {
      name: "Audit Log",
      shots: [
        {
          kind: "desktop",
          as: "bode",
          start: AUDIT,
          lines: [
            { say: "The Audit Log records who did what, when, to which record. Nobody can change it.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Audit Log" })) },
            { say: "Entries Today, This Week and This Month, and Sensitive ones, such as a pay or role change.", do: (s) => s.hover(text(s, "Sensitive")) },
            { say: "Each entry says When, Who, What and the Record. System means the hub did it itself.", do: (s) => s.hover(s.page.getByRole("columnheader", { name: "Record" })) },
            { say: "Bode searches for the new role.", do: (s) => s.type(s.page.getByRole("searchbox", { name: "Who or what" }), "role", { delay: 80 }) },
            { say: "Cynthia created Regional Lead, and set Tochukwu's roles.", do: (s) => soft(s, row(s, "Cynthia Osakunih", ROLE)) },
            { say: "He opens the entry: When, Who, the Record, the Action and the address it came from.", do: (s) => s.click(row(s, "Cynthia Osakunih", ROLE)) },
            { say: "Then each Field, Before and After. A value his role doesn't see would read Restricted.", do: (s) => soft(s, dialog(s).getByText("Before", { exact: true }).first()) },
            { say: "Open Record opens the role itself.", do: (s) => soft(s, button(s, "Open Record", dialog(s))), after: (s) => s.click(button(s, "Close", dialog(s))) },
            { say: "Module and Dates narrow the list. Export saves it as a spreadsheet, up to ten thousand entries.", do: (s) => s.hover(button(s, "Export")) },
          ],
        },
      ],
    },
    {
      name: "Wrapping Up",
      shots: [
        {
          kind: "desktop",
          as: "bode",
          start: AUDIT,
          lines: [
            { say: "That's Settings' first half, from an invitation to the Audit Log.", do: (s) => s.hover(s.page.getByRole("tablist", { name: "Settings" })) },
            "Part two covers the company's set-up, approvals, notifications and the system's health.",
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
