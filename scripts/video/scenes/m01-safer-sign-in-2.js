"use strict";
/**
 * Milestones 0 and 1, part 2 of 5: Faster, Safer Sign-In. docs/runbooks/training-videos.md says how a
 * scene is written and filmed, and §8 the plan of the five.
 *
 * MyCity's own people by their real names (an internal video). Aaron Agama, the Social Media Manager,
 * walks My Security, sets a PIN and a passkey and signs in with each; Bode Oluwasanmi, the Chief
 * Technology Officer, turns on two-step sign-in and signs in with a code. Filmed on the same database
 * as part 1, after it. The passkey is the browser's own virtual authenticator, the fingerprint reader
 * of filming (runbook §6.31); Bode's six-digit codes are worked out from the key his set-up shows,
 * as his authenticator app works them out.
 */
const fs = require("node:fs");
const path = require("node:path");
const h = require("../helpers");

const SECURITY = "/ess?tab=my-security";
const PIN = "4826";

/**
 * Bode's authenticator: the key his set-up showed, kept beside the shots so a sign-in filmed on its own
 * still has it, and the last 30-second step a code was used in (a code is taken once).
 */
const keyFile = () => path.join(process.env.VIDEO_OUT || "/tmp", "bode-totp.json");
const app = {
  read: () => { try { return JSON.parse(fs.readFileSync(keyFile(), "utf8")); } catch { return {}; } },
  save: (v) => fs.writeFileSync(keyFile(), JSON.stringify({ ...app.read(), ...v })),
};

/** The code Bode's app shows now, waiting for the next one when this one was already used. */
async function codeNow(s) {
  const mfa = require("../../../src/modules/security/security.mfa");
  const { key, step } = app.read();
  const now = () => Math.floor(Date.now() / 30000);
  while (step !== undefined && now() <= step) await s.wait(1);
  app.save({ step: now() });
  return mfa.codeAt(key);
}

/** Type digits into a group of one-digit boxes (a PIN, a code), from its first box. */
async function digits(s, group, value) {
  const first = group.getByRole("textbox").first();
  if (s.phone) await first.tap(); else { await s.hover(first); await first.click(); }
  await s.page.keyboard.type(value, { delay: 160 });
}

const pinGroup = (s, name, within) => (within || s.page).getByRole("group", { name, exact: true }).first();

