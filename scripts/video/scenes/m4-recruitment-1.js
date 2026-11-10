"use strict";
/**
 * Milestone 4 handover, part 1 of 2: Vacancies, the careers page, Apply and the candidates board.
 * docs/runbooks/training-videos.md says how a scene is written and filmed.
 */
const VACANCIES = "/recruitment?tab=vacancies";

module.exports = {
  id: "m4-recruitment-1",
  file: "MyCity-M4-Recruitment-Part-1-Vacancies-and-Candidates",
  meta: { title: "MyCity App · Recruitment, Part 1: Vacancies and Candidates (Milestone 4)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestone 4 Handover · Part 1",
    title: "Recruitment",
    subtitle: "Vacancies, the careers page and the candidates board",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestone 4 · Recruitment · Part 1",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  people: {
    cynthia: (staff) => staff.operations.work_email,
    // The Implementation Team's account (create-admin --build-account): the roles' hiring manager.
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
            "Welcome to Recruitment, delivered in Milestone 4 of the MyCity hub.",
            "This is the first of two walkthroughs. It covers vacancies, the careers page,|applying on a phone, and the candidates board, through to the Talent Pool.",
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: "/",
          lines: [
            { say: "You'll find it in the menu, under Recruitment.", do: (s) => s.click(s.page.getByRole("link", { name: "Recruitment", exact: true }).first()) },
            { say: "Its tabs run from Vacancies to Talent Pool. Offers and Onboarding belong to Milestone 5.", do: (s) => s.hover("Talent Pool") },
            "Operations and People, Management, the Implementation team and the CEO see every vacancy.",
            "A Head of Department sees the roles whose hiring manager is in their team,|and anyone on an interview panel sees that interview.",
            "Every candidate in this walkthrough is invented, so no real applicant is involved.",
          ],
        },
      ],
    },
    {
      name: "Reading Vacancies",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: VACANCIES,
          lines: [
            "Cynthia Osakunih, the Operations and People Lead, runs recruitment.",
            { say: "Along the top, the tiles count the open vacancies, the applicants,|those in interview, and roles past their closing date.", do: (s) => s.hover(s.page.getByText("Open Vacancies", { exact: true })) },
            { say: "The list shows each role with its department, openings, location,|applicants, closing day and status.", do: async (s) => { await s.scroll(260); await s.hover(s.page.getByRole("row").nth(2)); } },
            { say: "Press a vacancy to open it beside the list.", do: (s) => s.click(s.page.getByText("Head, Sales & Revenue", { exact: true }).first()) },
            { say: "It shows the role's details and its public link. Copy Link shares it.", do: (s) => s.hover("Copy Link") },
          ],
        },
      ],
    },
    {
      name: "The Careers Page",
      shots: [
        {
          kind: "phone",
          site: "go",
          start: "/jobs",
          label: { eyebrow: "On a candidate's phone", title: "The Careers Page", subtitle: "Open roles, as anyone sees them at go.mycityapp.io" },
          lines: [
            "Published roles appear on the careers page, closing soonest first.",
            { say: "A candidate presses a role to read it.", do: (s) => s.click(s.page.getByText("Head, Sales & Revenue", { exact: true }).first()) },
            { say: "It shows the team, the area, how it's worked, and the day it closes.", do: (s) => s.scroll(500) },
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
          lines: ["Every step is also written up in the User Guide, in the Knowledge Hub.", "Thank you for watching."],
        },
      ],
    },
  ],
};
