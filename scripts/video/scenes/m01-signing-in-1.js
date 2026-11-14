"use strict";
/**
 * Milestones 0 and 1, part 1 of 5: Signing In. docs/runbooks/training-videos.md says how a scene is
 * written and filmed, and §8 the plan of the five.
 *
 * MyCity's own people by their real names (JBS Praxis, 14/11/2026: an internal video for MyCity's
 * team). Aaron Agama, the Social Media Manager, has a login the staff roster made and has never
 * signed in. Cynthia Osakunih, Operations & People, sends his invitation on Settings · Users; he sets
 * his password on his phone, signs in on a computer, forgets it and resets it, meets the lock screen
 * and signs out. Filmed on the staging seed's ground (runbook §4.1), from a snapshot taken before
 * Aaron's first invitation, with the worker's mail catcher (runbook §4.5): the two emails on his
 * phone are the ones the hub sent him.
 */
const h = require("../helpers");

const USERS = "/settings?tab=users";

module.exports = {
  id: "m01-signing-in-1",
  file: "MyCity-M0-M1-Part-1-Signing-In",
  meta: { title: "MyCity App · Getting Started, Part 1: Signing In (Milestones 0 and 1)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestones 0 and 1 · Part 1 of 5",
    title: "Signing In",
    subtitle: "From the invitation to the lock screen",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestones 0 and 1 · Part 1 · Signing In",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    cynthia: (staff) => staff.operations.work_email,
    aaron: (staff) => staff.everyone.find((p) => p.job_title === "Social Media Manager").work_email,
  },
  // Aaron has never signed in: he chooses his password on camera (make.js leaves him as he is).
  fresh: ["aaron"],
  chapters: [
    {
      name: "Welcome",
      shots: [
        {
          kind: "card",
          card: "opening",
          lines: [
            "Welcome to the MyCity hub. This is the first of five videos on Milestones 0 and 1: the foundation and core operations.",
            "This part is about getting in: your invitation, your password, and keeping your account safe.",
          ],
        },
        {
          kind: "desktop",
          start: "/login",
          still: true,
          lines: [
            { say: "The hub lives at hub.mycityapp.io. This is its sign-in screen.", do: (s) => s.hover(h.heading(s, "Sign In")) },
            { say: "On the left, the time in Lagos and in seven other African and world cities.", do: (s) => s.hover(s.page.getByRole("group", { name: "Cities" })) },
            "Everyone at MyCity signs in here with their work email and a password only they know.",
            "Nobody else knows your password. Not People, not the CEO, not JBS Praxis.",
            "We follow Aaron Agama, the Social Media Manager, on his first day in the hub,",
            "and Cynthia Osakunih, the Operations and People Lead, who gives him his login.",
          ],
        },
      ],
    },
    {
      name: "A Login for Aaron",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: USERS,
          lines: [
            { say: "Logins are kept in Settings, on the Users tab.", do: (s) => s.hover(h.tab(s, "Users")) },
            { say: "The tiles count the Users, who is Signed In Now, who is Invited, and who is Suspended.", do: (s) => h.tour(s, [h.words(s, "Signed In Now"), h.words(s, "Suspended")]) },
            { say: "Every login belongs to a person on the staff register. There is no login without an employee.", do: (s) => s.hover(s.page.getByRole("columnheader", { name: "User" })) },
            { say: "MyCity's staff list made a login for each person. Aaron's reads Not Sent: no email has gone yet.", do: (s) => s.hover(h.row(s, "Aaron Agama")) },
            { say: "Cynthia opens it.", do: (s) => s.click(h.text(s, "Aaron Agama")) },
            { say: "His Roles say what he may open. Staff is everyone's: their own work and records.", do: (s) => s.hover(h.named(s, "Aaron Agama").getByRole("listitem").filter({ hasText: "Staff" })) },
            { say: "A person may hold up to five roles, such as Line Manager or Head of Department.", do: (s) => s.hover(h.named(s, "Aaron Agama").getByRole("option", { name: /^Line Manager/ })) },
            { say: "She presses Send Invitation.", do: async (s) => { await s.click(h.button(s, "Send Invitation", h.named(s, "Aaron Agama"))); await h.toastOf(s, "Invitation sent"); } },
            "Invitation sent. Aaron gets an email with a link to choose his own password. It works once, for 72 hours.",
            { say: "Invite User, at the top, gives a login to someone who has none. Invite All Pending emails everyone still Not Sent.", do: (s) => h.tour(s, [h.button(s, "Invite User"), h.button(s, "Invite All Pending")]) },
          ],
        },
      ],
    },
    {
      name: "Choosing a Password",
      shots: [
        {
          kind: "phone",
          start: "/login",
          still: true,
          label: { eyebrow: "On Aaron's phone", title: "The Invitation", subtitle: "Aaron Agama chooses his password" },
          setup: (s) => h.emailOnPhone(s, "aaron@mycityapp.io", { subject: /account is ready/ }),
          lines: [
            "On his phone, Aaron's email has arrived: Your MyCity App account is ready.",
            { say: "It names who invited him, and his post. He taps Set Your Password.", do: (s) => s.click(h.link(s, "Set Your Password")) },
            { say: "The hub opens with Welcome, Aaron.", do: (s) => s.wait(0.6) },
            "A password needs at least 8 characters, with a capital letter, a small letter, a number and a symbol.",
            { say: "He starts with lagos, and moves on.", do: async (s) => { await h.typePassword(s, "New Password", "lagos"); await s.page.getByLabel("Confirm Password", { exact: true }).tap(); } },
            { say: "The field says what is missing: At least 8 characters.", do: (s) => s.wait(0.4) },
            { say: "He adds 2026. Now it asks for an uppercase letter.", do: (s) => s.type(h.field(s, "New Password"), "2026", { clear: false, delay: 90 }) },
            "It keeps telling him, letter by letter, until the password is right.",
            { say: "He types a stronger one, and the same again in Confirm Password.", do: async (s) => { await h.typePassword(s, "New Password", s.password); await h.typePassword(s, "Confirm Password", s.password); } },
            { say: "Set Password.", do: (s) => s.click(h.button(s, "Set Password")) },
            { say: "Password saved. Sign in with it now. His email is already filled in.", do: (s) => s.wait(0.5) },
            { say: "He types his new password and taps Sign In.", do: async (s) => { await h.typePassword(s, "Password", s.password); await s.click(h.button(s, "Sign In")); await h.toastOf(s, "Signed in as"); } },
            { say: "Signed in as Aaron Agama. His Home opens.", hold: 0.6, after: (s) => h.clearOffers(s) },
          ],
        },
      ],
    },
    {
      name: "Signing In",
      shots: [
        {
          kind: "desktop",
          start: "/login",
          still: true,
          device: "aaron",
          lines: [
            "Later, Aaron signs in on his computer at the office.",
            { say: "The greeting follows the clock: Good morning, Good afternoon or Good evening.", do: (s) => s.hover(s.page.getByText(/^Good (morning|afternoon|evening)/).first()) },
            { say: "He types his work email.", do: (s) => s.type(h.field(s, "Email"), "aaron@mycityapp.io") },
            { say: "He mistypes his password, and presses Sign In.", do: async (s) => { await h.typePassword(s, "Password", "Lagos-City-26"); await s.click(h.button(s, "Sign In")); } },
            { say: "A red bar says why: Not signed in. That email and password do not match.", do: (s) => h.soft(s, s.page.getByText("That email and password do not match.")) },
            "Too many wrong tries in a row and the hub asks him to wait before the next one.",
            { say: "He types it again, carefully.", do: (s) => h.typePassword(s, "Password", s.password) },
            { say: "Sign In.", do: async (s) => { await s.click(h.button(s, "Sign In")); await h.toastOf(s, "Signed in as"); } },
            { say: "Signed in as Aaron Agama. The hub opens on Home, or on whatever link he was opening.", hold: 0.8, after: (s) => h.clearOffers(s) },
          ],
        },
      ],
    },
    {
      name: "Forgot Password",
      shots: [
        {
          kind: "desktop",
          start: "/login",
          still: true,
          device: "aaron",
          lines: [
            "Weeks later, back from leave, Aaron cannot remember his password.",
            { say: "This browser knows him now, so the screen greets him by name and fills in his email.", do: (s) => s.hover(s.page.getByText(/, Aaron$/).first()) },
            { say: "He presses Forgot Password. The screen says Reset Password.", do: (s) => s.click(h.button(s, "Forgot Password")) },
            { say: "His email is there. Send Link.", do: async (s) => { s.sentAt = Date.now(); await s.click(h.button(s, "Send Link")); } },
            { say: "Check Your Email. A link is on its way, if that email has an account.", do: (s) => s.hover(h.heading(s, "Check Your Email")) },
            "The hub never says whether an address has a login. A stranger learns nothing by trying.",
          ],
        },
        {
          kind: "phone",
          start: "/login",
          still: true,
          label: { eyebrow: "On Aaron's phone", title: "Reset Password", subtitle: "Aaron Agama chooses a new password" },
          setup: (s) => h.emailOnPhone(s, "aaron@mycityapp.io", { subject: /Reset your/ }),
          lines: [
            "The email arrives: Reset your MyCity App password.",
            { say: "The link works once, for 30 minutes. He taps Choose a New Password.", do: (s) => s.click(h.link(s, "Choose a New Password")) },
            { say: "New Password, under his email address. He types a new one twice.", do: async (s) => { await h.typePassword(s, "New Password", s.password); await h.typePassword(s, "Confirm Password", s.password); } },
            { say: "Save Password.", do: (s) => s.click(h.button(s, "Save Password")) },
            { say: "Password saved. Sign in with it now.", do: (s) => s.wait(0.5) },
            "Saving a new password signs him out on every device, so an old session can't stay open.",
            "No email after a few minutes? Check the spam folder. A new link goes at most once every two minutes.",
          ],
        },
      ],
    },
    {
      name: "When the Screen Locks",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: "/home",
          lines: [
            "Aaron steps away from his desk for a long lunch.",
            { say: "After 30 minutes with no key or tap, the hub locks itself: Session Locked.", do: (s) => h.lockNow(s) },
            "His work stays underneath. Nothing he was typing is lost.",
            { say: "He types his password and presses Unlock.", do: async (s) => { await h.typePassword(s, "Password", s.password); await s.click(h.button(s, "Unlock")); await h.toastOf(s, "Welcome back"); } },
            { say: "Welcome back. He carries on where he was.", do: (s) => s.wait(0.6) },
            "The screen also locks after two hours from sign-in: Session Ended, for the time limit.",
            "And Signed Out, when a session was ended somewhere else: by a new password, or by People.",
            "With a PIN or a passkey, unlocking is quicker. Part 2 shows both.",
          ],
        },
      ],
    },
    {
      name: "Signing Out",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: "/home",
          lines: [
            { say: "At the end of the day, on a computer, he presses his name at the foot of the menu.", do: (s) => h.accountMenu(s) },
            { say: "The account menu holds My Profile, My Security, the User Guide, the theme and Text Size.", do: (s) => s.hover(s.page.getByRole("menuitem", { name: "My Security" })) },
            { say: "Sign Out is last. Every tab of the hub on this computer signs out with it.", do: (s) => s.click(s.page.getByRole("menuitem", { name: "Sign Out" })) },
            { say: "Back to the sign-in screen.", do: (s) => s.wait(0.8) },
          ],
        },
        {
          kind: "phone",
          as: "aaron",
          start: "/home",
          label: { eyebrow: "On Aaron's phone", title: "Signing Out", subtitle: "The same, from More" },
          lines: [
            { say: "On a phone, he taps his picture at the top right, which opens More.", do: (s) => s.click(h.button(s, "Your Account")) },
            { say: "Sign Out is at the foot of More.", do: (s) => s.hover(h.button(s, "Sign Out", h.named(s, "More"))) },
            { say: "On a shared device, always sign out. Save your work first: signing out keeps nothing unsaved.", do: (s) => s.click(h.button(s, "Sign Out", h.named(s, "More"))) },
          ],
        },
      ],
    },
    {
      name: "Wrapping Up",
      shots: [
        {
          kind: "desktop",
          start: "/login",
          still: true,
          lines: [
            { say: "That's signing in, from the invitation to signing out.", do: (s) => s.hover(h.heading(s, "Sign In")) },
            "Part 2 makes it faster and safer: a PIN, a passkey, and a code from your phone.",
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