module.exports = {
  id: "m01-safer-sign-in-2",
  file: "MyCity-M0-M1-Part-2-Faster-Safer-Sign-In",
  meta: { title: "MyCity App · Getting Started, Part 2: Faster, Safer Sign-In (Milestones 0 and 1)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestones 0 and 1 · Part 2 of 5",
    title: "Safer Sign-In",
    subtitle: "A PIN, a passkey and a code from your phone",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestones 0 and 1 · Part 2 · Safer Sign-In",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    aaron: (staff) => staff.everyone.find((p) => p.job_title === "Social Media Manager").work_email,
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
            "Welcome to part two of five on Milestones 0 and 1 of the MyCity hub.",
            "Part one was signing in with a password. This part makes it faster, and safer.",
          ],
        },
        {
          kind: "desktop",
          as: "aaron",
          start: SECURITY,
          lines: [
            { say: "Everything about how you sign in lives in Employee Self-Service, on the My Security tab.", do: (s) => s.hover(h.tab(s, "My Security")) },
            "Each person sees only their own. Nobody can read or change another person's sign-in from here.",
            "We follow Aaron Agama again, and Bode Oluwasanmi, the Chief Technology Officer.",
          ],
        },
      ],
    },
    {
      name: "My Security",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: SECURITY,
          lines: [
            { say: "Password shows the day it last changed. Change Password asks for the current one, then a new one twice.", do: async (s) => { await s.click(h.button(s, "Change Password")); await s.wait(0.8); } },
            { say: "Changing it signs out his other devices. He leaves it for now.", do: (s) => s.click(h.button(s, "Cancel", h.named(s, "Change Password"))) },
            { say: "Two-Step Sign-In asks for a code from an app on his phone. It reads Off.", do: (s) => s.hover(h.heading(s, "Two-Step Sign-In")) },
            { say: "A PIN is four digits that unlock the hub, and sign him in on a device he has used before.", do: (s) => s.hover(h.heading(s, "PIN")) },
            { say: "Passkeys sign him in with his fingerprint, face or screen lock instead of a password.", do: (s) => s.hover(h.heading(s, "Passkeys")) },
            { say: "And Signed In lists every device where he is signed in right now.", do: async (s) => { await s.scroll(500); await s.hover(h.heading(s, "Signed In")); } },
          ],
        },
      ],
    },
    {
      name: "A PIN",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: SECURITY,
          lines: [
            { say: "Aaron presses Set PIN.", do: (s) => s.click(h.button(s, "Set PIN")) },
            { say: "He tries 1234 in New PIN.", do: (s) => digits(s, pinGroup(s, "New PIN", h.named(s, "Set PIN")), "1234") },
            { say: "Refused: Not a run like 1234. Easy guesses are refused, and so is his birthday.", do: (s) => h.soft(s, s.page.getByText("Not a run like 1234")) },
            { say: "He types four digits nobody would guess, and the same in Confirm PIN.", do: async (s) => { await digits(s, pinGroup(s, "New PIN", h.named(s, "Set PIN")), PIN); await digits(s, pinGroup(s, "Confirm PIN", h.named(s, "Set PIN")), PIN); } },
            { say: "Save PIN.", do: async (s) => { await s.click(h.button(s, "Save PIN", h.named(s, "Set PIN"))); await h.toastOf(s, "PIN saved"); } },
            { say: "PIN saved. The card reads On.", do: (s) => s.hover(h.heading(s, "PIN")) },
            "After ten wrong PINs in a row, the PIN switches itself off, and he signs in with his password.",
            { say: "Then he signs out, to try it.", do: async (s) => { await h.accountMenu(s); await s.click(s.page.getByRole("menuitem", { name: "Sign Out" })); } },
          ],
        },
      ],
    },
    {
      name: "Signing In With a PIN",
      shots: [
        {
          kind: "desktop",
          start: "/login",
          still: true,
          device: "aaron",
          lines: [
            { say: "On the computer he last signed in on, the screen greets him by name.", do: (s) => s.hover(s.page.getByText(/, Aaron$/).first()) },
            { say: "Under Sign In, Use PIN.", do: (s) => s.click(h.button(s, "Use PIN")) },
            { say: "Enter PIN. He types his four digits, and the hub signs in at the fourth.", do: async (s) => { await digits(s, pinGroup(s, "PIN"), PIN); await h.toastOf(s, "Signed in as"); } },
            { say: "Signed in. No password typed.", hold: 0.6, after: (s) => h.clearOffers(s) },
            { say: "When the screen locks, it asks for his PIN first.", do: (s) => h.lockNow(s) },
            { say: "Four digits, and he's back.", do: async (s) => { await digits(s, pinGroup(s, "PIN", s.page.getByRole("dialog").last()), PIN); await h.toastOf(s, "Welcome back"); } },
            "Use Password, on either screen, goes back to his password at any time.",
          ],
        },
      ],
    },
    {
      name: "A Passkey",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: SECURITY,
          passkey: "aaron",
          lines: [
            "A passkey lives on the device itself: this computer's fingerprint reader, or his phone's.",
            { say: "Under Passkeys, Aaron presses Add Passkey.", do: (s) => s.click(h.button(s, "Add Passkey")) },
            { say: "The computer asks for his fingerprint. He touches the reader.", do: (s) => h.toastOf(s, "Passkey added", 10) },
            { say: "Passkey added. It is named after this browser, Chrome on Windows, and marked This Device.", do: (s) => h.soft(s, s.page.getByRole("table", { name: "Passkeys" }).getByText("This Device").first()) },
            "Pressing one renames it or removes it. He can keep up to ten, one for each of his devices.",
            { say: "He signs out again.", do: async (s) => { await h.accountMenu(s); await s.click(s.page.getByRole("menuitem", { name: "Sign Out" })); } },
          ],
        },
        {
          kind: "desktop",
          start: "/login",
          still: true,
          device: "aaron",
          passkey: "aaron",
          lines: [
            { say: "Now the sign-in screen offers Use Passkey too.", do: (s) => s.hover(h.button(s, "Use Passkey")) },
            { say: "He presses it, and touches the reader.", do: async (s) => { await s.click(h.button(s, "Use Passkey")); await h.toastOf(s, "Signed in as"); } },
            { say: "Signed in, with nothing typed at all. Nobody can steal a passkey by watching him type.", hold: 0.6, after: (s) => h.clearOffers(s) },
          ],
        },
      ],
    },
    {
      name: "Two-Step Sign-In",
      shots: [
        {
          kind: "desktop",
          as: "bode",
          start: SECURITY,
          lines: [
            "Bode Oluwasanmi looks after the hub's settings, so his account matters most. He turns on two-step sign-in.",
            { say: "After his password or PIN, the hub will ask for a code from an authenticator app on his phone.", do: (s) => s.hover(h.heading(s, "Two-Step Sign-In")) },
            { say: "He presses Set Up Two-Step.", do: (s) => s.click(h.button(s, "Set Up Two-Step")) },
            {
              say: "He scans the square code with his authenticator app. Or he can type the key printed under it.",
              do: async (s) => {
                const key = (await h.named(s, "Set Up Two-Step").getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/).first().innerText()).replace(/\s+/g, "");
                app.save({ key, step: undefined });
                await s.hover(h.named(s, "Set Up Two-Step").getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/).first());
              },
            },
            { say: "The app shows MyCity App and six digits that change every thirty seconds. He types them in Code From App.", do: async (s) => digits(s, pinGroup(s, "Code From App", h.named(s, "Set Up Two-Step")), await codeNow(s)) },
            { say: "Two-step turns on at the last digit. Recovery Codes shows ten codes, this once.", do: (s) => h.soft(s, h.button(s, "Copy Codes")) },
            { say: "Each one signs him in once if he loses his phone. He presses Copy Codes, and keeps them safe, away from it.", do: async (s) => { await s.click(h.button(s, "Copy Codes")); await s.wait(1); } },
            { say: "Close. The card reads On, with ten recovery codes left.", do: (s) => s.click(h.button(s, "Close", s.page.getByRole("dialog").last())) },
            { say: "Ask for a Code chooses how often this browser asks: Every Sign-In, Once a Day, or Once a Month.", do: (s) => h.soft(s, s.page.getByText("Ask for a Code").first()) },
            { say: "He signs out, to see it work.", do: async (s) => { await h.accountMenu(s); await s.click(s.page.getByRole("menuitem", { name: "Sign Out" })); } },
          ],
        },
        {
          kind: "desktop",
          start: "/login",
          still: true,
          device: "bode",
          lines: [
            { say: "Bode signs in with his password, as always.", do: async (s) => { await h.typePassword(s, "Password", s.password); await s.click(h.button(s, "Sign In")); } },
            { say: "Now the hub asks him to Enter Code.", do: (s) => h.soft(s, s.page.getByText("Enter Code").first()) },
            { say: "He opens his authenticator app and types the six digits under Sign-In Code.", do: async (s) => { await digits(s, pinGroup(s, "Sign-In Code"), await codeNow(s)); await h.toastOf(s, "Signed in as"); } },
            { say: "The hub opens at the last digit. Someone who learns his password still can't get in.", hold: 0.6, after: (s) => h.clearOffers(s) },
            "No phone with him? Use Recovery Code takes one of his ten codes instead. Each works once.",
          ],
        },
      ],
    },
    {
      name: "Where You're Signed In",
      shots: [
        {
          kind: "desktop",
          as: "aaron",
          start: SECURITY,
          lines: [
            { say: "Back on Aaron's My Security, Signed In lists his devices. This Device is the one he is using.", do: async (s) => { await s.scroll(700); await s.hover(s.page.getByRole("table", { name: "Signed In" })); } },
            { say: "Recent Sign-Ins shows each one: When, the Device, the Method, the Address and the Status.", do: async (s) => { await s.scroll(500); await s.hover(s.page.getByRole("table", { name: "Recent Sign-Ins" })); } },
            { say: "The Method says how: Password, PIN, or Passkey.", do: (s) => h.soft(s, s.page.getByRole("table", { name: "Recent Sign-Ins" }).getByRole("cell", { name: "Passkey" }).first()) },
            "A sign-in he doesn't recognise? He changes his password at once and tells People and Operations.",
            { say: "Sign Out beside a device ends it. Sign Out Others ends every one but this.", do: async (s) => { await s.scroll(-700); await s.click(h.button(s, "Sign Out Others")); } },
            { say: "He confirms with Sign Out. The message counts the devices signed out.", do: async (s) => { await s.click(h.button(s, "Sign Out", s.page.locator("[role=alertdialog], [role=dialog]").last())); await h.toastOf(s, ""); await s.wait(1); } },
            "Changing how he signs in may first ask Confirm It's You, if he hasn't signed in for fifteen minutes.",
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
          start: SECURITY,
          lines: [
            { say: "That's a safer sign-in: a PIN, a passkey, and a code from your phone.", do: (s) => s.hover(h.heading(s, "My Security")) },
            "Part 3 finds your way around the hub: the menu, search, notifications, and the User Guide.",
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
